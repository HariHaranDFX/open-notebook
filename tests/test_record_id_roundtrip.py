"""Surreal RecordID string round-trip (hyphenated ids / ⟨⟩ escaping)."""

from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id, parse_record_ids


def test_hyphenated_record_id_round_trips_through_str():
    """str(RecordID) wraps special id chars in ⟨⟩; ensure_record_id must undo that."""
    original = ensure_record_id("user:password-local")
    as_str = parse_record_ids(original)

    assert as_str == "user:⟨password-local⟩"
    assert ensure_record_id(as_str) == original
    assert ensure_record_id(as_str).id == "password-local"


def test_nested_escape_corruption_is_peeled():
    """Worker re-saves used to nest ⟨⟩; peel back to the logical id."""
    corrupted = "user:⟨⟨⟨password-local\\\\⟩\\⟩⟩"

    rid = ensure_record_id(corrupted)

    assert rid.table_name == "user"
    assert rid.id == "password-local"
    assert ensure_record_id(str(rid)) == rid


def test_plain_ids_unchanged():
    rid = ensure_record_id("user:password_local")
    assert str(rid) == "user:password_local"
    assert ensure_record_id(str(rid)) == rid
    assert isinstance(ensure_record_id(rid), RecordID)
