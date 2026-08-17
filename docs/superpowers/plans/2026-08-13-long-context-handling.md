# Long-Context Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent avoidable model context-window failures and give users a clear recovery path when selected notebook/source context is too large.

**Architecture:** Keep the existing token estimator and model provisioning path. Add an optional per-language-model input limit, resolve the effective model before execution, compare estimated input plus reserved output against that limit, and return structured context status for the existing context indicator and error handling.

**Tech Stack:** Pydantic/FastAPI, LangChain model provisioning, tiktoken estimates, React, TanStack Query, pytest, Vitest.

## Global Constraints

- Token counts remain estimates and must be labelled as such.
- Never silently discard user-selected notebook context.
- Source-chat's existing bounded context may truncate explicitly and must continue to disclose that behavior.
- If a model limit is unknown, preserve execution and classify provider errors rather than invent a limit.
- Preserve provider choice and the existing large-context fallback above 105,000 estimated tokens until the replacement is verified.

---

### Task 1: Characterize current context selection and failures

**Files:**
- Create: `tests/test_context_limits.py`
- Modify: `tests/test_context_endpoint_characterization.py`
- Create: `frontend/src/components/common/ContextIndicator.test.tsx`

- [ ] **Step 1: Lock current token estimation**

  Assert `POST /api/chat/context` returns deterministic positive `token_count` and `char_count` for selected full sources, insights-only sources, excluded sources, and notes.

- [ ] **Step 2: Lock provider-error recovery messages**

  Cover context-length and HTTP 413 provider errors through `classify_error()` and assert internal payloads and stack traces are not returned.

- [ ] **Step 3: Run characterization tests**

  Run: `uv run pytest tests/test_context_limits.py tests/test_context_endpoint_characterization.py -q`

### Task 2: Store an optional language-model input limit

**Files:**
- Modify: `open_notebook/ai/models.py`
- Modify: `api/models.py`
- Modify: `api/routers/models.py`
- Modify: `frontend/src/lib/types/models.ts`
- Modify: `frontend/src/lib/api/models.ts`
- Modify: `frontend/src/components/settings/CredentialItem.tsx`
- Create: `frontend/src/components/settings/ModelContextWindowDialog.tsx`
- Modify: all locale files under `frontend/src/lib/locales/`
- Test: `tests/test_models_api.py`

**Interfaces:**
- Produces: `context_window_tokens: int | None` for language models; `None` means unknown and does not block execution.

- [ ] **Step 1: Write failing model round-trip tests**

  Assert a positive integer is saved and returned, zero/negative values are rejected, and missing values remain `None`.

- [ ] **Step 2: Add the optional model field and update endpoint**

  Persist `context_window_tokens` with the existing model record, expose it through current create/list/get contracts, and add `PUT /api/models/{model_id}` for this field. Extend the existing `modelsApi` instead of adding another client. Do not add a provider-specific lookup table.

- [ ] **Step 3: Add the settings input**

  Add a small `ModelContextWindowDialog` opened from each registered language model in `CredentialItem`. It edits one model at a time and explains that users should enter the provider/model limit and leave it blank when unknown.

- [ ] **Step 4: Verify model tests and locale parity**

  Run: `uv run pytest tests/test_models_api.py -q` and `npm run test -- src/lib/locales/index.test.ts`.

### Task 3: Add shared context-budget evaluation

**Files:**
- Create: `open_notebook/ai/context_budget.py`
- Modify: `open_notebook/ai/provision.py`
- Modify: `api/routers/chat.py`
- Test: `tests/test_context_limits.py`

**Interfaces:**
- Produces:

  ```python
  @dataclass(frozen=True)
  class ContextBudget:
      estimated_input_tokens: int
      reserved_output_tokens: int
      context_window_tokens: int | None
      status: Literal["unknown", "within_limit", "near_limit", "over_limit"]
  ```

- [ ] **Step 1: Write boundary tests**

  Cover unknown limit, within limit, 90% near-limit threshold, exact limit, and over-limit using `estimated_input_tokens + reserved_output_tokens`.

- [ ] **Step 2: Implement the pure evaluator**

  Keep it provider-agnostic and side-effect free. Unknown limits return `unknown`; they never reject execution.

- [ ] **Step 3: Resolve effective model before enforcing**

  Reuse `ModelManager` selection rules, including explicit override and large-context fallback. Reject only `over_limit`, using the existing typed exception path and a message telling the user to reduce full-content selections, use insights, start a new session, or select a larger-context model.

- [ ] **Step 4: Extend the context response**

  Add optional `context_window_tokens` and `context_status` to `BuildContextResponse` without removing existing fields.

- [ ] **Step 5: Verify backend context behavior**

  Run: `uv run pytest tests/test_context_limits.py tests/test_context_endpoint_characterization.py tests/test_models_api.py -q`

### Task 4: Show warning and recovery in the workbench

**Files:**
- Modify: `frontend/src/lib/types/api.ts`
- Modify: `frontend/src/lib/hooks/use-notebook-chat.ts`
- Modify: `frontend/src/components/common/ContextIndicator.tsx`
- Modify: all locale files under `frontend/src/lib/locales/`
- Test: `frontend/src/components/common/ContextIndicator.test.tsx`

- [ ] **Step 1: Add failing indicator tests**

  Assert normal, near-limit warning, over-limit error, and unknown-limit states. The over-limit state must explain how to recover and must not rely on color alone.

- [ ] **Step 2: Render status beside the existing estimate**

  Reuse `ContextIndicator`; do not create a second banner. Keep source/insight/note counts and add concise warning/error text with an accessible icon.

- [ ] **Step 3: Disable send only for confirmed over-limit context**

  Unknown limits and near-limit warnings still allow sending. Confirmed over-limit context blocks sending until selections or the model change.

- [ ] **Step 4: Verify frontend and final integration**

  Run: `npm run test -- ContextIndicator.test.tsx`, `npm run lint`, and the focused backend tests from Task 3.

- [ ] **Step 5: Commit**

  ```bash
  git add open_notebook/ai/context_budget.py open_notebook/ai/models.py open_notebook/ai/provision.py api/models.py api/routers/models.py api/routers/chat.py tests/test_context_limits.py tests/test_context_endpoint_characterization.py tests/test_models_api.py frontend/src/lib/types frontend/src/lib/api/models.ts frontend/src/lib/hooks/use-notebook-chat.ts frontend/src/components/common/ContextIndicator.tsx frontend/src/components/common/ContextIndicator.test.tsx frontend/src/components/settings/CredentialItem.tsx frontend/src/components/settings/ModelContextWindowDialog.tsx frontend/src/lib/locales
  git commit -m "feat: add model-aware context budget handling"
  ```
