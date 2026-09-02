"""Owner + grant access helpers for notebooks/sources (WP2 + WP2b).

No-op whenever auth is disabled or no user is present, so open/password-mode
deployments keep today's global-visibility behaviour unchanged.
"""

from __future__ import annotations

from typing import Literal, Optional, Tuple

from fastapi import HTTPException, Request

from api.auth.deps import auth_enforces_ownership, current_user_optional
from api.models import AccessSummary
from open_notebook.database.repository import ensure_record_id, repo_query

AccessRole = Literal["owner", "editor", "viewer"]
ResourceType = Literal["notebook", "source"]

_ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}


def _same_owner(owner_user_id: Optional[str], user_id: str) -> bool:
    """True when both ids name the same Surreal record."""
    if owner_user_id is None:
        return False
    try:
        return ensure_record_id(owner_user_id) == ensure_record_id(user_id)
    except Exception:
        return owner_user_id == user_id


def canonical_id(record_id: str) -> str:
    return str(ensure_record_id(record_id))


def _canonical_id(record_id: str) -> str:
    return canonical_id(record_id)


def _max_role(
    left: Optional[AccessRole], right: Optional[AccessRole]
) -> Optional[AccessRole]:
    if left is None:
        return right
    if right is None:
        return left
    return left if _ROLE_RANK[left] >= _ROLE_RANK[right] else right


def role_at_least(role: Optional[AccessRole], minimum: AccessRole) -> bool:
    if role is None:
        return False
    return _ROLE_RANK[role] >= _ROLE_RANK[minimum]


async def list_user_group_ids(user_id: str) -> list[str]:
    rows = await repo_query(
        "SELECT group_id FROM user_group_member WHERE user_id = $uid",
        {"uid": ensure_record_id(user_id)},
    )
    return [_canonical_id(str(row["group_id"])) for row in rows if row.get("group_id")]


async def _granted_resource_ids(
    user_id: str, resource_type: ResourceType, group_ids: list[str]
) -> list[str]:
    uid = _canonical_id(user_id)
    rows = await repo_query(
        """
        SELECT resource_id, role FROM resource_grant
        WHERE resource_type = $rtype
          AND (
            (principal_type = 'user' AND principal_id = $uid)
            OR (principal_type = 'group' AND principal_id IN $gids)
          )
        """,
        {"rtype": resource_type, "uid": uid, "gids": group_ids or ["__none__"]},
    )
    return [_canonical_id(str(row["resource_id"])) for row in rows if row.get("resource_id")]


async def _grant_roles_for_resource(
    user_id: str,
    resource_type: ResourceType,
    resource_id: str,
    group_ids: list[str],
) -> list[AccessRole]:
    uid = _canonical_id(user_id)
    rid = _canonical_id(resource_id)
    rows = await repo_query(
        """
        SELECT role FROM resource_grant
        WHERE resource_type = $rtype AND resource_id = $rid
          AND (
            (principal_type = 'user' AND principal_id = $uid)
            OR (principal_type = 'group' AND principal_id IN $gids)
          )
        """,
        {
            "rtype": resource_type,
            "rid": rid,
            "uid": uid,
            "gids": group_ids or ["__none__"],
        },
    )
    roles: list[AccessRole] = []
    for row in rows:
        role = row.get("role")
        if role in ("viewer", "editor"):
            roles.append(role)
    return roles


async def access_where(
    request: Request, resource_type: ResourceType = "notebook"
) -> Tuple[str, dict]:
    """SurrealQL WHERE fragment + binds for owner OR grant access."""
    if not auth_enforces_ownership():
        return "", {}
    user = current_user_optional(request)
    if user is None:
        return "", {}
    group_ids = await list_user_group_ids(user.id)
    granted = await _granted_resource_ids(user.id, resource_type, group_ids)
    binds: dict = {"access_uid": ensure_record_id(user.id)}
    if not granted:
        return "user_id = $access_uid", binds
    binds["access_granted_ids"] = [ensure_record_id(gid) for gid in granted]
    return "(user_id = $access_uid OR id IN $access_granted_ids)", binds


async def ownership_where(request: Request) -> Tuple[str, dict]:
    """Backward-compatible notebook/source list filter (now grant-aware)."""
    return await access_where(request, "notebook")


async def source_access_where(request: Request) -> Tuple[str, dict]:
    """Sources: owner, direct grant, or linked to an accessible notebook."""
    if not auth_enforces_ownership():
        return "", {}
    user = current_user_optional(request)
    if user is None:
        return "", {}
    group_ids = await list_user_group_ids(user.id)
    source_grants = await _granted_resource_ids(user.id, "source", group_ids)
    nb_clause, nb_binds = await access_where(request, "notebook")
    nb_ids: list = []
    if nb_clause:
        accessible_nbs = await repo_query(
            f"SELECT id FROM notebook WHERE {nb_clause}",
            nb_binds,
        )
        nb_ids = [
            ensure_record_id(str(r["id"])) for r in accessible_nbs if r.get("id")
        ]
    binds: dict = {"access_uid": ensure_record_id(user.id)}
    parts = ["user_id = $access_uid"]
    if source_grants:
        binds["access_source_grant_ids"] = [
            ensure_record_id(sid) for sid in source_grants
        ]
        parts.append("id IN $access_source_grant_ids")
    if nb_ids:
        # reference: in=source, out=notebook
        binds["access_notebook_ids"] = nb_ids
        parts.append(
            "id IN (SELECT VALUE in FROM reference WHERE out IN $access_notebook_ids)"
        )
    return "(" + " OR ".join(parts) + ")", binds


async def effective_role_for_notebook(
    owner_user_id: Optional[str], notebook_id: str, request: Request
) -> Optional[AccessRole]:
    if not auth_enforces_ownership():
        return "owner"
    user = current_user_optional(request)
    if user is None:
        return "owner"
    if _same_owner(owner_user_id, user.id):
        return "owner"
    group_ids = await list_user_group_ids(user.id)
    role: Optional[AccessRole] = None
    for grant_role in await _grant_roles_for_resource(
        user.id, "notebook", notebook_id, group_ids
    ):
        role = _max_role(role, grant_role)
    return role


async def effective_role_for_source(
    owner_user_id: Optional[str], source_id: str, request: Request
) -> Optional[AccessRole]:
    if not auth_enforces_ownership():
        return "owner"
    user = current_user_optional(request)
    if user is None:
        return "owner"
    if _same_owner(owner_user_id, user.id):
        return "owner"
    group_ids = await list_user_group_ids(user.id)
    role: Optional[AccessRole] = None
    for grant_role in await _grant_roles_for_resource(
        user.id, "source", source_id, group_ids
    ):
        role = _max_role(role, grant_role)
    # Inherit from notebooks this source is linked to
    links = await repo_query(
        "SELECT out AS notebook_id FROM reference WHERE in = $sid",
        {"sid": ensure_record_id(source_id)},
    )
    for link in links:
        nb_id = link.get("notebook_id")
        if not nb_id:
            continue
        nb_rows = await repo_query(
            "SELECT user_id FROM notebook WHERE id = $id",
            {"id": ensure_record_id(str(nb_id))},
        )
        if not nb_rows:
            continue
        nb_role = await effective_role_for_notebook(
            nb_rows[0].get("user_id"), str(nb_id), request
        )
        # Notebook viewer/editor counts as at least that role on the source
        if nb_role == "owner":
            # Linked notebook owned by someone else shouldn't elevate via this path
            # unless current user is that owner — already handled above for source.
            # If user owns the notebook, they already have access; treat as editor
            # for content ops on linked source content they don't own? Spec: cascade
            # same effective role. Owner of notebook → treat as editor on linked
            # source they don't own (cannot delete source unless source owner).
            role = _max_role(role, "editor")
        else:
            role = _max_role(role, nb_role)
    return role


async def _grant_matches_for_resource(
    user_id: str,
    resource_type: ResourceType,
    resource_id: str,
    group_ids: list[str],
) -> list[dict]:
    """Grant rows for this resource/user, keeping enough to tell a direct
    user grant from a group grant apart (role + principal_type +
    principal_id) - unlike _grant_roles_for_resource, which only needs the
    role. Same WHERE/binds as that query; used solely by the access-summary
    path below so effective_role_for_notebook/_source (and the tests that
    pin their exact query behaviour) are untouched.
    """
    uid = _canonical_id(user_id)
    rid = _canonical_id(resource_id)
    rows = await repo_query(
        """
        SELECT role, principal_type, principal_id FROM resource_grant
        WHERE resource_type = $rtype AND resource_id = $rid
          AND (
            (principal_type = 'user' AND principal_id = $uid)
            OR (principal_type = 'group' AND principal_id IN $gids)
          )
        """,
        {
            "rtype": resource_type,
            "rid": rid,
            "uid": uid,
            "gids": group_ids or ["__none__"],
        },
    )
    return [row for row in rows if row.get("role") in ("viewer", "editor")]


async def _group_name(group_id: str) -> Optional[str]:
    if not group_id:
        return None
    rows = await repo_query(
        "SELECT name FROM $id", {"id": ensure_record_id(group_id)}
    )
    if rows and rows[0].get("name"):
        return str(rows[0]["name"])
    return None


def _direct_or_group_match(
    matches: list[dict], role: AccessRole
) -> Optional[dict]:
    """The grant row that reaches ``role``, preferring a direct user grant
    over a group grant when both qualify (equal-role tie-break)."""
    winners = [m for m in matches if m.get("role") == role]
    direct = next((m for m in winners if m.get("principal_type") == "user"), None)
    if direct is not None:
        return direct
    return next((m for m in winners if m.get("principal_type") == "group"), None)


async def access_summary_for_notebook(
    owner_user_id: Optional[str], notebook_id: str, request: Request
) -> Optional[AccessSummary]:
    """Role + provenance for a notebook (WP3-06).

    Computes the exact same role as effective_role_for_notebook (same
    grant rows, same highest-role-wins reduction) while also reporting how
    that access was reached, for display only.
    """
    if not auth_enforces_ownership():
        return AccessSummary(role="owner", origin="open")
    user = current_user_optional(request)
    if user is None:
        return AccessSummary(role="owner", origin="open")
    if _same_owner(owner_user_id, user.id):
        return AccessSummary(role="owner", origin="owner")
    group_ids = await list_user_group_ids(user.id)
    matches = await _grant_matches_for_resource(
        user.id, "notebook", notebook_id, group_ids
    )
    role: Optional[AccessRole] = None
    for m in matches:
        role = _max_role(role, m.get("role"))
    if role is None:
        return None
    match = _direct_or_group_match(matches, role)
    if match is not None and match.get("principal_type") == "group":
        label = await _group_name(str(match.get("principal_id", "")))
        return AccessSummary(role=role, origin="group", origin_label=label)
    return AccessSummary(role=role, origin="direct")


async def access_summary_for_source(
    owner_user_id: Optional[str], source_id: str, request: Request
) -> Optional[AccessSummary]:
    """Role + provenance for a source, cascading through linked notebooks
    (WP3-06). Computes the exact same role as effective_role_for_source.

    When the winning role is reached only via a linked notebook (not a
    grant on the source itself), origin is "notebook" and origin_label is
    that notebook's name.
    """
    if not auth_enforces_ownership():
        return AccessSummary(role="owner", origin="open")
    user = current_user_optional(request)
    if user is None:
        return AccessSummary(role="owner", origin="open")
    if _same_owner(owner_user_id, user.id):
        return AccessSummary(role="owner", origin="owner")
    group_ids = await list_user_group_ids(user.id)

    matches = await _grant_matches_for_resource(
        user.id, "source", source_id, group_ids
    )
    role: Optional[AccessRole] = None
    for m in matches:
        role = _max_role(role, m.get("role"))

    best_notebook_role: Optional[AccessRole] = None
    best_notebook_label: Optional[str] = None
    links = await repo_query(
        "SELECT out AS notebook_id FROM reference WHERE in = $sid",
        {"sid": ensure_record_id(source_id)},
    )
    for link in links:
        nb_id = link.get("notebook_id")
        if not nb_id:
            continue
        nb_rows = await repo_query(
            "SELECT user_id, name FROM notebook WHERE id = $id",
            {"id": ensure_record_id(str(nb_id))},
        )
        if not nb_rows:
            continue
        nb_role = await effective_role_for_notebook(
            nb_rows[0].get("user_id"), str(nb_id), request
        )
        # Same cascade rule as effective_role_for_source: a notebook owned
        # by someone else grants editor (not owner) on sources merely
        # linked into it.
        cascaded_role: Optional[AccessRole] = (
            "editor" if nb_role == "owner" else nb_role
        )
        role = _max_role(role, cascaded_role)
        if cascaded_role is not None and (
            best_notebook_role is None
            or _ROLE_RANK[cascaded_role] > _ROLE_RANK[best_notebook_role]
        ):
            best_notebook_role = cascaded_role
            best_notebook_label = nb_rows[0].get("name")

    if role is None:
        return None

    match = _direct_or_group_match(matches, role)
    if match is not None:
        if match.get("principal_type") == "group":
            label = await _group_name(str(match.get("principal_id", "")))
            return AccessSummary(role=role, origin="group", origin_label=label)
        return AccessSummary(role=role, origin="direct")
    if best_notebook_role == role:
        label = str(best_notebook_label) if best_notebook_label else None
        return AccessSummary(role=role, origin="notebook", origin_label=label)
    return AccessSummary(role=role, origin="direct")


def assert_owner_or_404(
    owner_user_id: Optional[str], request: Request, detail: str
) -> None:
    """Raise 404 if not owned by current user (legacy owner-only check)."""
    if not auth_enforces_ownership():
        return
    user = current_user_optional(request)
    if user is None:
        return
    if not _same_owner(owner_user_id, user.id):
        raise HTTPException(status_code=404, detail=detail)


async def assert_can_view_notebook_or_404(
    owner_user_id: Optional[str], notebook_id: str, request: Request, detail: str
) -> AccessRole:
    role = await effective_role_for_notebook(owner_user_id, notebook_id, request)
    if role is None:
        raise HTTPException(status_code=404, detail=detail)
    return role


async def assert_can_view_source_or_404(
    owner_user_id: Optional[str], source_id: str, request: Request, detail: str
) -> AccessRole:
    role = await effective_role_for_source(owner_user_id, source_id, request)
    if role is None:
        raise HTTPException(status_code=404, detail=detail)
    return role


async def assert_can_edit_notebook_or_403(
    owner_user_id: Optional[str], notebook_id: str, request: Request, detail: str
) -> AccessRole:
    role = await assert_can_view_notebook_or_404(
        owner_user_id, notebook_id, request, detail
    )
    if not role_at_least(role, "editor"):
        raise HTTPException(
            status_code=403,
            detail="Editor access is required for this action",
        )
    return role


async def assert_can_edit_source_or_403(
    owner_user_id: Optional[str], source_id: str, request: Request, detail: str
) -> AccessRole:
    role = await assert_can_view_source_or_404(
        owner_user_id, source_id, request, detail
    )
    if not role_at_least(role, "editor"):
        raise HTTPException(
            status_code=403,
            detail="Editor access is required for this action",
        )
    return role


def assert_can_delete_source_or_403(
    owner_user_id: Optional[str], request: Request, detail: str = "Source not found"
) -> None:
    """Only the source owner may delete (editors cannot)."""
    if not auth_enforces_ownership():
        return
    user = current_user_optional(request)
    if user is None:
        return
    if not _same_owner(owner_user_id, user.id):
        # Visible via grant → 403; invisible → 404 would need role lookup.
        # Callers should view-check first; if not owner, forbid delete.
        raise HTTPException(
            status_code=403,
            detail="Only the source owner can delete this source",
        )


def assert_can_manage_acl(
    owner_user_id: Optional[str], request: Request, detail: str = "Not found"
) -> None:
    """Owner or admin may manage grants. Non-owners get 404 (no existence leak)."""
    if not auth_enforces_ownership():
        return
    user = current_user_optional(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.role == "admin":
        return
    if _same_owner(owner_user_id, user.id):
        return
    raise HTTPException(status_code=404, detail=detail)


async def assert_note_owner_or_404(
    note_id: str, request: Request, detail: str
) -> None:
    """Raise 404 unless note is on a notebook the user can view."""
    if not auth_enforces_ownership():
        return
    user = current_user_optional(request)
    if user is None:
        return
    links = await repo_query(
        "SELECT out AS notebook_id FROM artifact WHERE in = $note_id",
        {"note_id": ensure_record_id(note_id)},
    )
    for link in links:
        nb_id = link.get("notebook_id")
        if not nb_id:
            continue
        rows = await repo_query(
            "SELECT user_id FROM notebook WHERE id = $id",
            {"id": ensure_record_id(str(nb_id))},
        )
        if not rows:
            continue
        role = await effective_role_for_notebook(
            rows[0].get("user_id"), str(nb_id), request
        )
        if role is not None:
            return
    raise HTTPException(status_code=404, detail=detail)


async def assert_note_editable_or_403(
    note_id: str, request: Request, detail: str
) -> None:
    if not auth_enforces_ownership():
        return
    links = await repo_query(
        "SELECT out AS notebook_id FROM artifact WHERE in = $note_id",
        {"note_id": ensure_record_id(note_id)},
    )
    for link in links:
        nb_id = link.get("notebook_id")
        if not nb_id:
            continue
        rows = await repo_query(
            "SELECT user_id FROM notebook WHERE id = $id",
            {"id": ensure_record_id(str(nb_id))},
        )
        if not rows:
            continue
        role = await effective_role_for_notebook(
            rows[0].get("user_id"), str(nb_id), request
        )
        if role is None:
            continue
        if role_at_least(role, "editor"):
            return
        raise HTTPException(
            status_code=403,
            detail="Editor access is required for this action",
        )
    raise HTTPException(status_code=404, detail=detail)


async def filter_notes_by_owner(notes: list, request: Request) -> list:
    """Keep notes linked to a notebook the user can view."""
    if not auth_enforces_ownership():
        return notes
    user = current_user_optional(request)
    if user is None:
        return notes
    kept = []
    for note in notes:
        if not note.id:
            continue
        try:
            await assert_note_owner_or_404(note.id, request, "Note not found")
            kept.append(note)
        except HTTPException:
            continue
    return kept


def filter_owned_or_hidden(items: list, request: Request, owner_id_of) -> list:
    """Keep items owned by current user (legacy; prefer notebook-aware podcast filter)."""
    if not auth_enforces_ownership():
        return items
    user = current_user_optional(request)
    if user is None:
        return items
    return [item for item in items if _same_owner(owner_id_of(item), user.id)]


async def filter_episodes_by_access(episodes: list, request: Request) -> list:
    """Keep episodes owned by user or whose notebook the user can view."""
    if not auth_enforces_ownership():
        return episodes
    user = current_user_optional(request)
    if user is None:
        return episodes
    kept = []
    for ep in episodes:
        if _same_owner(getattr(ep, "user_id", None), user.id):
            kept.append(ep)
            continue
        nb_id = getattr(ep, "notebook_id", None)
        if not nb_id:
            continue
        rows = await repo_query(
            "SELECT user_id FROM notebook WHERE id = $id",
            {"id": ensure_record_id(str(nb_id))},
        )
        if not rows:
            continue
        role = await effective_role_for_notebook(
            rows[0].get("user_id"), str(nb_id), request
        )
        if role is not None:
            kept.append(ep)
    return kept


async def effective_role_for_episode(
    episode, request: Request
) -> Optional[AccessRole]:
    """Episode's effective role: owner if the episode owner, else inherited
    from its notebook. Mirrors filter_episodes_by_access / the edit guard so
    the response reflects the same decision the enforcement helpers make."""
    if not auth_enforces_ownership():
        return "owner"
    user = current_user_optional(request)
    if user is None:
        return "owner"
    if _same_owner(getattr(episode, "user_id", None), user.id):
        return "owner"
    nb_id = getattr(episode, "notebook_id", None)
    if not nb_id:
        return None
    rows = await repo_query(
        "SELECT user_id FROM notebook WHERE id = $id",
        {"id": ensure_record_id(str(nb_id))},
    )
    if not rows:
        return None
    return await effective_role_for_notebook(
        rows[0].get("user_id"), str(nb_id), request
    )


async def filter_search_results_by_owner(results: list[dict], request: Request) -> list[dict]:
    """Keep search results the user can view via source or notebook grants."""
    if not auth_enforces_ownership():
        return results
    user = current_user_optional(request)
    if user is None:
        return results

    kept: list[dict] = []
    for result in results:
        parent = str(result.get("parent_id", ""))
        if parent.startswith("source:"):
            rows = await repo_query(
                "SELECT user_id FROM source WHERE id = $id",
                {"id": ensure_record_id(parent)},
            )
            if not rows:
                continue
            role = await effective_role_for_source(
                rows[0].get("user_id"), parent, request
            )
            if role is not None:
                kept.append(result)
        elif parent.startswith("note:"):
            try:
                await assert_note_owner_or_404(parent, request, "Note not found")
                kept.append(result)
            except HTTPException:
                continue
    return kept
