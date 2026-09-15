"""Original-upload retention policy — types and pure resolver.

The retention decision has three orthogonal inputs:

- The administrator's installation-wide ``OriginalFilePolicy`` — one of
  ``always_keep``, ``user_choice``, or ``always_delete``.
- The administrator's ``default_action`` used when policy is
  ``user_choice`` and the source owner does not specify a preference.
- The source owner's optional ``requested_action`` at upload time.

The resolver is pure — no I/O, no settings lookup — so it can be called
from tests, from an upload route, and from an internal audit without
concern about coupling to ``ContentSettings`` loading.

Snapshot semantics: the effective action is persisted on the source's
asset at upload time and never re-computed later. Changing the policy
affects only *future* uploads. See the plan/design at
``docs/superpowers/plans/2026-09-01-original-file-retention-governance.md``.
"""

from __future__ import annotations

from typing import Literal

# The three admin-facing retention modes for uploaded originals.
OriginalFilePolicy = Literal["always_keep", "user_choice", "always_delete"]

# The two effective actions persisted on the asset snapshot.
OriginalFileAction = Literal["keep", "delete_after_processing"]

# Audit reason recorded when a delete is executed.
OriginalFileDeletionReason = Literal[
    "retention_policy", "source_owner", "admin_cleanup"
]

# Public status the API derives from stored fields (never leaks paths).
OriginalFileStatus = Literal["retained", "deleted", "missing", "not_applicable"]


def resolve_original_file_action(
    policy: OriginalFilePolicy,
    default_action: OriginalFileAction,
    requested_action: OriginalFileAction | None,
) -> OriginalFileAction:
    """Resolve the effective retention action for one upload.

    - Admin ``always_keep`` / ``always_delete`` are authoritative and
      ignore any owner request.
    - Under ``user_choice``, the owner's ``requested_action`` wins; when
      absent, the admin ``default_action`` applies.
    """
    if policy == "always_keep":
        return "keep"
    if policy == "always_delete":
        return "delete_after_processing"
    return requested_action or default_action
