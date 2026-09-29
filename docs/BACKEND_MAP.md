# Backend Map

Locator for the FastAPI backend. Narrative architecture stays in [architecture](7-DEVELOPMENT/architecture.md). Normative rules stay in [`open_notebook/AGENTS.md`](../open_notebook/AGENTS.md). Longer recipes stay in [change playbooks](7-DEVELOPMENT/change-playbooks.md). This file is the one you use to find the file.

The master plan's "22 routers" and "15 migrations" are the fork-point counts. This tree mounts **26 routers** (159 operations) plus `GET /` and `GET /health`, and registers migrations **1–35**.

`api/routers/_chat_shared.py` is a helper for notebook chat and source chat. It is not a mounted router.

## Where do I change X?

| Change | Start here |
|---|---|
| An HTTP operation | The router table below, then that file. Schemas live in `api/models.py`. A new router file must be registered in `api/main.py`. |
| Who may see or edit a notebook, source, note, chat, or episode | `api/ownership.py` |
| Share grants | `api/routers/grants.py` |
| Sign-in, session, Entra | `api/auth/`. Operator detail: [AUTH.md](AUTH.md). |
| Notebook, source, note, insight, or chat-session records | `open_notebook/domain/notebook.py` |
| Users | `open_notebook/domain/user.py` |
| Groups and directory sync | `api/routers/groups.py`, `commands/entra_group_sync.py` |
| Credentials and encryption | `open_notebook/domain/credential.py`, `open_notebook/utils/encryption.py` |
| Which AI provider exists | `open_notebook/ai/provider_registry.py`, then `SupportedProvider` in `api/models.py`, then [PROVIDER_TERMS.md](PROVIDER_TERMS.md) |
| Which model a call uses | `provision_langchain_model()` and the `DefaultModels` singleton |
| Ask | `open_notebook/graphs/ask.py`, route `POST /api/search/ask` |
| Notebook chat | `open_notebook/graphs/chat.py`, `api/routers/chat.py` |
| Source chat | `open_notebook/graphs/source_chat.py`, `api/routers/source_chat.py` |
| Ingest a link, upload, or pasted text | `api/routers/sources.py` → `commands/source_commands.py` → `open_notebook/graphs/source.py` |
| SharePoint import | `api/routers/connectors.py`, `open_notebook/connectors/`, `commands/connector_commands.py` |
| Embeddings | `commands/embedding_commands.py` |
| Podcasts | `commands/podcast_commands.py`, `open_notebook/podcasts/models.py` |
| A schema change | Next file in `open_notebook/database/migrations/`, registered in `open_notebook/database/async_migrate.py` |
| A background job | `commands/`, submitted with `submit_command`. The worker must be running. |
| Content settings | `ContentSettings` via `api/routers/settings.py` |
| Text or vector search SQL | `fn::text_search` / `fn::vector_search` (current bodies are migrations 30 and 31) |

## Auth

`AuthMiddleware` (`api/auth/middleware.py`) runs before routing. These paths skip it: `/`, `/health`, `/docs`, `/openapi.json`, `/redoc`, `/api/auth/status`, `/api/auth/login`, `/api/auth/callback`, `/api/config`. Every other path gets a user when auth is enabled, and is open when auth is disabled.

Cookie sessions, and every request when `AUTH_PROVIDER=entra`, also fail closed on a bad `Origin` (`api/auth/csrf.py`, allowlist `CORS_ORIGINS`).

The Auth column means:

| Label | Meaning |
|---|---|
| public | Middleware skip list. |
| session | Middleware only. |
| user | Handler calls `require_user` (401 with no user, including when password auth is off). |
| admin | Handler calls `require_admin`. |
| admin if auth | `require_admin_if_auth`: open when auth is off, admin when auth is on. |
| session + owner ACL | Grant routes. `assert_can_manage_acl` runs in the handler or its helper. |

Notebooks, sources, notes, insights, chat, source chat, podcasts, search, and connector imports also call `api/ownership.py` inside the handler when auth is enabled. That check is not repeated on every row.

Credential routes never return API key values.

## Router catalog

Mounted from `api/main.py` under `/api`, except the embedding rebuild router which is mounted at `/api/embeddings`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/` | `root` | — | public |
| GET | `/health` | `health` | — | public |

### `auth`

File: `api/routers/auth.py`. Calls: `api.auth` provider + session cookie.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/auth/status` | `get_auth_status` | — | public |
| GET | `/api/auth/me` | `get_current_user` | — | user |
| POST | `/api/auth/logout` | `logout` | — | user |
| GET | `/api/auth/login` | `login` | — | public |
| GET | `/api/auth/callback` | `callback` | — | public |

### `connectors`

File: `api/routers/connectors.py`. Calls: `open_notebook.connectors`, `commands.connector_commands`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/connectors/sharepoint/import` | `import_sharepoint` | — | user |
| GET | `/api/connectors/sharepoint/batches` | `list_sharepoint_batches` | — | user |
| GET | `/api/connectors/sharepoint/batches/{batch_id}` | `get_sharepoint_batch` | — | user |
| POST | `/api/connectors/sharepoint/batches/{batch_id}/retry` | `retry_sharepoint_batch` | — | user |
| GET | `/api/connectors/sharepoint/status` | `sharepoint_status` | — | session |
| POST | `/api/connectors/sharepoint/connect` | `connect_sharepoint` | — | user |
| POST | `/api/connectors/sharepoint/disconnect` | `disconnect_sharepoint` | — | user |
| GET | `/api/connectors/sharepoint/callback` | `sharepoint_callback` | — | user |
| GET | `/api/connectors/sharepoint/sites` | `list_sharepoint_sites` | — | user |
| GET | `/api/connectors/sharepoint/sites/{site_id}/drives` | `list_sharepoint_drives` | — | user |
| GET | `/api/connectors/sharepoint/drives/{drive_id}/children` | `list_sharepoint_children` | — | user |

### `config`

File: `api/routers/config.py`. Calls: version info plus a SurrealDB health probe (`repo_query`). The frontend reads this; brand config is not served here.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/config` | `get_config` | — | public |

### `groups`

File: `api/routers/groups.py`. Calls: `repo_query` on `user_group` / `user_group_member`; `api.graph_client`; `commands.entra_group_sync`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/groups` | `list_groups` | `List[GroupResponse]` | user |
| POST | `/api/groups` | `create_group` | `GroupResponse` | admin |
| GET | `/api/groups/{group_id}` | `get_group` | `GroupResponse` | admin |
| PATCH | `/api/groups/{group_id}` | `update_group` | `GroupResponse` | admin |
| DELETE | `/api/groups/{group_id}` | `delete_group` | — | admin |
| GET | `/api/groups/{group_id}/members` | `list_members` | `List[GroupMemberResponse]` | admin |
| POST | `/api/groups/{group_id}/members` | `add_member` | `GroupMemberResponse` | admin |
| DELETE | `/api/groups/{group_id}/members/{user_id}` | `remove_member` | — | admin |
| GET | `/api/users` | `list_users_for_picker` | `List[UserPickerItem]` | user |
| GET | `/api/groups/entra/search` | `entra_group_search` | `List[EntraGroupCandidate]` | admin |
| POST | `/api/groups/entra/link` | `entra_group_link` | `GroupResponse` | admin |
| POST | `/api/groups/entra/sync` | `entra_group_sync_now` | — | admin |
| GET | `/api/users/directory` | `directory_user_search` | `List[DirectoryUserCandidate]` | user |
| POST | `/api/users/from-entra` | `stub_user_from_entra` | `UserPickerItem` | user |

### `grants`

File: `api/routers/grants.py`. Calls: `api.ownership.assert_can_manage_acl`, `Notebook`/`Source`, `resource_grant` via `repo_query`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/notebooks/{notebook_id}/grants` | `list_notebook_grants` | `List[GrantResponse]` | session + owner ACL |
| POST | `/api/notebooks/{notebook_id}/grants` | `create_notebook_grant` | `GrantResponse` | session + owner ACL |
| PATCH | `/api/notebooks/{notebook_id}/grants/{grant_id}` | `update_notebook_grant` | `GrantResponse` | session + owner ACL |
| DELETE | `/api/notebooks/{notebook_id}/grants/{grant_id}` | `delete_notebook_grant` | — | session + owner ACL |
| GET | `/api/sources/{source_id}/grants` | `list_source_grants` | `List[GrantResponse]` | session + owner ACL |
| POST | `/api/sources/{source_id}/grants` | `create_source_grant` | `GrantResponse` | session + owner ACL |
| PATCH | `/api/sources/{source_id}/grants/{grant_id}` | `update_source_grant` | `GrantResponse` | session + owner ACL |
| DELETE | `/api/sources/{source_id}/grants/{grant_id}` | `delete_source_grant` | — | session + owner ACL |

### `notebooks`

File: `api/routers/notebooks.py`. Calls: `open_notebook.domain.notebook.Notebook` (and source link/unlink).

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/notebooks` | `get_notebooks` | `List[NotebookResponse]` | session |
| GET | `/api/notebooks/library` | `get_notebooks_library` | `NotebookLibraryPageResponse` | session |
| POST | `/api/notebooks` | `create_notebook` | `NotebookResponse` | session |
| GET | `/api/recently-viewed` | `get_recently_viewed` | `List[RecentlyViewedResponse]` | session |
| GET | `/api/notebooks/{notebook_id}/delete-preview` | `get_notebook_delete_preview` | `NotebookDeletePreview` | session |
| GET | `/api/notebooks/{notebook_id}` | `get_notebook` | `NotebookResponse` | session |
| PUT | `/api/notebooks/{notebook_id}` | `update_notebook` | `NotebookResponse` | session |
| POST | `/api/notebooks/{notebook_id}/sources/{source_id}` | `add_source_to_notebook` | — | session |
| DELETE | `/api/notebooks/{notebook_id}/sources/{source_id}` | `remove_source_from_notebook` | — | session |
| DELETE | `/api/notebooks/{notebook_id}` | `delete_notebook` | `NotebookDeleteResponse` | session |

### `search`

File: `api/routers/search.py`. Calls: text + vector search, then `graphs.ask` for `/ask`; `api.ownership.filter_search_results_by_owner`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/search` | `search_knowledge_base` | `SearchResponse` | session |
| POST | `/api/search/ask` | `ask_knowledge_base` | — | session |
| POST | `/api/search/ask/simple` | `ask_knowledge_base_simple` | `AskResponse` | session |

### `models`

File: `api/routers/models.py`. Calls: `open_notebook.ai.models.Model`, `DefaultModels`, `ModelManager`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/models` | `get_models` | `List[ModelResponse]` | session |
| POST | `/api/models` | `create_model` | `ModelResponse` | admin if auth |
| DELETE | `/api/models/{model_id}` | `delete_model` | — | admin if auth |
| POST | `/api/models/{model_id}/test` | `test_model` | `ModelTestResponse` | session |
| GET | `/api/models/defaults` | `get_default_models` | `DefaultModelsResponse` | session |
| PUT | `/api/models/defaults` | `update_default_models` | `DefaultModelsResponse` | admin if auth |
| GET | `/api/models/providers` | `get_provider_availability` | `ProviderAvailabilityResponse` | session |
| GET | `/api/models/discover/{provider}` | `discover_models` | `List[DiscoveredModelResponse]` | session |
| POST | `/api/models/sync/{provider}` | `sync_models` | `ProviderSyncResponse` | admin if auth |
| POST | `/api/models/sync` | `sync_all_models` | `AllProvidersSyncResponse` | admin if auth |
| GET | `/api/models/count/{provider}` | `get_model_count` | `ProviderModelCountResponse` | session |
| GET | `/api/models/by-provider/{provider}` | `get_models_by_provider` | `List[ModelResponse]` | session |
| POST | `/api/models/auto-assign` | `auto_assign_defaults` | `AutoAssignResult` | admin if auth |

### `transformations`

File: `api/routers/transformations.py`. Calls: `open_notebook.domain.transformation.Transformation`, `DefaultPrompts`, `graphs.transformation`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/transformations` | `get_transformations` | `List[TransformationResponse]` | session |
| POST | `/api/transformations` | `create_transformation` | `TransformationResponse` | session |
| POST | `/api/transformations/execute` | `execute_transformation` | `TransformationExecuteResponse` | session |
| GET | `/api/transformations/default-prompt` | `get_default_prompt` | `DefaultPromptResponse` | session |
| PUT | `/api/transformations/default-prompt` | `update_default_prompt` | `DefaultPromptResponse` | session |
| POST | `/api/transformations/{transformation_id}/restore` | `restore_transformation` | `TransformationResponse` | session |
| GET | `/api/transformations/{transformation_id}` | `get_transformation` | `TransformationResponse` | session |
| PUT | `/api/transformations/{transformation_id}` | `update_transformation` | `TransformationResponse` | session |
| DELETE | `/api/transformations/{transformation_id}` | `delete_transformation` | — | session |

### `notes`

File: `api/routers/notes.py`. Calls: `open_notebook.domain.notebook.Note`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/notes` | `get_notes` | `List[NoteResponse]` | session |
| POST | `/api/notes` | `create_note` | `NoteResponse` | session |
| GET | `/api/notes/{note_id}` | `get_note` | `NoteResponse` | session |
| PUT | `/api/notes/{note_id}` | `update_note` | `NoteResponse` | session |
| DELETE | `/api/notes/{note_id}` | `delete_note` | — | session |

### `embedding`

File: `api/routers/embedding.py`. Calls: embedding service (one-shot embed).

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/embed` | `embed_content` | `EmbedResponse` | session |

### `embedding_rebuild`

File: `api/routers/embedding_rebuild.py`. Calls: `commands.embedding_commands.rebuild_embeddings`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/embeddings/rebuild` | `start_rebuild` | `RebuildResponse` | admin if auth |
| GET | `/api/embeddings/rebuild/{command_id}/status` | `get_rebuild_status` | `RebuildStatusResponse` | admin if auth |

### `settings`

File: `api/routers/settings.py`. Calls: `ContentSettings` singleton.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/settings` | `get_settings` | `SettingsResponse` | admin if auth |
| PUT | `/api/settings` | `update_settings` | `SettingsResponse` | admin if auth |

### `sources`

File: `api/routers/sources.py`. Calls: `Source`, `graphs.source`, `commands.source_commands`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/sources` | `get_sources` | `List[SourceListResponse]` | session |
| GET | `/api/sources/library` | `get_sources_library` | `SourceLibraryPageResponse` | session |
| POST | `/api/sources` | `create_source` | `SourceResponse` | session |
| POST | `/api/sources/json` | `create_source_json` | `SourceResponse` | session |
| GET | `/api/sources/{source_id}` | `get_source` | `SourceResponse` | session |
| HEAD | `/api/sources/{source_id}/download` | `check_source_file` | — | session |
| GET | `/api/sources/{source_id}/download` | `download_source_file` | — | session |
| GET | `/api/sources/{source_id}/status` | `get_source_status` | `SourceStatusResponse` | session |
| PUT | `/api/sources/{source_id}` | `update_source` | `SourceResponse` | session |
| POST | `/api/sources/{source_id}/retry` | `retry_source_processing` | `SourceResponse` | session |
| DELETE | `/api/sources/{source_id}` | `delete_source` | — | session |
| GET | `/api/sources/{source_id}/insights` | `get_source_insights` | `List[SourceInsightResponse]` | session |
| POST | `/api/sources/{source_id}/insights` | `create_source_insight` | `InsightCreationResponse` | session |

### `source_files`

File: `api/routers/source_files.py`. Calls: original-file policy + `commands.source_file_commands`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/source-files/policy` | `get_source_file_policy` | `SourceFilePolicyResponse` | session |
| GET | `/api/source-files/cleanup-preview` | `get_cleanup_preview` | `CleanupPreviewResponse` | admin for scope=all; owner for scope=mine when policy allows |
| POST | `/api/source-files/cleanup` | `submit_cleanup` | `CleanupSubmitResponse` | admin for scope=all; owner for scope=mine when policy allows |
| DELETE | `/api/sources/{source_id}/original-file` | `delete_source_original_file` | `SingleDeleteResponse` | admin, or owner when owner-cleanup is enabled |

### `insights`

File: `api/routers/insights.py`. Calls: `SourceInsight`; save-as-note creates a `Note`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/insights/{insight_id}` | `get_insight` | `SourceInsightResponse` | session |
| DELETE | `/api/insights/{insight_id}` | `delete_insight` | — | session |
| POST | `/api/insights/{insight_id}/save-as-note` | `save_insight_as_note` | `NoteResponse` | session |

### `commands`

File: `api/routers/commands.py`. Calls: `surreal_commands` job API.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/commands/jobs` | `execute_command` | `CommandJobResponse` | session |
| GET | `/api/commands/jobs/{job_id}` | `get_command_job_status` | `CommandJobStatusResponse` | session |
| GET | `/api/commands/jobs` | `list_command_jobs` | `List[Dict[str, Any]]` | session |
| DELETE | `/api/commands/jobs/{job_id}` | `cancel_command_job` | — | session |
| GET | `/api/commands/registry/debug` | `debug_registry` | — | session |

### `podcasts`

File: `api/routers/podcasts.py`. Calls: `commands.podcast_commands`, `PodcastEpisode`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/podcasts/generate` | `generate_podcast` | `PodcastGenerationResponse` | session |
| GET | `/api/podcasts/jobs/{job_id}` | `get_podcast_job_status` | — | session |
| GET | `/api/podcasts/episodes` | `list_podcast_episodes` | `List[PodcastEpisodeResponse]` | session |
| GET | `/api/podcasts/episodes/library` | `get_episodes_library` | `EpisodeLibraryPageResponse` | session |
| GET | `/api/podcasts/episodes/summary` | `get_episodes_summary` | `EpisodeSummaryResponse` | session |
| GET | `/api/podcasts/episodes/{episode_id}` | `get_podcast_episode` | `PodcastEpisodeResponse` | session |
| GET | `/api/podcasts/episodes/{episode_id}/audio` | `stream_podcast_episode_audio` | — | session |
| POST | `/api/podcasts/episodes/{episode_id}/retry` | `retry_podcast_episode` | — | session |
| DELETE | `/api/podcasts/episodes/{episode_id}` | `delete_podcast_episode` | — | session |

### `episode_profiles`

File: `api/routers/episode_profiles.py`. Calls: `EpisodeProfile`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/episode-profiles` | `list_episode_profiles` | `List[EpisodeProfileResponse]` | session |
| GET | `/api/episode-profiles/{profile_name}` | `get_episode_profile` | `EpisodeProfileResponse` | session |
| POST | `/api/episode-profiles` | `create_episode_profile` | `EpisodeProfileResponse` | session |
| PUT | `/api/episode-profiles/{profile_id}` | `update_episode_profile` | `EpisodeProfileResponse` | session |
| DELETE | `/api/episode-profiles/{profile_id}` | `delete_episode_profile` | — | session |
| POST | `/api/episode-profiles/{profile_id}/duplicate` | `duplicate_episode_profile` | `EpisodeProfileResponse` | session |

### `speaker_profiles`

File: `api/routers/speaker_profiles.py`. Calls: `SpeakerProfile`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/speaker-profiles` | `list_speaker_profiles` | `List[SpeakerProfileResponse]` | session |
| GET | `/api/speaker-profiles/{profile_name}` | `get_speaker_profile` | `SpeakerProfileResponse` | session |
| POST | `/api/speaker-profiles` | `create_speaker_profile` | `SpeakerProfileResponse` | session |
| PUT | `/api/speaker-profiles/{profile_id}` | `update_speaker_profile` | `SpeakerProfileResponse` | session |
| DELETE | `/api/speaker-profiles/{profile_id}` | `delete_speaker_profile` | — | session |
| POST | `/api/speaker-profiles/{profile_id}/duplicate` | `duplicate_speaker_profile` | `SpeakerProfileResponse` | session |

### `chat`

File: `api/routers/chat.py`. Calls: `ChatSession`, `graphs.chat`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/chat/sessions` | `get_sessions` | `List[ChatSessionResponse]` | session |
| POST | `/api/chat/sessions` | `create_session` | `ChatSessionResponse` | session |
| GET | `/api/chat/sessions/{session_id}` | `get_session` | `ChatSessionWithMessagesResponse` | session |
| PUT | `/api/chat/sessions/{session_id}` | `update_session` | `ChatSessionResponse` | session |
| DELETE | `/api/chat/sessions/{session_id}` | `delete_session` | `SuccessResponse` | session |
| POST | `/api/chat/execute` | `execute_chat` | `ExecuteChatResponse` | session |
| POST | `/api/chat/context` | `build_context` | `BuildContextResponse` | session |

### `source_chat`

File: `api/routers/source_chat.py`. Calls: source chat sessions, `graphs.source_chat`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| POST | `/api/sources/{source_id}/chat/sessions` | `create_source_chat_session` | `SourceChatSessionResponse` | session |
| GET | `/api/sources/{source_id}/chat/sessions` | `get_source_chat_sessions` | `List[SourceChatSessionResponse]` | session |
| GET | `/api/sources/{source_id}/chat/sessions/{session_id}` | `get_source_chat_session` | `SourceChatSessionWithMessagesResponse` | session |
| PUT | `/api/sources/{source_id}/chat/sessions/{session_id}` | `update_source_chat_session` | `SourceChatSessionResponse` | session |
| DELETE | `/api/sources/{source_id}/chat/sessions/{session_id}` | `delete_source_chat_session` | `SuccessResponse` | session |
| POST | `/api/sources/{source_id}/chat/sessions/{session_id}/messages` | `send_message_to_source_chat` | — | session |

### `credentials`

File: `api/routers/credentials.py`. Calls: `api.credentials_service`, `Credential` (keys never returned).

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/credentials/status` | `get_status` | — | admin if auth |
| GET | `/api/credentials/env-status` | `get_env_status` | — | admin if auth |
| GET | `/api/credentials` | `list_credentials` | `List[CredentialResponse]` | admin if auth |
| GET | `/api/credentials/by-provider/{provider}` | `list_credentials_by_provider` | `List[CredentialResponse]` | admin if auth |
| POST | `/api/credentials` | `create_credential` | `CredentialResponse` | admin if auth |
| GET | `/api/credentials/{credential_id}` | `get_credential` | `CredentialResponse` | admin if auth |
| PUT | `/api/credentials/{credential_id}` | `update_credential` | `CredentialResponse` | admin if auth |
| DELETE | `/api/credentials/{credential_id}` | `delete_credential` | `CredentialDeleteResponse` | admin if auth |
| POST | `/api/credentials/{credential_id}/test` | `test_credential` | — | admin if auth |
| POST | `/api/credentials/{credential_id}/discover` | `discover_models_for_credential` | `DiscoverModelsResponse` | admin if auth |
| POST | `/api/credentials/{credential_id}/register-models` | `register_models_for_credential` | `RegisterModelsResponse` | admin if auth |
| POST | `/api/credentials/migrate-from-provider-config` | `migrate_from_provider_config` | — | admin if auth |
| POST | `/api/credentials/migrate-from-env` | `migrate_from_env` | — | admin if auth |

### `providers`

File: `api/routers/providers.py`. Calls: `open_notebook.ai.provider_registry.PROVIDERS`.

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/providers` | `list_providers` | `List[ProviderInfoResponse]` | session |

### `capabilities`

File: `api/routers/capabilities.py`. Calls: `runtime_capabilities` (docling, crawl4ai, media).

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/capabilities` | `get_capabilities` | `CapabilitiesResponse` | session |

### `languages`

File: `api/routers/languages.py`. Calls: read-only `pycountry` list (do not modify or vendor it).

| Method | Path | Handler | Response | Auth |
|---|---|---|---|---|
| GET | `/api/languages` | `list_languages` | `List[LanguageResponse]` | session |


## Domain models

`ObjectModel` (`open_notebook/domain/base.py`) is the row base: `id`, `created`, `updated`, `save`, `get`, `get_all`, `delete`, `relate`. `get()` is polymorphic on the record-id prefix, so the subclass must be imported first. `relate(edge, target)` writes a graph edge. The edge name must match the schema.

`RecordModel` is a singleton addressed by `record_id`. Call `clear_instance()` in tests. `DefaultModels.get_instance()` bypasses that cache on purpose.

`Source.save()` does not embed. Call `source.vectorize()` (submits `embed_source`). `Note.save()` submits `embed_note`.

### Records

| Class | Table | Fields beyond id/created/updated | Written by |
|---|---|---|---|
| `Notebook` | `notebook` | `name`, `description`, `archived`, `last_viewed_at`, `user_id`, `client_id` | `api/routers/notebooks.py` |
| `Source` | `source` | `asset` (`Asset`), `title`, `topics`, `full_text`, `last_viewed_at`, `user_id`, `client_id`, `command` | sources router, source graph, connector import |
| `Asset` | (embedded on `source`) | `file_path`, `url`, original-file store/key/etag/profile/container, filename, size, retention action and deletion stamps | source create / original-file store |
| `SourceEmbedding` | `source_embedding` | class surface is `content`; table also has `source`, `order`, `embedding` | `embed_source` |
| `SourceInsight` | `source_insight` | `insight_type`, `content`; table also has `source` and `embedding` | transformations, insight routes |
| `Note` | `note` | `title`, `note_type` (`human` or `ai`), `content` | `api/routers/notes.py` |
| `ChatSession` | `chat_session` | `title`, `model_override` | chat and source-chat routers |
| `User` | `user` | `email`, `display_name`, `entra_oid`, `role` (`admin` or `user`), `client_id` | auth callback, directory stub |
| `Credential` | `credential` | `name`, `provider`, `modalities`, encrypted `api_key`, endpoint/base_url/api_version fields, `project`, `location`, `credentials_path`, flexible `config` | credentials router |
| `Model` | `model` | `name`, `provider`, `type`, `credential` | models router |
| `Transformation` | `transformation` | `name`, `title`, `description`, `prompt`, `apply_default`, `model_id`, `user_id`, `is_builtin`, `deleted_at` | transformations router |
| `EpisodeProfile` | `episode_profile` | `name`, `description`, `speaker_config`, `outline_llm`, `transcript_llm`, `language`, `default_briefing`, `num_segments`, `max_tokens` | episode-profiles router |
| `SpeakerProfile` | `speaker_profile` | `name`, `description`, `voice_model`, `speakers` (1–4; each needs `name`, `voice_id`, `backstory`, `personality`) | speaker-profiles router |
| `PodcastEpisode` | `episode` | `name`, `episode_profile`, `speaker_profile`, `briefing`, `content`, `audio_file`, `transcript`, `outline`, `command`, `user_id`, `client_id`, `notebook_id` | `generate_podcast` |
| `ConnectorConnection` | `connector_connection` | `user_id`, `provider`, encrypted `token_cache`, `granted_scopes`, external tenant/account, `status`, connect/disconnect times | SharePoint connect |
| `ConnectorBatch` | `connector_batch` | owner, connection, drive/folder/items, notebooks, transformations, `embed`, `retry_failed_only`, status counts, `command_id`, `error` | SharePoint import |
| `ConnectorBatchDocument` | `connector_batch_document` | owner, batch, drive item, `etag`, `source_id`, `command_id`, `status`, `error` | SharePoint import |
| `ConnectorRemoteVersion` | `connector_remote_version` | owner, connection, drive item, `etag`, `source_id`, claim/lease | SharePoint import |

### Singletons

| Class | Record id | What it holds |
|---|---|---|
| `DefaultModels` | `open_notebook:default_models` | chat, transformation, large-context, TTS, STT, embedding, tools |
| `DefaultPrompts` | `open_notebook:default_prompts` | `transformation_instructions` |
| `ContentSettings` | `open_notebook:content_settings` | doc/url engines, embedding default, original-file policy, docling flags, YouTube languages |
| `ProviderConfig` | provider-config singleton | legacy `credentials` bag; live keys live on `Credential` |

### Edges

| Edge | Direction | Created by |
|---|---|---|
| `reference` | `source` → `notebook` | `Source.add_to_notebook`. Unique on the pair (migration 29). |
| `artifact` | `note` → `notebook` | `Note.add_to_notebook` |
| `refers_to` | `chat_session` → `notebook` or `source` | `ChatSession.relate_to_notebook` / `relate_to_source` |

Deleting a `source` fires the `source_delete` event, which deletes that source's `source_embedding` and `source_insight` rows.

Tables with no `ObjectModel` (reached through `repo_query`): `user_group`, `user_group_member`, `resource_grant`, `auth_session`, `oauth_state`, `connector_oauth_state`, `original_upload_operation`.

## AI orchestration

Every graph node that calls a model goes through `provision_langchain_model()`. Above 105,000 tokens that upgrades to `large_context_model`. Missing model configuration raises `ConfigurationError` (HTTP 422). Extended-thinking text is stripped with `clean_thinking_content()` before the answer is stored. LLM failures go through `classify_error()`.

`graphs/tools.py` is shared helpers, not a graph.

| Graph | State | Steps | Model | Output | Called from |
|---|---|---|---|---|---|
| `graphs/ask.py` | `ThreadState` | `agent` → `trigger_queries` → `provide_answer` → `write_final_answer` | defaults via `provision_langchain_model` | `final_answer` | `POST /api/search/ask` and `/ask/simple` |
| `graphs/chat.py` | `ThreadState` | `agent` | same; checkpoint is SqliteSaver at `data/sqlite-db/checkpoints.sqlite` | assistant message | `POST /api/chat/execute` |
| `graphs/source_chat.py` | `SourceChatState` | `source_chat_agent` (builds source context, then one model call) | same; own SqliteSaver checkpoint | assistant message | `POST /api/sources/{id}/chat/sessions/{id}/messages` |
| `graphs/source.py` | `SourceState` | `content_process` (content-core extract) → `save_source` → optional `transform_content` | extraction engines from `ContentSettings`; transforms use the transformation graph | saved `Source` plus insight rows | `process_source` command |
| `graphs/transformation.py` | `TransformationState` | `agent` (`run_transformation`) | transformation's `model_id`, else the default transformation model | insight text | source graph, `run_transformation` command, `POST /api/transformations/execute` |
| `graphs/prompt.py` | `PatternChainState` | `agent` | prompt's model | generated text | `POST /api/notes` when the note is AI-generated |

## Data layer

`open_notebook/database/repository.py` is the only DB door. There is no pool: each call opens a connection and closes it. Identifiers that cannot be query parameters (`RELATE` table names) are checked against `^[a-zA-Z_][a-zA-Z0-9_]*$`.

| Function | Role |
|---|---|
| `repo_query` | Arbitrary SurrealQL with bound parameters |
| `repo_create` / `repo_insert` | Insert a row |
| `repo_update` / `repo_upsert` | Update a row |
| `repo_delete` | Delete a record id |
| `repo_relate` | `RELATE` an edge |
| `ensure_record_id` | Normalize `table:id` strings |

Domain methods call these. Routers that touch groups, grants, and connector rows call `repo_query` directly because those tables have no `ObjectModel`.

Connection settings: `SURREAL_URL`, `SURREAL_USER`, `SURREAL_PASSWORD`, `SURREAL_NAMESPACE`, `SURREAL_DATABASE`.

### Migrations

Files are `open_notebook/database/migrations/N.surrealql` and `N_down.surrealql`. `AsyncMigrationManager` lists them by hand. They run on API startup and are recorded in `_sbl_migrations`. The next migration is **36**.

| # | What it introduces |
|---|---|
| 1 | `source`, `note`, `notebook`, `reference`, `artifact`; BM25 analyzer `my_analyzer`; `fn::text_search` / `fn::vector_search`; `source_delete` event |
| 2 | `note.note_type` |
| 3 | `chat_session`; vector search gains `min_similarity` |
| 4 | text-search function rewrite |
| 5 | remove seeded `open_notebook:default_transformations` |
| 6 | rename model provider `vertexai` → `vertex` |
| 7 | `episode_profile`, `speaker_profile`, `episode` |
| 8 | `refers_to` edge |
| 9 | vector-search function rewrite |
| 10 | indexes from insights and embeddings back to `source` |
| 11 | `open_notebook:provider_configs` seed |
| 12 | `credential` table |
| 13 | `source_insight.embedding` optional |
| 14 | episode outline provider field |
| 15 | flexible `credential.config` |
| 16 | `episode_profile.max_tokens` |
| 17 | `transformation.model_id` |
| 18 | `last_viewed_at` on notebook and source |
| 19 | timestamps on `source_insight` |
| 20 | `speaker_config` may be a speaker-profile record |
| 21 | strip a prefix from `episode.audio_file` |
| 22 | backfill episode-profile model record ids |
| 23 | `content_settings.docling_formulas` default |
| 24 | `user`, `auth_session` |
| 25 | `oauth_state` |
| 26 | `episode.user_id` |
| 27 | `transformation.user_id` |
| 28 | `user_group`, `user_group_member`, `resource_grant` |
| 29 | dedupe `reference` pairs; unique index |
| 30 | text and vector search accept `notebook_ids` |
| 31 | text-search follow-up |
| 32 | connector connection, oauth state, batch, batch document |
| 33 | `connector_connection.token_cache` |
| 34 | `connector_batch.retry_failed_only`; remote-version identity index |
| 35 | `original_upload_operation` |

SurrealDB features this schema actually uses: schemeful tables, a search analyzer with BM25 indexes, `array<float>` embeddings queried by `fn::vector_search`, one `DEFINE EVENT`, unique indexes, and flexible objects. Do not assume an HNSW index; the vector path is the function above.

## Background jobs

The API submits jobs with `submit_command` from `surreal-commands`. The worker (`make worker-start`, module `commands`) runs them. Without the worker, jobs stay queued. Retry uses a blocklist: raise `ValueError` for a permanent failure. Anything else retries, except commands that set `max_attempts: 1`.

| Command | Module | Retries | What it does |
|---|---|---|---|
| `process_source` | `commands/source_commands.py` | default | Run `graphs/source.py` for one source |
| `run_transformation` | `commands/source_commands.py` | default | Run one transformation against a source |
| `embed_note` | `commands/embedding_commands.py` | embed retry | Embed a note |
| `embed_insight` | `commands/embedding_commands.py` | embed retry | Embed an insight |
| `embed_source` | `commands/embedding_commands.py` | embed retry | Chunk and embed a source |
| `create_insight` | `commands/embedding_commands.py` | embed retry | Create an insight, then submit `embed_insight` |
| `rebuild_embeddings` | `commands/embedding_commands.py` | none | Fan out embed jobs for existing rows |
| `generate_podcast` | `commands/podcast_commands.py` | `max_attempts: 1` | Build one episode. Retry is `POST /api/podcasts/episodes/{id}/retry` |
| `import_sharepoint_batch` | `commands/connector_commands.py` | `max_attempts: 1` | Import a SharePoint selection |
| `sync_entra_groups` | `commands/entra_group_sync.py` | `max_attempts: 1` | Diff Entra group membership into local groups |
| `cleanup_original_files` | `commands/source_file_commands.py` | default | Delete retained originals in scope |
| `reconcile_original_uploads` | `commands/source_file_commands.py` | default | Finish original-upload bookkeeping. Not submitted on API startup |

Job HTTP surface: `api/routers/commands.py` (`/api/commands/jobs`). Podcast and rebuild status have their own routes.

Concurrency: `OPEN_NOTEBOOK_WORKER_MAX_TASKS` (default 5), read when the worker starts.

## Config and secrets

Defaults and operator wording: [environment reference](5-CONFIGURATION/environment-reference.md) and [`.env.example`](../.env.example). Names below are the ones that reference lists. Two more are read by `open_notebook/utils/chunking.py` and are not in that reference: `OPEN_NOTEBOOK_CHUNK_SIZE` (default 400 tokens) and `OPEN_NOTEBOOK_CHUNK_OVERLAP` (default 15% of the chunk size). Restart after either change.

Credential encryption (`open_notebook/utils/encryption.py`): `OPEN_NOTEBOOK_ENCRYPTION_KEY` is any string. A Fernet key is derived with SHA-256. Docker may supply `OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE` instead (`get_secret_from_env` checks `VAR_FILE`, then `VAR`). `encrypt_value` / `decrypt_value` wrap credential API keys. Losing or rotating the key makes stored credentials unreadable. Endpoints never return the plaintext key.

`provision_provider_keys()` is the env-var fallback when a model has no credential row, and it writes into `os.environ`.

Provider key names are the env fallback only. The supported path is a `Credential` row.

Variable names from the environment reference (defaults live there):

`API_URL`, `INTERNAL_API_URL`, `API_CLIENT_TIMEOUT`, `OPEN_NOTEBOOK_PASSWORD`, `OPEN_NOTEBOOK_ENCRYPTION_KEY`, `FRONTEND_BIND_HOST`, `API_HOST`, `OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB`, `BRAND_CONFIG_PATH`, `AUTH_PROVIDER`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`, `AUTH_ADMIN_EMAILS`, `AUTH_COOKIE_SECURE`, `AUTH_SESSION_HOURS`, `ENTRA_PROMPT`, `CLIENT_ID`, `ENTRA_GROUP_SYNC_ENABLED`, `ENTRA_GROUP_SYNC_INTERVAL_MINUTES`, `SHAREPOINT_CONNECTOR_REDIRECT_URI`, `OPEN_NOTEBOOK_ORIGINAL_FILE_STORE`, `SHAREPOINT_STORAGE_PROFILE_ID`, `SHAREPOINT_STORAGE_TENANT_ID`, `SHAREPOINT_STORAGE_CLIENT_ID`, `SHAREPOINT_STORAGE_CLIENT_SECRET`, `SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH`, `SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE`, `SHAREPOINT_STORAGE_CONTAINER_ID`, `SHAREPOINT_STORAGE_PROFILES_FILE`, `SURREAL_URL`, `SURREAL_USER`, `SURREAL_PASSWORD`, `SURREAL_NAMESPACE`, `SURREAL_DATABASE`, `SURREAL_COMMANDS_RETRY_ENABLED`, `SURREAL_COMMANDS_RETRY_MAX_ATTEMPTS`, `SURREAL_COMMANDS_RETRY_WAIT_STRATEGY`, `SURREAL_COMMANDS_RETRY_WAIT_MIN`, `SURREAL_COMMANDS_RETRY_WAIT_MAX`, `OPEN_NOTEBOOK_WORKER_MAX_TASKS`, `ESPERANTO_LLM_TIMEOUT`, `ESPERANTO_SSL_VERIFY`, `ESPERANTO_SSL_CA_BUNDLE`, `OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE`, `OPEN_NOTEBOOK_MIN_CHUNK_SIZE`, `CORS_ORIGINS`, `TTS_BATCH_SIZE`, `ESPERANTO_TTS_TIMEOUT`, `FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL`, `CCORE_FIRECRAWL_PROXY`, `CCORE_FIRECRAWL_WAIT_FOR`, `JINA_API_KEY`, `CRAWL4AI_API_URL`, `CRAWL4AI_API_TOKEN`, `OPEN_NOTEBOOK_ENABLE_DOCLING`, `OPEN_NOTEBOOK_ENABLE_CRAWL4AI`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_ENDPOINT`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_BASE_URL`, `VERTEX_PROJECT`, `VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `OLLAMA_API_BASE`, `OMLX_API_BASE`, `OMLX_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `VOYAGE_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL_LLM`, `OPENAI_COMPATIBLE_API_KEY_LLM`, `OPENAI_COMPATIBLE_BASE_URL_EMBEDDING`, `OPENAI_COMPATIBLE_API_KEY_EMBEDDING`, `OPENAI_COMPATIBLE_BASE_URL_STT`, `OPENAI_COMPATIBLE_API_KEY_STT`, `OPENAI_COMPATIBLE_BASE_URL_TTS`, `OPENAI_COMPATIBLE_API_KEY_TTS`, `DASHSCOPE_API_KEY`, `MINIMAX_API_KEY`, `NOVITA_API_KEY`, `PPQ_API_KEY`, `COHERE_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_API_KEY_LLM`, `AZURE_OPENAI_ENDPOINT_LLM`, `AZURE_OPENAI_API_VERSION_LLM`, `AZURE_OPENAI_API_KEY_EMBEDDING`, `AZURE_OPENAI_ENDPOINT_EMBEDDING`, `AZURE_OPENAI_API_VERSION_EMBEDDING`


## How do I add an endpoint?

1. Add the request and response models in `api/models.py` (`<Feature>Request`, `<Feature>Response`).
2. Add the operation on the existing router in `api/routers/<resource>.py`. Keep the function thin: validate, call a service or domain method, return the model.
3. Put logic in `api/<resource>_service.py` or on the domain model. Do not grow the router into a second service.
4. If the file is new, `app.include_router(...)` in `api/main.py`.
5. If the resource is owner-scoped, call the existing helper in `api/ownership.py`.
6. User-supplied URLs go through `validate_url()` (`open_notebook/utils/url_validation.py`).
7. Raise typed errors from `open_notebook.exceptions`, not a bare `HTTPException`, for domain failures.
8. Add an API test for the status and the auth rule.
9. Frontend, if any: types, `src/lib/api`, a hook, then the component. See the change playbook for that half.

## How do I add a domain model and migration?

1. Subclass `ObjectModel` (or `RecordModel` for a singleton). Set `table_name`. Import the class before any polymorphic `get()`.
2. Add `N.surrealql` and `N_down.surrealql`. `N` is one higher than the last file registered in `AsyncMigrationManager` (currently 35, so 36).
3. Register both files in `open_notebook/database/async_migrate.py`. They are not auto-discovered.
4. Map fields on the Pydantic model to the `DEFINE FIELD` lines. Edge tables use `TYPE RELATION FROM … TO …`, and `relate()` must use that edge name.
5. Restart the API and confirm the migration log line. One migration per change that needs one; do not renumber a migration that has already run.

## How do I add a provider?

1. Add the provider to `open_notebook/ai/provider_registry.py`. Order in that registry is the UI order. `GET /api/providers` serves it.
2. Add the same name to the `SupportedProvider` literal in `api/models.py`. `tests/test_credential_provider_validation.py` fails if the two lists diverge.
3. Add the legal review to [PROVIDER_TERMS.md](PROVIDER_TERMS.md) before the product can call it.
4. Do not add a GPL or AGPL dependency to reach the provider. See [LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md).

## How do I add a background job?

1. In `commands/<name>_commands.py`, define a `CommandInput` and a `CommandOutput`. Decorate the coroutine with `@command("<name>", app="open_notebook", retry=...)`.
2. Raise `ValueError` when the failure is permanent. Use `retry={"max_attempts": 1}` when a retry would duplicate the work (podcasts and SharePoint import do this).
3. Submit with `submit_command("open_notebook", "<name>", payload)` from the router or domain method. Return the command id; do not wait.
4. Make the body safe to run twice unless you set `max_attempts: 1`.
5. Expose status through `GET /api/commands/jobs/{job_id}` or a dedicated status route.
6. Run the worker. A submit with no worker never executes.

## How do I add a source type?

Built-in create types are `link`, `upload`, and `text`, branched in `api/routers/sources.py`. All three enter `graphs/source.py` (`content_process` → `save_source` → optional transformations) via `process_source`.

- A new **file or URL format** is an extraction concern: content-core and the doc/url engines on `ContentSettings` (`auto`, `docling`, `simple`, `firecrawl`, `jina`, `crawl4ai`). Do not add a parallel extractor in the router. Do not add PyMuPDF or poppler.
- A new **place that holds many documents** (the SharePoint shape) implements `SourceConnector` in `open_notebook/connectors/` (`authenticate`, `list_documents`, `fetch_document`) and a command that feeds each file into the existing source pipeline. Copy the boundary in `commands/connector_commands.py`, not the Graph calls.

## Keeping this map true

`tests/test_backend_map.py` fails if a mounted route, a router module, a migration number, a playbook heading, or an environment-reference variable is missing from this file.
