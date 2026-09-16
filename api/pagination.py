"""Opaque cursor codec for library keyset pagination.

Cursors are backend-issued, URL-safe base64 tokens carrying a small JSON
payload. Callers must not parse them; they must be echoed back unchanged as
the ``cursor`` query parameter to fetch the next page.

Payload shape (``v`` = 1)::

    {
        "v": 1,
        "sort_by": <str>,
        "sort_order": "asc" | "desc",
        "value": <str | int | float | bool | null>,
        "id": <str>,
        "fp": <64-char sha256 hex fingerprint of normalized filters>,
    }

``CursorValidationError`` is a small pagination-specific exception raised by
:func:`decode_cursor` and :func:`assert_cursor_matches`. Route handlers turn
it into HTTP 400 with a safe message and never surface decoder internals.

Uses only Python's standard library (``base64``, ``hashlib``, ``json``) per
the plan's "add no dependency" rule.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime
from typing import Any, Iterable

# Version bump this integer if the payload shape changes incompatibly.
CURSOR_VERSION = 1

# A legitimate cursor is a tiny JSON object; a healthy ceiling catches
# adversarial oversized tokens before we spend time base64-decoding them.
_MAX_CURSOR_LENGTH = 2048
_VALID_SORT_ORDERS = ("asc", "desc")


class CursorValidationError(ValueError):
    """Raised when a caller-supplied cursor is malformed or mismatched.

    Route handlers should translate this into HTTP 400 with a stable, safe
    message — never the exception text, which may reveal decoder internals.
    """


def _cursor_json_default(obj: Any) -> Any:
    """JSON encoder fallback for cursor payloads.

    SurrealDB returns real ``datetime`` objects for datetime columns
    (``created`` / ``updated``); vanilla ``json.dumps`` can't serialize
    those. We store the ISO 8601 form — SurrealDB parses ISO strings
    against datetime columns via its own type coercion, so the value
    round-trips into the next request's WHERE keyset predicate as a
    valid bind.
    """
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(
        f"Object of type {type(obj).__name__} is not JSON-serializable "
        "in a cursor payload"
    )


def encode_cursor(payload: dict[str, object]) -> str:
    """Encode a payload as a compact URL-safe base64 token.

    The payload is serialized with the most compact JSON separators. Padding
    ``=`` characters are stripped so the token is safe to embed in a URL
    without escaping. Non-JSON primitives (``datetime``) are normalized
    by :func:`_cursor_json_default`.
    """
    raw = json.dumps(
        payload,
        separators=(",", ":"),
        sort_keys=True,
        default=_cursor_json_default,
    ).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64_decode(token: str) -> bytes:
    padded = token + "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def decode_cursor(
    token: str,
    *,
    allowed_sort_fields: Iterable[str],
    expected_sort_by: str,
    expected_sort_order: str,
    expected_fp: str,
) -> dict[str, Any]:
    """Decode ``token`` and validate every field against the current request.

    Raises :class:`CursorValidationError` on any mismatch — the same code path
    as a malformed cursor. Callers should return HTTP 400 in either case.

    Validated:

    - token length (before decode) and base64/JSON shape
    - version matches ``CURSOR_VERSION``
    - ``sort_by`` is in ``allowed_sort_fields`` and equals ``expected_sort_by``
    - ``sort_order`` is asc/desc and equals ``expected_sort_order``
    - ``value`` is a primitive type (JSON number, string, bool, or null)
    - ``id`` is a non-empty ``table:key`` string
    - ``fp`` matches ``expected_fp`` (filter fingerprint)
    """
    if not isinstance(token, str) or not token or len(token) > _MAX_CURSOR_LENGTH:
        raise CursorValidationError("cursor: bad length")

    try:
        raw = _b64_decode(token)
    except Exception as e:  # noqa: BLE001 - any base64 failure is user input
        raise CursorValidationError("cursor: bad encoding") from e

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as e:  # noqa: BLE001 - any JSON failure is user input
        raise CursorValidationError("cursor: bad json") from e

    if not isinstance(payload, dict):
        raise CursorValidationError("cursor: bad shape")

    if payload.get("v") != CURSOR_VERSION:
        raise CursorValidationError("cursor: bad version")

    sort_by = payload.get("sort_by")
    if not isinstance(sort_by, str) or sort_by not in allowed_sort_fields:
        raise CursorValidationError("cursor: bad sort_by")
    if sort_by != expected_sort_by:
        raise CursorValidationError("cursor: mismatched sort_by")

    sort_order = payload.get("sort_order")
    if sort_order not in _VALID_SORT_ORDERS:
        raise CursorValidationError("cursor: bad sort_order")
    if sort_order != expected_sort_order:
        raise CursorValidationError("cursor: mismatched sort_order")

    value = payload.get("value")
    # Allow the primitive JSON types keyset predicates can bind directly.
    if not isinstance(value, (str, int, float, bool)) and value is not None:
        raise CursorValidationError("cursor: bad value type")

    id_ = payload.get("id")
    if not isinstance(id_, str) or ":" not in id_ or not id_.strip():
        raise CursorValidationError("cursor: bad id")

    fp = payload.get("fp")
    if not isinstance(fp, str) or len(fp) != 64:
        raise CursorValidationError("cursor: bad fingerprint")
    if fp != expected_fp:
        raise CursorValidationError("cursor: mismatched fingerprint")

    return payload


def fingerprint_filters(parts: dict[str, object]) -> str:
    """SHA-256 hex over a canonical JSON encoding of the filter set.

    Callers pass a dict of the request's normalized filters (query, notebook
    filter, archived flag, and so on). Any change to that dict — a different
    query, a different owner scope — produces a different fingerprint, and a
    cursor issued under the old fingerprint fails :func:`decode_cursor`.
    """
    raw = json.dumps(parts, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()
