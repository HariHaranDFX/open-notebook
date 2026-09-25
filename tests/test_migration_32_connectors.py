from pathlib import Path

from open_notebook.database.async_migrate import AsyncMigrationManager


def test_migration_32_defines_owned_connector_tables_and_is_registered():
    root = Path("open_notebook/database/migrations")
    sql = (root / "32.surrealql").read_text()
    down = (root / "32_down.surrealql").read_text()
    for table in (
        "connector_connection",
        "connector_oauth_state",
        "connector_batch",
        "connector_batch_document",
    ):
        assert f"DEFINE TABLE IF NOT EXISTS {table} SCHEMAFULL" in sql
        assert f"user_id ON TABLE {table} TYPE record<user>" in sql
        assert f"ON TABLE {table} FIELDS user_id" in sql
        assert f"REMOVE TABLE IF EXISTS {table}" in down
    assert "FIELDS user_id, provider UNIQUE" in sql
    assert "FIELDS state_hash UNIQUE" in sql
    assert "FIELDS batch_id, drive_id, item_id UNIQUE" in sql
    manager = AsyncMigrationManager()
    assert "connector_connection" in manager.up_migrations[31].sql
    assert "connector_connection" in manager.down_migrations[31].sql


def test_batch_timestamps_are_database_managed_for_object_model_saves():
    sql = Path("open_notebook/database/migrations/32.surrealql").read_text()
    for table in ("connector_batch", "connector_batch_document"):
        assert (
            f"created ON TABLE {table} DEFAULT time::now() VALUE $before OR time::now()"
            in sql
        )
        assert f"updated ON TABLE {table} DEFAULT time::now() VALUE time::now()" in sql
