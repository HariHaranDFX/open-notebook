from typing import ClassVar, List, Literal, Optional

from pydantic import Field

from open_notebook.domain.base import RecordModel
from open_notebook.domain.original_file_policy import (
    OriginalFileAction,
    OriginalFilePolicy,
)


class ContentSettings(RecordModel):
    record_id: ClassVar[str] = "open_notebook:content_settings"
    default_content_processing_engine_doc: Optional[
        Literal["auto", "docling", "simple"]
    ] = Field("auto", description="Default Content Processing Engine for Documents")
    default_content_processing_engine_url: Optional[
        Literal["auto", "firecrawl", "jina", "crawl4ai", "simple"]
    ] = Field("auto", description="Default Content Processing Engine for URLs")
    default_embedding_option: Optional[Literal["ask", "always", "never"]] = Field(
        "ask", description="Default Embedding Option for Vector Search"
    )
    # Legacy admin retention toggle. Retained for compatibility during the
    # deprecation window; DO NOT read in the resolver (see
    # ``resolve_original_file_action``). Existing rows containing only this
    # field must default to "always_keep" via ``original_file_policy``.
    auto_delete_files: Optional[Literal["yes", "no"]] = Field(
        "yes", description="Auto Delete Uploaded Files (deprecated)"
    )
    original_file_policy: OriginalFilePolicy = Field(
        "always_keep",
        description="Retention policy for uploaded original files",
    )
    original_file_user_default: OriginalFileAction = Field(
        "keep",
        description=(
            "Default retention action when policy is 'user_choice' and "
            "the source owner does not specify a preference."
        ),
    )
    allow_source_owner_cleanup: bool = Field(
        False,
        description=(
            "Whether source owners may clean up (delete) retained "
            "originals they own. Editors/viewers are never allowed."
        ),
    )
    docling_ocr: Optional[bool] = Field(
        True,
        description=(
            "Run OCR on scanned PDFs and images when the Docling engine handles "
            "them. Disable for faster processing of text-native documents."
        ),
    )
    docling_formulas: Optional[bool] = Field(
        False,
        description=(
            "Extract mathematical formulas as structured markup when the Docling "
            "engine handles a document. Adds processing time."
        ),
    )
    docling_vision: Optional[bool] = Field(
        False,
        description=(
            "Describe images and charts using a vision model when the Docling "
            "engine handles a document. Significantly slower and may invoke a "
            "vision model."
        ),
    )
    youtube_preferred_languages: Optional[List[str]] = Field(
        ["en", "pt", "es", "de", "nl", "en-GB", "fr", "de", "hi", "ja"],
        description="Preferred languages for YouTube transcripts",
    )
