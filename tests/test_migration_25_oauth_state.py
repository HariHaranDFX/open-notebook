from pathlib import Path

from open_notebook.database.async_migrate import AsyncMigrationManager

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


def test_migration_25_defines_oauth_state_schema():
    migration = (MIGRATIONS_DIR / "25.surrealql").read_text(encoding="utf-8")

    for statement in (
        "DEFINE TABLE IF NOT EXISTS oauth_state SCHEMAFULL;",
        "DEFINE FIELD IF NOT EXISTS state ON TABLE oauth_state TYPE string;",
        "DEFINE FIELD IF NOT EXISTS code_verifier ON TABLE oauth_state TYPE string;",
        "DEFINE FIELD IF NOT EXISTS expires_at ON TABLE oauth_state TYPE datetime;",
        "DEFINE INDEX IF NOT EXISTS idx_oauth_state_state ON TABLE oauth_state COLUMNS state UNIQUE;",
    ):
        assert statement in migration


def test_migration_25_rollback_removes_oauth_state_table():
    rollback = (MIGRATIONS_DIR / "25_down.surrealql").read_text(encoding="utf-8")

    assert "REMOVE TABLE IF EXISTS oauth_state;" in rollback


def test_migration_25_is_registered_for_up_and_down():
    manager = AsyncMigrationManager()

    assert len(manager.up_migrations) == len(manager.down_migrations) >= 25
    # Index 24 (0-based) is migration 25 - later migrations may follow it.
    assert (
        "DEFINE TABLE IF NOT EXISTS oauth_state SCHEMAFULL;"
        in manager.up_migrations[24].sql
    )
    assert "REMOVE TABLE IF EXISTS oauth_state;" in manager.down_migrations[24].sql
