from pathlib import Path

from open_notebook.database.async_migrate import AsyncMigrationManager

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


def test_migration_26_adds_episode_ownership_columns():
    migration = (MIGRATIONS_DIR / "26.surrealql").read_text(encoding="utf-8")

    assert (
        "DEFINE FIELD IF NOT EXISTS user_id ON TABLE episode TYPE option<record<user>>;"
        in migration
    )
    assert (
        "DEFINE FIELD IF NOT EXISTS client_id ON TABLE episode TYPE option<string>;"
        in migration
    )


def test_migration_26_rollback_removes_episode_ownership_columns():
    rollback = (MIGRATIONS_DIR / "26_down.surrealql").read_text(encoding="utf-8")

    assert "REMOVE FIELD IF EXISTS user_id ON TABLE episode;" in rollback
    assert "REMOVE FIELD IF EXISTS client_id ON TABLE episode;" in rollback


def test_migration_26_is_registered_for_up_and_down():
    manager = AsyncMigrationManager()

    assert len(manager.up_migrations) == len(manager.down_migrations) >= 26
    assert (
        "DEFINE FIELD IF NOT EXISTS user_id ON TABLE episode"
        in manager.up_migrations[25].sql
    )
    assert (
        "REMOVE FIELD IF EXISTS user_id ON TABLE episode;"
        in manager.down_migrations[25].sql
    )
