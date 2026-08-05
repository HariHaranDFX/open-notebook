from pathlib import Path

from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.user import User

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


def test_user_model_has_auth_identity_fields():
    user = User(
        email="admin@example.com",
        display_name="Admin",
        entra_oid="oid-123",
        client_id="client-123",
    )

    assert user.table_name == "user"
    assert user.role == "user"
    assert user.entra_oid == "oid-123"


def test_notebook_and_source_accept_optional_ownership_fields():
    notebook = Notebook(
        name="Owned notebook",
        description="Test",
        user_id="user:admin",
        client_id="client-123",
    )
    source = Source(user_id="user:admin", client_id="client-123")

    assert notebook.user_id == source.user_id == "user:admin"
    assert notebook.client_id == source.client_id == "client-123"


def test_migration_24_defines_auth_and_ownership_schema():
    migration = (MIGRATIONS_DIR / "24.surrealql").read_text(encoding="utf-8")

    for statement in (
        "DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;",
        "DEFINE FIELD IF NOT EXISTS email ON TABLE user TYPE string;",
        'DEFINE FIELD IF NOT EXISTS role ON TABLE user TYPE string ASSERT $value IN ["admin", "user"];',
        "DEFINE INDEX IF NOT EXISTS idx_user_email ON TABLE user COLUMNS email UNIQUE;",
        "DEFINE TABLE IF NOT EXISTS auth_session SCHEMAFULL;",
        "DEFINE FIELD IF NOT EXISTS user ON TABLE auth_session TYPE record<user>;",
        "DEFINE INDEX IF NOT EXISTS idx_session_hash ON TABLE auth_session COLUMNS session_token_hash UNIQUE;",
        "DEFINE FIELD IF NOT EXISTS user_id ON TABLE notebook TYPE option<record<user>>;",
        "DEFINE FIELD IF NOT EXISTS client_id ON TABLE notebook TYPE option<string>;",
        "DEFINE FIELD IF NOT EXISTS user_id ON TABLE source TYPE option<record<user>>;",
        "DEFINE FIELD IF NOT EXISTS client_id ON TABLE source TYPE option<string>;",
    ):
        assert statement in migration


def test_migration_24_is_registered_for_up_and_down():
    manager = AsyncMigrationManager()

    assert len(manager.up_migrations) == len(manager.down_migrations)
    assert len(manager.up_migrations) >= 24
    assert "DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;" in manager.up_migrations[23].sql
    assert "REMOVE TABLE IF EXISTS user;" in manager.down_migrations[23].sql


def test_migration_24_rollback_removes_auth_and_ownership_schema():
    rollback = (MIGRATIONS_DIR / "24_down.surrealql").read_text(encoding="utf-8")

    for statement in (
        "REMOVE FIELD IF EXISTS user_id ON TABLE notebook;",
        "REMOVE FIELD IF EXISTS client_id ON TABLE notebook;",
        "REMOVE FIELD IF EXISTS user_id ON TABLE source;",
        "REMOVE FIELD IF EXISTS client_id ON TABLE source;",
        "REMOVE TABLE IF EXISTS auth_session;",
        "REMOVE TABLE IF EXISTS user;",
    ):
        assert statement in rollback
