from pathlib import Path

from open_notebook.database.async_migrate import AsyncMigrationManager

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


def test_migration_27_adds_transformation_ownership_columns():
    migration = (MIGRATIONS_DIR / "27.surrealql").read_text(encoding="utf-8")

    assert (
        "DEFINE FIELD IF NOT EXISTS user_id ON TABLE transformation TYPE option<record<user>>;"
        in migration
    )
    assert (
        "DEFINE FIELD IF NOT EXISTS is_builtin ON TABLE transformation TYPE bool DEFAULT false;"
        in migration
    )
    assert (
        "DEFINE FIELD IF NOT EXISTS deleted_at ON TABLE transformation TYPE option<datetime>;"
        in migration
    )
    assert "Analyze Paper" in migration
    assert "Simple Summary" in migration


def test_migration_27_rollback_removes_columns():
    rollback = (MIGRATIONS_DIR / "27_down.surrealql").read_text(encoding="utf-8")

    assert "REMOVE FIELD IF EXISTS user_id ON TABLE transformation;" in rollback
    assert "REMOVE FIELD IF EXISTS is_builtin ON TABLE transformation;" in rollback
    assert "REMOVE FIELD IF EXISTS deleted_at ON TABLE transformation;" in rollback


def test_migration_27_is_registered():
    manager = AsyncMigrationManager()

    assert len(manager.up_migrations) == len(manager.down_migrations) >= 27
    assert "is_builtin" in manager.up_migrations[26].sql
    assert "REMOVE FIELD IF EXISTS is_builtin ON TABLE transformation;" in (
        manager.down_migrations[26].sql
    )
