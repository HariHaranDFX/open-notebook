from pathlib import Path

import pytest

from open_notebook.storage.original_files import (
    FilesystemOriginalFileStore,
    OriginalFileRef,
)


@pytest.mark.asyncio
async def test_filesystem_store_saves_materializes_streams_and_deletes(tmp_path):
    uploads_root = tmp_path / "uploads"
    staged_path = tmp_path / "staged-upload"
    staged_path.write_bytes(b"original file contents")
    store = FilesystemOriginalFileStore(uploads_root)

    stored = await store.save(staged_path, "../../report.txt")

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
