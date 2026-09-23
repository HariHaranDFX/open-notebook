from open_notebook.database.async_migrate import AsyncMigrationManager


def test_msal_cache_migration_is_registered_and_additive():
    manager = AsyncMigrationManager()
    assert len(manager.up_migrations) == len(manager.down_migrations) == 33
    up = manager.up_migrations[32].sql
    assert "token_cache ON TABLE connector_connection" in up
    assert "auth_flow ON TABLE connector_oauth_state" in up
    assert "code_verifier ON TABLE connector_oauth_state TYPE option<string>" in up
    assert "DELETE connector_connection" not in up
    assert "UPDATE connector_connection" not in up
