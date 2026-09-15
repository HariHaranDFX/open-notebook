"""Tests for the original-file retention policy resolver + safe defaults.

Task 1 of the retention governance plan
(docs/superpowers/plans/2026-09-01-original-file-retention-governance.md).

Contract:

- Admin ``always_keep`` / ``always_delete`` ignore any owner request.
- Admin ``user_choice`` honors owner ``requested_action``; falls back to
  the admin ``default_action`` when the owner is silent.
- Missing new settings default to ``always_keep`` — legacy installs must
  NOT start deleting originals just because they had ``auto_delete_files=yes``.
- Invalid string values fail Pydantic validation (typed enums, not open
  strings).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.original_file_policy import resolve_original_file_action


@pytest.mark.parametrize(
    ("policy", "default", "requested", "expected"),
    [
        # Admin mode overrides any owner request.
        ("always_keep", "delete_after_processing", "delete_after_processing", "keep"),
        ("always_delete", "keep", "keep", "delete_after_processing"),
        # user_choice: owner request wins.
        ("user_choice", "keep", None, "keep"),
        ("user_choice", "delete_after_processing", None, "delete_after_processing"),
        ("user_choice", "keep", "delete_after_processing", "delete_after_processing"),
        ("user_choice", "delete_after_processing", "keep", "keep"),
    ],
)
def test_resolve_original_file_action(policy, default, requested, expected):
    assert resolve_original_file_action(policy, default, requested) == expected


def test_missing_new_settings_fields_default_to_always_keep():
    """A legacy ContentSettings row containing only the deprecated
    ``auto_delete_files`` toggle MUST default to keeping originals.

    This is the safe-migration invariant: installations that had auto-delete
    enabled do not silently switch back to deleting after the upgrade —
    the admin has to explicitly pick a new policy.
    """
    settings = ContentSettings.model_validate({"auto_delete_files": "yes"})
    assert settings.original_file_policy == "always_keep"
    assert settings.original_file_user_default == "keep"
    assert settings.allow_source_owner_cleanup is False


def test_invalid_policy_fails_validation():
    with pytest.raises(ValidationError):
        ContentSettings.model_validate({"original_file_policy": "bogus_mode"})


def test_invalid_action_fails_validation():
    with pytest.raises(ValidationError):
        ContentSettings.model_validate(
            {"original_file_user_default": "sometimes"}
        )


def test_deprecated_auto_delete_files_is_not_the_resolver_input():
    """Deprecation guard: the resolver signature must not accept the
    legacy toggle. If it did, someone could accidentally reintroduce
    silent post-upgrade deletion by wiring ``auto_delete_files`` back
    into the decision.
    """
    import inspect

    sig = inspect.signature(resolve_original_file_action)
    assert "auto_delete_files" not in sig.parameters
