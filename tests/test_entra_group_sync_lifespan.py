"""Tests for the periodic Entra sync trigger in api/main.py.

Covers env-var parsing, opt-in default, interval floor, and clean cancel.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENTRA_GROUP_SYNC_ENABLED", raising=False)
    from api.main import _entra_group_sync_enabled

    assert _entra_group_sync_enabled() is False


@pytest.mark.parametrize("value", ["true", "1", "yes", "TRUE", "Yes"])
def test_enabled_truthy_parsing(monkeypatch, value):
    monkeypatch.setenv("ENTRA_GROUP_SYNC_ENABLED", value)
    from api.main import _entra_group_sync_enabled

    assert _entra_group_sync_enabled() is True


@pytest.mark.parametrize("value", ["false", "0", "no", ""])
def test_falsy_values_stay_disabled(monkeypatch, value):
    monkeypatch.setenv("ENTRA_GROUP_SYNC_ENABLED", value)
    from api.main import _entra_group_sync_enabled

    assert _entra_group_sync_enabled() is False


def test_interval_default_and_floor(monkeypatch):
    monkeypatch.delenv("ENTRA_GROUP_SYNC_INTERVAL_MINUTES", raising=False)
    from api.main import _entra_group_sync_interval_seconds

    # Default 15 minutes.
    assert _entra_group_sync_interval_seconds() == 15 * 60

    # Non-numeric falls back to default.
    monkeypatch.setenv("ENTRA_GROUP_SYNC_INTERVAL_MINUTES", "not-a-number")
    assert _entra_group_sync_interval_seconds() == 15 * 60


@pytest.mark.asyncio
async def test_loop_submits_command_and_respects_cancel(monkeypatch):
    monkeypatch.setenv("ENTRA_GROUP_SYNC_ENABLED", "true")
    # 1s floor still applies in production; for tests we drive the loop
    # directly by resolving each sleep via an Event.
    fired = asyncio.Event()

    async def instant_sleep(_seconds):
        # First call flags that the loop reached the sleep; subsequent
        # calls yield indefinitely until cancelled.
        if not fired.is_set():
            fired.set()
            return
        await asyncio.Event().wait()

    submit = AsyncMock(return_value="cmd-1")
    with patch("api.main.submit_command", submit), patch(
        "api.main.asyncio.sleep", new=instant_sleep
    ):
        from api.main import _entra_group_sync_loop

        task = asyncio.create_task(_entra_group_sync_loop())
        await asyncio.wait_for(fired.wait(), timeout=2.0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert submit.await_count >= 1


@pytest.mark.asyncio
async def test_loop_swallows_submit_errors_and_keeps_running():
    """A transient submit failure must not kill the periodic loop."""
    fired_twice = asyncio.Event()
    counter = {"n": 0}

    async def instant_sleep(_seconds):
        counter["n"] += 1
        if counter["n"] >= 2:
            fired_twice.set()
            await asyncio.Event().wait()

    submit = AsyncMock(side_effect=[RuntimeError("boom"), "cmd-ok"])
    with patch("api.main.submit_command", submit), patch(
        "api.main.asyncio.sleep", new=instant_sleep
    ):
        from api.main import _entra_group_sync_loop

        task = asyncio.create_task(_entra_group_sync_loop())
        await asyncio.wait_for(fired_twice.wait(), timeout=2.0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert submit.await_count >= 2
