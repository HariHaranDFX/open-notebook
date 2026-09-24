from pathlib import Path

import pytest

from open_notebook.domain.notebook import Asset
from open_notebook.storage.original_files import (
    FilesystemOriginalFileStore,
    OriginalFileRef,
    reference_from_asset,
)


@pytest.mark.asyncio
async def test_filesystem_store_saves_materializes_streams_and_deletes(tmp_path):
    uploads_root = tmp_path / "uploads"
    staged_path = tmp_path / "staged-upload"
    staged_path.write_bytes(b"original file contents")
    store = FilesystemOriginalFileStore(uploads_root)

    stored = await store.save(staged_path, "../../report.txt")

    assert not staged_path.exists()
    assert stored.provider == "filesystem"
    assert stored.size_bytes == len(b"original file contents")
    assert not Path(stored.key).is_absolute()
    assert ".." not in Path(stored.key).parts
    assert stored.file_path is not None
    assert Path(stored.file_path).resolve().is_relative_to(uploads_root.resolve())

    ref = OriginalFileRef(
        provider=stored.provider,
        key=stored.key,
        etag=stored.etag,
        legacy_file_path=stored.file_path,
    )
    assert await store.exists(ref)
    async with store.materialize(ref) as materialized:
        assert materialized.read_bytes() == b"original file contents"
    assert b"".join([chunk async for chunk in store.iter_bytes(ref)]) == b"original file contents"
    assert await store.delete(ref)
    assert await store.delete(ref)
    assert not await store.exists(ref)


@pytest.mark.asyncio
async def test_filesystem_store_removes_reserved_path_when_fallback_copy_fails(
    tmp_path, monkeypatch
):
    from open_notebook.storage import original_files

    uploads_root = tmp_path / "uploads"
    staged_path = tmp_path / "staged-upload"
    staged_path.write_bytes(b"original file contents")
    store = FilesystemOriginalFileStore(uploads_root)

    def fail_replace(*_):
        raise OSError

    def fail_copy(*_):
        raise OSError("copy failed")

    monkeypatch.setattr(original_files.os, "replace", fail_replace)
    monkeypatch.setattr(original_files.shutil, "copyfileobj", fail_copy)

    with pytest.raises(OSError, match="copy failed"):
        await store.save(staged_path, "report.txt")

    assert staged_path.exists()
    assert not list(uploads_root.iterdir())


@pytest.mark.asyncio
async def test_filesystem_store_rejects_outside_root_keys_and_legacy_paths(tmp_path):
    uploads_root = tmp_path / "uploads"
    uploads_root.mkdir()
    outside_path = tmp_path / "outside.txt"
    outside_path.write_bytes(b"outside")
    store = FilesystemOriginalFileStore(uploads_root)

    for ref in (
        OriginalFileRef(provider="filesystem", key="../outside.txt"),
        OriginalFileRef(
            provider="filesystem",
            key="ignored.txt",
            legacy_file_path=str(outside_path),
        ),
    ):
        assert not await store.exists(ref)
        with pytest.raises(ValueError):
            async with store.materialize(ref):
                pass
        with pytest.raises(ValueError):
            [chunk async for chunk in store.iter_bytes(ref)]
        with pytest.raises(ValueError):
            await store.delete(ref)


def test_reference_from_asset_preserves_legacy_filesystem_path(tmp_path):
    legacy_path = tmp_path / "uploads" / "legacy.txt"

    ref = reference_from_asset(Asset(file_path=str(legacy_path)))

    assert ref == OriginalFileRef(
        provider="filesystem",
        key=str(legacy_path),
        legacy_file_path=str(legacy_path),
    )
    assert ref.profile_id is None
    assert ref.container_id is None


def test_reference_from_asset_copies_recorded_profile_and_legacy_default():
    recorded = reference_from_asset(
        Asset(
            original_file_store="sharepoint_embedded",
            original_file_key="item-a",
            original_file_etag="etag-a",
            original_file_profile_id="profile-a",
            original_file_container_id="container-a",
        )
    )
    legacy = reference_from_asset(
        Asset(
            original_file_store="sharepoint_embedded",
            original_file_key="legacy-item",
        )
    )

    assert recorded is not None
    assert recorded.profile_id == "profile-a"
    assert recorded.container_id == "container-a"
    assert legacy is not None
    assert legacy.profile_id == "default"
    assert legacy.container_id is None
