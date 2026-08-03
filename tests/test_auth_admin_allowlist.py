import pytest

from api.auth.entra import require_entra_config, resolve_role

ENTRA_ENV = {
    "ENTRA_TENANT_ID": "tenant-1",
    "ENTRA_CLIENT_ID": "client-1",
    "ENTRA_CLIENT_SECRET": "secret-1",
    "ENTRA_REDIRECT_URI": "https://app.example.com/api/auth/callback",
    "AUTH_ADMIN_EMAILS": "admin@example.com, Second.Admin@Example.com",
}


def _set_env(monkeypatch, **overrides):
    values = {**ENTRA_ENV, **overrides}
    for key, value in values.items():
        monkeypatch.setenv(key, value)


@pytest.mark.parametrize(
    ("email", "expected_role"),
    [
        ("admin@example.com", "admin"),
        ("ADMIN@EXAMPLE.COM", "admin"),
        ("second.admin@example.com", "admin"),
        ("nobody@example.com", "user"),
    ],
)
def test_resolve_role_matches_allowlist_case_insensitively(
    monkeypatch, email, expected_role
):
    _set_env(monkeypatch)

    assert resolve_role(email) == expected_role


def test_resolve_role_ignores_blank_entries(monkeypatch):
    monkeypatch.setenv("AUTH_ADMIN_EMAILS", "admin@example.com,, ,")

    assert resolve_role("admin@example.com") == "admin"
    assert resolve_role("other@example.com") == "user"


def test_require_entra_config_passes_with_full_config(monkeypatch):
    _set_env(monkeypatch)

    require_entra_config()  # must not raise


@pytest.mark.parametrize(
    "missing_key",
    [
        "ENTRA_TENANT_ID",
        "ENTRA_CLIENT_ID",
        "ENTRA_CLIENT_SECRET",
        "ENTRA_REDIRECT_URI",
        "AUTH_ADMIN_EMAILS",
    ],
)
def test_require_entra_config_fails_when_key_missing(monkeypatch, missing_key):
    _set_env(monkeypatch)
    monkeypatch.delenv(missing_key, raising=False)

    with pytest.raises(RuntimeError, match=missing_key):
        require_entra_config()


def test_require_entra_config_fails_on_blank_admin_emails(monkeypatch):
    _set_env(monkeypatch, AUTH_ADMIN_EMAILS=" , ,")

    with pytest.raises(RuntimeError, match="AUTH_ADMIN_EMAILS"):
        require_entra_config()
