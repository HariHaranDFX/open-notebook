# Content Processing: Chunking, Embedding, Context & Encryption

Design notes for the utilities in `open_notebook/utils/` that turn raw content into searchable, LLM-consumable data. These are cross-cutting: sources, notes and insights all flow through them.

## Ingestion runtime matrix

What each source type needs at the worker host. Runtimes are probed at request time by [`open_notebook/utils/runtime_capabilities.py`](../../open_notebook/utils/runtime_capabilities.py) and reported to the frontend via `GET /api/capabilities`, which the upload picker uses to gate which extensions it advertises. When a runtime is missing, uploads that would need it are **rejected up front** with a `ConfigurationError` from `open_notebook.graphs.source._preflight_upload` (in `stop_on` for `process_source`, so no 15-attempt retry loop).

| Source | Base handler | Runtime prerequisites | Capability probe |
|---|---|---|---|
| PDF, DOCX/XLSX/PPTX, HTML, plain text, Markdown, EPUB | content-core (`pdfplumber`, `docling` optional) | None; higher-fidelity PDF/Office needs Docling | `docling_available` |
| Images (JPG/PNG/TIFF) | content-core → Docling | **Docling** (`OPEN_NOTEBOOK_ENABLE_DOCLING=true` + on-demand install) | `docling_available` |
| Audio/video files (MP3/MP4/WAV/M4A/MOV/AVI/WMV/AAC) | content-core → `transcribe_audio` / `extract_video` → STT model | **`ffmpeg` + `ffprobe`** on PATH **AND** a configured Speech-to-Text model | `media_processing_available` |
| Direct audio/video URLs (e.g. samplelib.com/mp3/foo.mp3) | Downloaded to a tempfile and routed to the file handler (see `_download_url_to_tmp` in `graphs/source.py`) | Same as audio/video files | `media_processing_available` |
| YouTube URLs | content-core's transcript extractor | None (uses uploaded captions/transcripts, not audio) | — |
| Web pages | content-core URL extractors (Firecrawl → Jina → Crawl4AI → bs4) | Optional Crawl4AI for JS-heavy pages | `crawl4ai_available` |
| Password-protected PDFs / Office | — | Not supported; rejected with a clear message so the retry loop doesn't burn 15 attempts (see `_rewrite_extraction_error`) | — |
| Archives (`.zip / .tar / .gz`), email (`.eml / .msg`) | — | Not supported today; extraction is a separate follow-up branch (`feat/container-and-email-sources`) | — |

**Install ffmpeg** — see [docs/DEV_SETUP.md](../DEV_SETUP.md) §10. Shipped Docker images already include it (`Dockerfile` line 102, shared `runtime-base` stage).

## Chunking (`utils/chunking.py`)

Content is split with content-type-aware LangChain splitters (`HTMLHeaderTextSplitter`, `MarkdownHeaderTextSplitter`, `RecursiveCharacterTextSplitter`). Content type detection uses the file extension first; heuristics can override a PLAIN extension when confidence ≥ 0.8. Oversized chunks from the HTML/Markdown splitters get a secondary split.

**Why the 400-token default.** `OPEN_NOTEBOOK_CHUNK_SIZE` defaults to 400 tokens — ~20% below the 512-token ceiling of BERT-family embedders (e.g. `mxbai-embed-large`). The buffer absorbs three error sources: tokenizer mismatch (we measure with `o200k_base`, the embedder tokenizes with WordPiece), splitter overshoot, and special tokens. For embedders with large windows (OpenAI `text-embedding-3` family: 8191 tokens) raise it, e.g.:

```bash
export OPEN_NOTEBOOK_CHUNK_SIZE=1500
export OPEN_NOTEBOOK_CHUNK_OVERLAP=150
```

`OPEN_NOTEBOOK_CHUNK_OVERLAP` defaults to 15% of chunk size. Both are **token-based** (not characters), minimum chunk size 100, and require an app restart to take effect.

## Embedding (`utils/embedding.py`)

- `generate_embedding(text)` — unified entry point: short text (≤ chunk size) embeds directly; long text is chunked, each chunk embedded, and the results combined via **mean pooling** (normalize each → mean → normalize result, numpy).
- `generate_embeddings(texts)` — batch path used by `embed_source_command`: batches of 50 with per-batch retry, to stay under provider payload limits.
- Empty/whitespace-only input raises `ValueError` — which background commands treat as a permanent (non-retried) failure by design.
- The embedding model comes from `model_manager` (see [credentials.md](credentials.md) for how provider config is resolved).

**Who triggers embedding** (see also the domain rules in `open_notebook/AGENTS.md`):

| Content | Trigger |
|---|---|
| Note | `Note.save()` auto-submits `embed_note` |
| Insight | `create_insight_command` submits `embed_insight` |
| Source | explicit `source.vectorize()` → `embed_source` (NOT automatic on save) |
| Everything | `rebuild_embeddings_command` fans out individual jobs |

All embedding is fire-and-forget through the surreal-commands worker — nothing embeds if the worker isn't running.

## Context building (`utils/context_builder.py`)

The single implementation behind both context consumers:

- `build_notebook_context()` backs `POST /api/chat/context` (chat panel + podcast generation): it assembles source/note contexts from the inclusion config, whose status strings are matched textually ("not in" skips, "insights" → short context, "full content" → long context). Without a config, every source and note is included with its short context. Per-item failures are logged and skipped.
- `build_source_context()` backs the source-chat graph: one source's short context plus its insights, truncated to a token budget by dropping insights (last-fetched first).
- Every call re-fetches — there is no cache layer.
- Token counting uses `o200k_base` via tiktoken and is an estimate (±5-10% vs. the actual model); `token_count()` falls back to a coarse estimate if tiktoken is unavailable.

## Encryption (`utils/encryption.py`) {#encryption}

Field-level encryption for sensitive values (API keys) stored in the database, using Fernet (AES-128-CBC + HMAC-SHA256).

- Key source: `OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE` (Docker secrets) → `OPEN_NOTEBOOK_ENCRYPTION_KEY`. **No default** — credential storage is unavailable until the key is set.
- Any string works as key: it's derived to a Fernet key via SHA-256, lazily on first use.
- Decryption falls back gracefully: an `InvalidToken` (legacy unencrypted data) returns the original value, so pre-encryption databases keep working.
- Key rotation is **not implemented** — changing the key orphans previously encrypted values.

## Text utilities (`utils/text_utils.py`)

`clean_thinking_content()` strips `<think>…</think>` blocks from model output (extended-thinking models); used in every graph that consumes LLM responses. It handles malformed output (missing opening tag) and bypasses extraction for content > 100KB for performance.
