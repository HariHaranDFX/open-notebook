"""Server-side pending OAuth state for the Entra PKCE BFF flow.

The `on_oauth` cookie only carries the opaque `state` value. The PKCE
`code_verifier` lives here, keyed by `state`, so a tampered or forged
cookie can no longer smuggle in an attacker-chosen verifier - fixes the
"unsigned {state}.{verifier} cookie" P1 finding.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from open_notebook.database.repository import repo_create, repo_delete, repo_query

OAUTH_STATE_LIFETIME = timedelta(minutes=10)


async def store_oauth_state(state: str, code_verifier: str) -> None:
    await repo_create(
        "oauth_state",
        {
            "state": state,
            "code_verifier": code_verifier,
            "expires_at": datetime.now(timezone.utc) + OAUTH_STATE_LIFETIME,
        },
    )


async def consume_oauth_state(state: str) -> Optional[str]:
    """Look up and delete the pending row for `state` (one-time use).

    Returns None if the state is unknown or expired.
    """
    rows = await repo_query(
        "SELECT id, code_verifier, expires_at FROM oauth_state WHERE state = $state LIMIT 1;",
        {"state": state},
    )
    if not rows:
        return None

    row = rows[0]
    await repo_delete(row["id"])

    expires_at = row["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None

    return row["code_verifier"]
