"""Provider-neutral storage for Open Notebook-owned original files."""

from __future__ import annotations

import asyncio
import os
import shutil
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, AsyncContextManager, AsyncIterator, Protocol

from open_notebook.config import UPLOADS_FOLDER

if TYPE_CHECKING:
    from open_notebook.domain.notebook import Asset


LEGACY_STORAGE_PROFILE_ID = "default"


@dataclass(frozen=True)
class StoredOriginal:
    provider: str
    key: str
    size_bytes: int
    etag: str | None = None
    file_path: str | None = None
    profile_id: str | None = None
    container_id: str | None = None


@dataclass(frozen=True)
class OriginalFileRef:
    provider: str
    key: str
    etag: str | None = None
    legacy_file_path: str | None = None
    profile_id: str | None = None
    container_id: str | None = None


class OriginalFileStore(Protocol):
    async def save(
        self, staged_path: Path, filename: str, object_name: str | None = None
    ) -> StoredOriginal: ...

    def materialize(self, ref: OriginalFileRef) -> AsyncContextManager[Path]: ...

    def iter_bytes(self, ref: OriginalFileRef) -> AsyncIterator[bytes]: ...

    async def exists(self, ref: OriginalFileRef) -> bool: ...

    async def delete(self, ref: OriginalFileRef) -> bool: ...


class FilesystemOriginalFileStore:
    provider = "filesystem"

    def __init__(self, uploads_folder: Path | str = UPLOADS_FOLDER):
        self.uploads_folder = Path(uploads_folder).resolve()

    def _path_for_ref(self, ref: OriginalFileRef) -> Path:
        if ref.provider != self.provider:
            raise ValueError("Original file reference uses a different provider")
        path = (
            Path(ref.legacy_file_path)
            if ref.legacy_file_path
            else self.uploads_folder / ref.key
        )
        try:
            resolved = path.resolve()
            resolved.relative_to(self.uploads_folder)
        except (OSError, ValueError) as exc:
            raise ValueError("Original file reference is outside the uploads folder") from exc
        if resolved == self.uploads_folder:
            raise ValueError("Original file reference is invalid")
        return resolved

    def _reserve_path(self, filename: str) -> Path:
        safe_filename = os.path.basename(filename)
        if safe_filename in {"", ".", ".."}:
            raise ValueError("Invalid filename")

        stem = Path(safe_filename).stem
        suffix = Path(safe_filename).suffix
        counter = 0
        while True:
            name = safe_filename if counter == 0 else f"{stem} ({counter}){suffix}"
            path = self.uploads_folder / name
            try:
                path.resolve().relative_to(self.uploads_folder)
                path.touch(exist_ok=False)
                return path.resolve()
            except FileExistsError:
                counter += 1
            except (OSError, ValueError) as exc:
                raise ValueError("Invalid filename") from exc

    def _save(self, staged_path: Path, filename: str) -> StoredOriginal:
        self.uploads_folder.mkdir(parents=True, exist_ok=True)
        destination = self._reserve_path(filename)
        try:
            try:
                os.replace(staged_path, destination)
            except OSError:
                with staged_path.open("rb") as staged, destination.open("wb") as target:
                    shutil.copyfileobj(staged, target)
                staged_path.unlink()
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        return StoredOriginal(
            provider=self.provider,
            key=destination.relative_to(self.uploads_folder).as_posix(),
            size_bytes=destination.stat().st_size,
            file_path=str(destination),
        )

    async def save(
        self,
        staged_path: Path,
        filename: str,
        object_name: str | None = None,
    ) -> StoredOriginal:
        del object_name
        return await asyncio.to_thread(self._save, staged_path, filename)

    @asynccontextmanager
    async def materialize(self, ref: OriginalFileRef) -> AsyncIterator[Path]:
        yield self._path_for_ref(ref)

    async def iter_bytes(self, ref: OriginalFileRef) -> AsyncIterator[bytes]:
        path = self._path_for_ref(ref)
        with path.open("rb") as file:
            while chunk := await asyncio.to_thread(file.read, 1024 * 1024):
                yield chunk

    async def exists(self, ref: OriginalFileRef) -> bool:
        try:
            return await asyncio.to_thread(self._path_for_ref(ref).is_file)
        except ValueError:
            return False

    async def delete(self, ref: OriginalFileRef) -> bool:
        path = self._path_for_ref(ref)
        await asyncio.to_thread(path.unlink, missing_ok=True)
        return True


def get_original_file_store(
    provider: str | None = None, profile_id: str | None = None
) -> OriginalFileStore:
    selected = (
        provider
        or os.environ.get("OPEN_NOTEBOOK_ORIGINAL_FILE_STORE")
        or "filesystem"
    )
    if selected == "filesystem":
        return FilesystemOriginalFileStore()
    if selected == "sharepoint_embedded":
        from open_notebook.storage.sharepoint_embedded import (
            SharePointEmbeddedOriginalFileStore,
        )

        return SharePointEmbeddedOriginalFileStore(profile_id)
    raise ValueError("Unknown original file store")


def reference_from_asset(asset: Asset | None) -> OriginalFileRef | None:
    if asset is None:
        return None
    provider = getattr(asset, "original_file_store", None)
    key = getattr(asset, "original_file_key", None)
    if provider and key:
        profile_id = getattr(asset, "original_file_profile_id", None)
        if provider == "sharepoint_embedded" and not profile_id:
            profile_id = LEGACY_STORAGE_PROFILE_ID
        return OriginalFileRef(
            provider=provider,
            key=key,
            etag=getattr(asset, "original_file_etag", None),
            profile_id=profile_id,
            container_id=getattr(asset, "original_file_container_id", None),
        )
    if asset.file_path:
        return OriginalFileRef(
            provider="filesystem",
            key=asset.file_path,
            legacy_file_path=asset.file_path,
        )
    return None
