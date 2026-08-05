"""Access rules for transformations (shared vs personal, soft-delete builtins)."""

from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import HTTPException, Request

from api.auth.deps import auth_enforces_ownership, current_user_optional
from api.auth.types import AuthenticatedUser
from api.ownership import _same_owner
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.transformation import Transformation


def _auth_on() -> bool:
    return auth_enforces_ownership()


def current_user_for_transformations(request: Request) -> Optional[AuthenticatedUser]:
    if not _auth_on():
        return None
    return current_user_optional(request)


def is_shared(transformation: Transformation) -> bool:
    return transformation.user_id is None


def is_soft_deleted(transformation: Transformation) -> bool:
    return transformation.deleted_at is not None


def access_flags(
    transformation: Transformation, user: Optional[AuthenticatedUser]
) -> Tuple[bool, bool, bool]:
    """Return (can_edit, can_delete, can_restore)."""
    if not _auth_on() or user is None:
        deleted = is_soft_deleted(transformation)
        return (not deleted, not deleted, deleted and transformation.is_builtin)

    is_admin = user.role == "admin"
    deleted = is_soft_deleted(transformation)
    if deleted:
        return False, False, is_admin and transformation.is_builtin

    if is_shared(transformation):
        return is_admin, is_admin, False

    owned = _same_owner(transformation.user_id, user.id)
    return owned, owned, False


def assert_can_view(transformation: Transformation, request: Request) -> None:
    user = current_user_for_transformations(request)
    if not _auth_on() or user is None:
        if is_soft_deleted(transformation):
            raise HTTPException(status_code=404, detail="Transformation not found")
        return

    if is_soft_deleted(transformation):
        if user.role == "admin" and transformation.is_builtin:
            return
        raise HTTPException(status_code=404, detail="Transformation not found")

    if is_shared(transformation):
        return

    if not _same_owner(transformation.user_id, user.id):
        raise HTTPException(status_code=404, detail="Transformation not found")


def assert_can_edit(transformation: Transformation, request: Request) -> None:
    user = current_user_for_transformations(request)
    can_edit, _, _ = access_flags(transformation, user)
    if can_edit:
        return
    if is_shared(transformation):
        raise HTTPException(
            status_code=403,
            detail="Only an administrator can edit shared transformations",
        )
    raise HTTPException(
        status_code=403,
        detail="You can only edit your own transformations",
    )


def assert_can_delete(transformation: Transformation, request: Request) -> None:
    user = current_user_for_transformations(request)
    _, can_delete, _ = access_flags(transformation, user)
    if can_delete:
        return
    if is_shared(transformation):
        raise HTTPException(
            status_code=403,
            detail="Only an administrator can delete shared transformations",
        )
    raise HTTPException(
        status_code=403,
        detail="You can only delete your own transformations",
    )


def assert_can_restore(transformation: Transformation, request: Request) -> None:
    user = current_user_for_transformations(request)
    _, _, can_restore = access_flags(transformation, user)
    if can_restore:
        return
    raise HTTPException(
        status_code=403,
        detail="Only an administrator can restore built-in transformations",
    )


def assert_can_edit_default_prompt(request: Request) -> None:
    user = current_user_for_transformations(request)
    if not _auth_on():
        return
    if user is None or user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail=(
                "Only an administrator can edit the default transformation prompt"
            ),
        )


async def list_visible_transformations(
    request: Request,
) -> list[Transformation]:
    user = current_user_for_transformations(request)
    if not _auth_on() or user is None:
        rows = await repo_query(
            """
            SELECT * FROM transformation
            WHERE deleted_at = NONE
            ORDER BY name ASC;
            """
        )
        return [Transformation(**row) for row in rows]

    if user.role == "admin":
        rows = await repo_query(
            """
            SELECT * FROM transformation
            WHERE
                (user_id = NONE AND deleted_at = NONE)
                OR (is_builtin = true AND deleted_at != NONE)
                OR user_id = $owner_id
            ORDER BY name ASC;
            """,
            {"owner_id": ensure_record_id(user.id)},
        )
    else:
        rows = await repo_query(
            """
            SELECT * FROM transformation
            WHERE
                (user_id = NONE AND deleted_at = NONE)
                OR user_id = $owner_id
            ORDER BY name ASC;
            """,
            {"owner_id": ensure_record_id(user.id)},
        )
    return [Transformation(**row) for row in rows]


async def soft_delete_builtin(transformation: Transformation) -> None:
    transformation.deleted_at = datetime.now(timezone.utc)
    await transformation.save()


async def restore_builtin(transformation: Transformation) -> None:
    transformation.deleted_at = None
    await transformation.save()


def stamp_on_create(
    transformation: Transformation, user: Optional[AuthenticatedUser]
) -> None:
    """Admins create shared catalog entries; users create personal ones."""
    transformation.is_builtin = False
    transformation.deleted_at = None
    if not _auth_on() or user is None:
        transformation.user_id = None
        return
    if user.role == "admin":
        transformation.user_id = None
    else:
        transformation.user_id = user.id
