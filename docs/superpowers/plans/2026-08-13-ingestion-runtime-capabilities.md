# Ingestion Runtime Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make upload choices match the extraction capabilities actually available at runtime and surface actionable FFmpeg, Docling, and unsupported-archive errors.

**Architecture:** Extend the existing `/api/capabilities` contract rather than create another probing system. Keep `content-core.check_file_support()` as the authoritative per-file backend gate; use runtime capabilities only to decide which file categories the UI advertises before upload.

**Tech Stack:** Python runtime probes, FastAPI, content-core, Next.js/React, TanStack Query, Vitest, pytest.

## Global Constraints

- Do not add an archive extractor in this package; ZIP, TAR, and GZ remain unsupported.
- Images are advertised only when Docling is actually available.
- Audio/video are advertised only when both `ffprobe` and `ffmpeg` are executable by the API/worker environment.
- A configured Speech-to-Text model remains required for transcription.
- Do not add GPL/AGPL dependencies; FFmpeg installation and distribution must continue to follow `docs/LICENSE_COMPLIANCE.md`.

---

### Task 1: Report reliable media capability

**Files:**
- Modify: `open_notebook/utils/runtime_capabilities.py`
- Modify: `api/models.py:620-632`
- Modify: `api/routers/capabilities.py`
- Modify: `frontend/src/lib/types/api.ts:70-75`
- Test: `tests/test_runtime_capabilities.py`
- Test: `tests/test_capabilities_api.py`

**Interfaces:**
- Produces: `media_processing_available: boolean` from `GET /api/capabilities`.

- [ ] **Step 1: Write failing runtime-probe tests**

  Patch `shutil.which` and assert media processing is available only when both `ffmpeg` and `ffprobe` resolve.

- [ ] **Step 2: Implement the probe with the standard library**

  Add `media_processing_available()` using `shutil.which("ffmpeg")` and `shutil.which("ffprobe")`; do not execute uploads or spawn either binary during the capability request.

- [ ] **Step 3: Extend the API response and frontend type**

  Add `media_processing_available` to `CapabilitiesResponse`, the router response, and the TypeScript `Capabilities` interface.

- [ ] **Step 4: Verify capability tests**

  Run: `uv run pytest tests/test_runtime_capabilities.py tests/test_capabilities_api.py -q`

### Task 2: Make the upload picker capability-driven

**Files:**
- Modify: `frontend/src/components/sources/AddSourceDialog.tsx`
- Modify: `frontend/src/components/sources/steps/SourceTypeStep.tsx`
- Modify: all locale files under `frontend/src/lib/locales/`
- Create: `frontend/src/components/sources/steps/SourceTypeStep.test.tsx`

**Interfaces:**
- Consumes: `useCapabilities()` and the existing source form.
- Produces: an `accept` value containing base documents, conditional images, and conditional media; archives are never included.

- [ ] **Step 1: Write failing picker tests**

  Assert these three states:

  ```text
  Docling false, media false -> documents/text only
  Docling true, media false  -> documents/text + PNG/JPEG/TIFF
  Docling false, media true  -> documents/text + audio/video
  ```

  Assert `.zip`, `.tar`, and `.gz` are absent in every state.

- [ ] **Step 2: Pass capabilities into `SourceTypeStep`**

  Reuse `useCapabilities()` in `AddSourceDialog`; do not add another API client or state store.

- [ ] **Step 3: Build the native file-input `accept` string**

  Keep the existing base document extensions, append image extensions only for `docling_available`, and append audio/video extensions only for `media_processing_available`.

- [ ] **Step 4: Add actionable unavailable-runtime copy**

  Explain that image extraction requires optional Docling and media transcription requires FFmpeg plus an STT model. Keep ZIP/TAR/GZ out of the advertised list rather than promising extraction.

- [ ] **Step 5: Verify frontend behavior**

  Run: `npm run test -- SourceTypeStep.test.tsx`

### Task 3: Make worker failures actionable and non-retrying

**Files:**
- Modify: `open_notebook/graphs/source.py`
- Modify: `commands/source_commands.py`
- Test: `tests/characterization/test_source_ingestion_characterization.py`

- [ ] **Step 1: Write failing media-runtime tests**

  With media capability unavailable, assert processing raises a permanent validation/configuration error before calling `content_core.extract_content()` and does not consume the 15-attempt retry budget.

- [ ] **Step 2: Add the shared preflight**

  For detected audio/video uploads, return an actionable error naming missing FFmpeg/FFprobe. Preserve `check_file_support()` for MIME routing and the configured STT validation for transcription.

- [ ] **Step 3: Verify ingestion behavior**

  Run: `uv run pytest tests/characterization/test_source_ingestion_characterization.py tests/test_upload_type_mitigations.py -q`

### Task 4: Document and verify the Windows runtime

**Files:**
- Modify: `docs/DEV_SETUP.md`
- Modify: `docs/7-DEVELOPMENT/content-processing.md`

- [ ] **Step 1: Add a Windows verification command**

  Document `Get-Command ffmpeg, ffprobe` and state that both executables must resolve in the environment used to start the worker.

- [ ] **Step 2: Record Docling and archive behavior**

  Document that PNG/JPEG/TIFF require optional Docling and that ZIP/TAR/GZ are not source containers.

- [ ] **Step 3: Run final checks**

  Run backend focused tests, `npm run test -- SourceTypeStep.test.tsx`, and `npm run lint`.

- [ ] **Step 4: Commit**

  ```bash
  git add open_notebook/utils/runtime_capabilities.py api/models.py api/routers/capabilities.py open_notebook/graphs/source.py commands/source_commands.py tests/test_runtime_capabilities.py tests/test_capabilities_api.py tests/characterization/test_source_ingestion_characterization.py frontend/src/lib/types/api.ts frontend/src/components/sources/AddSourceDialog.tsx frontend/src/components/sources/steps/SourceTypeStep.tsx frontend/src/components/sources/steps/SourceTypeStep.test.tsx frontend/src/lib/locales docs/DEV_SETUP.md docs/7-DEVELOPMENT/content-processing.md
  git commit -m "fix: align source uploads with runtime capabilities"
  ```
