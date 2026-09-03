import operator
import os
import tempfile
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import aiohttp
from content_core import ContentCoreConfig, extract_content
from content_core.common import ExtractionOutput
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from loguru import logger
from typing_extensions import Annotated, TypedDict

from open_notebook.ai.models import Model, ModelManager
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.notebook import Asset, Source
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import ConfigurationError
from open_notebook.graphs.transformation import graph as transform_graph
from open_notebook.utils.runtime_capabilities import (
    engine_runtime_missing,
    media_processing_available,
)

# Extensions content-core routes to ffmpeg-backed transcription. Kept in lockstep
# with the frontend upload picker so both sides agree what "media" means.
_MEDIA_EXTS = frozenset(
    {".mp3", ".mp4", ".wav", ".m4a", ".mov", ".avi", ".mkv", ".webm",
     ".aac", ".flac", ".ogg", ".wmv"}
)

# Preferred languages for YouTube transcript selection. content-core's own
# default is only ["en", "es", "pt"]; we keep the broader list Open Notebook has
# always intended so non-English videos still resolve a transcript.
YOUTUBE_PREFERRED_LANGUAGES = [
    "en",
    "pt",
    "es",
    "de",
    "nl",
    "en-GB",
    "fr",
    "hi",
    "ja",
]


class SourceState(TypedDict):
    # Input describing what to extract: url / file_path / content / delete_source.
    content_state: Dict[str, Any]
    # Result of content-core extraction (does NOT echo url/file_path back).
    extraction: ExtractionOutput
    apply_transformations: List[Transformation]
    source_id: str
    notebook_ids: List[str]
    source: Source
    transformation: Annotated[list, operator.add]
    embed: bool


class TransformationState(TypedDict):
    source: Source
    transformation: Transformation


def _usable_engine(engine: str, kind: str) -> str:
    """Return ``engine``, or "auto" when its opt-in runtime is not installed.

    The engine choice is persisted in the database; runtime availability comes
    from environment flags that are re-evaluated on every boot. A redeploy that
    drops OPEN_NOTEBOOK_ENABLE_CRAWL4AI/_DOCLING (or a failed on-demand install)
    therefore leaves a stored selection pointing at an absent runtime, and
    passing it through fails every extraction with no usable diagnostic. Falling
    back to content-core's "auto" chain keeps ingestion working, loudly.
    """
    missing_env_var = engine_runtime_missing(engine)
    if missing_env_var is None:
        return engine
    logger.warning(
        f"Configured {kind} engine '{engine}' is selected in Content Settings but "
        f"its runtime is not available in this container; falling back to 'auto'. "
        f"Set {missing_env_var}=true to enable it (see ADR-007)."
    )
    return "auto"


def default_source_title(content_state: Dict[str, Any]) -> str:
    """Friendly fallback title used when the user doesn't type one at create.

    Upload -> filename, URL -> the URL itself, text -> ``"Processing..."``
    (extraction always succeeds for text and overwrites immediately, so the
    placeholder never sticks in practice). Called from both the create-source
    endpoint (to seed the title) and save_source (to recognise "this was the
    auto default, feel free to upgrade it with the extracted title").
    """
    file_path = content_state.get("file_path")
    if file_path:
        # basename handles both posix and Windows separators uniformly.
        return os.path.basename(file_path.replace("\\", "/")) or "Processing..."
    url = content_state.get("url")
    if url:
        return url
    return "Processing..."


def _url_looks_like_media(url: str) -> bool:
    """True when ``url``'s path ends in an ffmpeg-backed audio/video extension.

    Uses ``urlparse(url).path`` because a naive ``os.path.splitext(url)`` puts
    the query string into the extension for URLs like ``.mp3?token=abc``.
    Extension-only detection covers the common case (samplelib, S3 links,
    direct CDNs); URLs without a media extension in the path (e.g. a bare
    ``/media/12345``) fall through to content-core's normal URL routing.
    """
    if not url:
        return False
    try:
        path = urlparse(url).path
    except Exception:
        return False
    ext = os.path.splitext(path)[1].lower()
    return ext in _MEDIA_EXTS


def _preflight_upload(
    content_state: Dict[str, Any],
    *,
    media_available: bool,
    stt_configured: bool,
) -> None:
    """Raise ConfigurationError for uploads that would fail deep inside content-core.

    Runs BEFORE extract_content() so the worker marks the job ``failed`` on the
    first try instead of consuming the 15-attempt retry budget on a permanent
    error. ConfigurationError is in the surreal-commands ``stop_on`` list for
    process_source, so raising it here is a hard stop, not a retry.

    Source-agnostic: works on ``file_path`` uploads and on ``url`` inputs whose
    path ends in a media extension (samplelib.com/mp3/x.mp3, direct S3 links
    etc). YouTube and other URLs without a media path extension pass through
    unchecked because they route through their own extractors that don't need
    ffmpeg. PDF encryption is handled post-hoc by _rewrite_extraction_error.
    """
    file_path = content_state.get("file_path")
    url = content_state.get("url")
    if file_path:
        ext = os.path.splitext(file_path)[1].lower()
    elif url:
        # Media detection via urlparse to strip query strings; matches _url_looks_like_media.
        ext = os.path.splitext(urlparse(url).path)[1].lower()
    else:
        return
    if ext in _MEDIA_EXTS:
        if not media_available:
            raise ConfigurationError(
                "Audio and video uploads require FFmpeg (ffmpeg + ffprobe) on the "
                "worker host. Install FFmpeg (see docs/DEV_SETUP.md) and restart "
                "the worker."
            )
        if not stt_configured:
            raise ConfigurationError(
                "Audio and video uploads require a configured Speech-to-Text model. "
                "Add one in Settings -> Models before uploading."
            )


async def _download_url_to_tmp(url: str) -> str:
    """Download ``url`` to a temp file, preserving its extension.

    Extension preservation matters because content-core's file router picks the
    extractor from the file's MIME/extension; a suffix-less tmp path would fall
    back to text and re-hit the same UTF-8-decode-of-binary-bytes failure that
    already breaks the URL path. Callers are responsible for _safe_unlink on
    the returned path.
    """
    parsed = urlparse(url)
    suffix = os.path.splitext(parsed.path)[1]
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                resp.raise_for_status()
                with open(tmp, "wb") as f:
                    async for chunk in resp.content.iter_chunked(64 * 1024):
                        f.write(chunk)
    except Exception:
        _safe_unlink(tmp)
        raise
    return tmp


def _safe_unlink(path: Optional[str]) -> None:
    """Delete ``path`` if it exists, ignoring missing-file and permission errors.

    Used to clean up temp downloads whether extraction succeeds or fails. A
    stuck lock on Windows or a race with another cleaner must not crash the
    worker; the OS or a tmp reaper will handle whatever we leave behind.
    """
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        logger.warning(f"Failed to delete temp download: {path}")


def _rewrite_extraction_error(exc: BaseException) -> None:
    """Translate a known-permanent extraction failure into ConfigurationError.

    content-core's PDF path (pdfplumber -> pdfminer) raises
    ``PDFPasswordIncorrect`` / ``PDFEncryptionError`` at document initialisation
    when the file is password-protected. Without translation, the worker treats
    both as transient and retries 15 times before giving up with a cryptic
    message. Called from the ``except`` around extract_content(); re-raises the
    original exception unchanged when it isn't one we can improve on.
    """
    from pdfminer.pdfdocument import PDFEncryptionError, PDFPasswordIncorrect

    encryption_types = (PDFPasswordIncorrect, PDFEncryptionError)
    encryption_keywords = ("encrypt", "password", "protected")

    is_encryption = isinstance(exc, encryption_types) or any(
        keyword in str(exc).lower() for keyword in encryption_keywords
    )
    if is_encryption:
        raise ConfigurationError(
            "This file is password-protected. Remove the password and re-upload."
        ) from exc
    raise exc


def _label_docling_flag(value: bool | None, engine: str) -> str:
    """Label a Docling toggle for the extraction log line.

    content-core ignores docling_ocr/_formulas/_vision outside the Docling
    document engine. Echoing the stored preference verbatim there read as if
    OCR/formulas/vision were active when they weren't (e.g. Docling not
    installed -> engine falls back to 'auto' via _usable_engine, but the log
    still printed docling_ocr=True). Show "n/a" for the honest picture.
    """
    if engine != "docling":
        return "n/a"
    if value is None:
        return "auto"
    return str(value)


async def content_process(state: SourceState) -> dict:
    content_state: Dict[str, Any] = state["content_state"]

    # content-core 2.x takes engine/model overrides via ContentCoreConfig
    # (keyword-only), not inside the input dict.
    config_kwargs: Dict[str, Any] = {
        "youtube_languages": YOUTUBE_PREFERRED_LANGUAGES,
    }

    # Honor the persisted content-processing engine choices. content-core
    # accepts "auto"/"simple"/"firecrawl"/"jina"/"crawl4ai" for URLs and
    # "auto"/"docling"/"simple" for documents; falling back to "auto" keeps the
    # previous behavior when settings are unset.
    try:
        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
        if settings.default_content_processing_engine_url:
            config_kwargs["url_engine"] = _usable_engine(
                settings.default_content_processing_engine_url, "url"
            )
        if settings.default_content_processing_engine_doc:
            config_kwargs["document_engine"] = _usable_engine(
                settings.default_content_processing_engine_doc, "document"
            )
        if settings.docling_ocr is not None:
            config_kwargs["docling_ocr"] = settings.docling_ocr
        if settings.docling_formulas is not None:
            config_kwargs["docling_formulas"] = settings.docling_formulas
        if settings.docling_vision is not None:
            config_kwargs["docling_vision"] = settings.docling_vision
    except Exception as e:
        # Keep the server-side traceback for diagnosing DB/deserialization
        # failures while still falling back to defaults (non-fatal).
        logger.opt(exception=True).warning(
            f"Failed to load content settings, using defaults: {e}"
        )

    try:
        model_manager = ModelManager()
        defaults = await model_manager.get_defaults()
        if defaults.default_speech_to_text_model:
            stt_model = await Model.get(defaults.default_speech_to_text_model)
            if stt_model:
                config_kwargs["audio_provider"] = stt_model.provider
                config_kwargs["audio_model"] = stt_model.name
                logger.debug(
                    f"Using speech-to-text model: {stt_model.provider}/{stt_model.name}"
                )
    except Exception as e:
        logger.warning(f"Failed to retrieve speech-to-text model configuration: {e}")
        # Continue without custom audio model (content-core will use its default)

    config = ContentCoreConfig(**config_kwargs) if config_kwargs else None

    # Reject uploads that would fail deep inside content-core with a cryptic
    # message and burn the 15-attempt retry budget. ConfigurationError is in
    # process_source's stop_on list -> immediate permanent failure. Runs
    # BEFORE any network download so a permanent reject doesn't fetch bytes
    # we're about to throw away.
    _preflight_upload(
        content_state,
        media_available=media_processing_available(),
        stt_configured=bool(
            config_kwargs.get("audio_provider") and config_kwargs.get("audio_model")
        ),
    )

    # Log the effective extraction engines so operators can confirm which engine
    # actually ran (content-core logs its own dispatch only at DEBUG). Absent
    # overrides fall back to content-core's "auto".
    if content_state.get("url"):
        target = "url"
    elif content_state.get("file_path"):
        target = "document"
    else:
        target = "content"
    effective_doc_engine = config_kwargs.get("document_engine", "auto")
    logger.info(
        f"Extracting {target} via content-core "
        f"(url_engine={config_kwargs.get('url_engine', 'auto')}, "
        f"document_engine={effective_doc_engine}, "
        f"docling_ocr={_label_docling_flag(config_kwargs.get('docling_ocr'), effective_doc_engine)}, "
        f"docling_formulas={_label_docling_flag(config_kwargs.get('docling_formulas'), effective_doc_engine)}, "
        f"docling_vision={_label_docling_flag(config_kwargs.get('docling_vision'), effective_doc_engine)})"
    )

    # Route direct audio/video URLs through the file extractor. content-core's
    # URL router hands anything not matched by its MIME allowlist to the HTML
    # extractors (Firecrawl/Jina/Crawl4AI/bs4), which try to UTF-8-decode the
    # binary bytes and fail with a cryptic error. Downloading first and
    # re-invoking with file_path lets content-core route to transcribe_audio /
    # extract_video, the same path a local upload takes. The Asset saved later
    # keeps the original URL (via state["content_state"]) so provenance is
    # preserved even though the tmp file is deleted.
    tmp_media_download: Optional[str] = None
    if content_state.get("url") and _url_looks_like_media(content_state["url"]):
        tmp_media_download = await _download_url_to_tmp(content_state["url"])
    try:
        try:
            processed = await extract_content(
                url=None if tmp_media_download else content_state.get("url"),
                file_path=tmp_media_download or content_state.get("file_path"),
                content=content_state.get("content"),
                config=config,
            )
        except Exception as exc:
            # Translate known-permanent failures (e.g. password-protected PDFs
            # from pdfminer) into ConfigurationError so the worker stops
            # retrying and the UI shows a real message. Unrelated exceptions
            # bubble up unchanged.
            _rewrite_extraction_error(exc)
            raise  # unreachable; _rewrite_extraction_error always raises
    finally:
        _safe_unlink(tmp_media_download)

    # content-core signals a soft extraction failure (e.g. an unreachable or
    # invalid URL, via the bs4 fallback) by returning title="Error" and content
    # prefixed with "Failed to extract content:" instead of raising. Detect that
    # sentinel and raise so the job is marked failed and the source becomes
    # retryable, rather than being saved as a "completed" source whose body is
    # the error string.
    if processed.title == "Error" and (processed.content or "").startswith(
        "Failed to extract content:"
    ):
        raise ValueError(
            "Could not extract content from this source. "
            "The URL or file may be unreachable, invalid, or in an unsupported format."
        )

    if not processed.content or not processed.content.strip():
        url = content_state.get("url") or ""
        if url and ("youtube.com" in url or "youtu.be" in url):
            raise ValueError(
                "Could not extract content from this YouTube video. "
                "No transcript or subtitles are available. "
                "Try configuring a Speech-to-Text model in Settings "
                "to transcribe the audio instead."
            )
        raise ValueError(
            "Could not extract any text content from this source. "
            "The content may be empty, inaccessible, or in an unsupported format."
        )

    # content-core 2.x no longer deletes the uploaded source file after
    # extraction (the delete_source flag it used to honor is gone). Preserve the
    # previous auto-delete behavior on our side.
    if content_state.get("delete_source") and content_state.get("file_path"):
        file_path = content_state["file_path"]
        try:
            os.unlink(file_path)
        except FileNotFoundError:
            logger.warning(f"File not found while trying to delete: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to delete source file {file_path}: {e}")

    return {"extraction": processed}


async def save_source(state: SourceState) -> dict:
    content_state = state["content_state"]
    extraction = state["extraction"]

    # Get existing source using the provided source_id
    source = await Source.get(state["source_id"])
    if not source:
        raise ValueError(f"Source with ID {state['source_id']} not found")

    # Update the source with processed content. content-core's ExtractionOutput
    # does not echo url/file_path back, so carry them from the input state.
    source.asset = Asset(
        url=content_state.get("url"), file_path=content_state.get("file_path")
    )
    source.full_text = extraction.content

    # Preserve user-set title; upgrade the auto default (filename / URL /
    # "Processing...") when the extractor produced a nicer one.
    auto_default = default_source_title(content_state)
    if extraction.title and (
        not source.title
        or source.title == "Processing..."
        or source.title == auto_default
    ):
        source.title = extraction.title

    await source.save()

    # NOTE: Notebook associations are created by the API immediately for UI responsiveness
    # No need to create them here to avoid duplicate edges

    if state["embed"]:
        if source.full_text and source.full_text.strip():
            logger.debug("Embedding content for vector search")
            await source.vectorize()
        else:
            logger.warning(
                f"Source {source.id} has no text content to embed, skipping vectorization"
            )

    return {"source": source}


def trigger_transformations(state: SourceState, config: RunnableConfig) -> List[Send]:
    if len(state["apply_transformations"]) == 0:
        return []

    to_apply = state["apply_transformations"]
    logger.debug(f"Applying transformations {to_apply}")

    return [
        Send(
            "transform_content",
            {
                "source": state["source"],
                "transformation": t,
            },
        )
        for t in to_apply
    ]


async def transform_content(state: TransformationState) -> Optional[dict]:
    source = state["source"]
    content = source.full_text
    if not content:
        return None
    transformation: Transformation = state["transformation"]

    logger.debug(f"Applying transformation {transformation.name}")
    # LangGraph accepts a partial state dict at runtime, but its typed
    # overloads require the full state type (langgraph typing limitation).
    result = await transform_graph.ainvoke(  # type: ignore[call-overload]
        dict(input_text=content, transformation=transformation),
        config=RunnableConfig(configurable={"model_id": transformation.model_id}),
    )
    await source.add_insight(transformation.title, result["output"])
    return {
        "transformation": [
            {
                "output": result["output"],
                "transformation_name": transformation.name,
            }
        ]
    }


# Create and compile the workflow
workflow = StateGraph(SourceState)

# Add nodes
workflow.add_node("content_process", content_process)
workflow.add_node("save_source", save_source)
workflow.add_node("transform_content", transform_content)
# Define the graph edges
workflow.add_edge(START, "content_process")
workflow.add_edge("content_process", "save_source")
workflow.add_conditional_edges(
    "save_source", trigger_transformations, ["transform_content"]
)
workflow.add_edge("transform_content", END)

# Compile the graph
source_graph = workflow.compile()
