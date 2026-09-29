"""The backend map stays aligned with mounted routes, migrations, and env names."""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / "docs" / "BACKEND_MAP.md"
ROUTERS = ROOT / "api" / "routers"

MOUNT = {
    "auth.py": "/api/auth",
    "connectors.py": "/api/connectors/sharepoint",
    "config.py": "/api",
    "groups.py": "/api",
    "grants.py": "/api",
    "notebooks.py": "/api",
    "search.py": "/api",
    "models.py": "/api",
    "transformations.py": "/api",
    "notes.py": "/api",
    "embedding.py": "/api",
    "embedding_rebuild.py": "/api/embeddings",
    "settings.py": "/api",
    "sources.py": "/api",
    "source_files.py": "/api",
    "insights.py": "/api",
    "commands.py": "/api",
    "podcasts.py": "/api",
    "episode_profiles.py": "/api",
    "speaker_profiles.py": "/api",
    "chat.py": "/api",
    "source_chat.py": "/api",
    "credentials.py": "/api/credentials",
    "providers.py": "/api/providers",
    "capabilities.py": "/api/capabilities",
    "languages.py": "/api",
}

PLAYBOOKS = (
    "## How do I add an endpoint?",
    "## How do I add a domain model and migration?",
    "## How do I add a provider?",
    "## How do I add a background job?",
    "## How do I add a source type?",
)


def _const(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _join(mount: str, route: str) -> str:
    if not route:
        return mount or "/"
    return mount.rstrip("/") + (route if route.startswith("/") else "/" + route)


def _routes() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for name, mount in MOUNT.items():
        tree = ast.parse((ROUTERS / name).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                if not isinstance(dec, ast.Call):
                    continue
                func = dec.func
                if not (
                    isinstance(func, ast.Attribute)
                    and isinstance(func.value, ast.Name)
                    and func.value.id == "router"
                ):
                    continue
                path = _const(dec.args[0]) if dec.args else ""
                found.append((func.attr.upper(), _join(mount, path or "")))
    return found


def test_backend_map_lists_every_route():
    text = MAP.read_text(encoding="utf-8")
    missing = [
        f"{method} {path}"
        for method, path in _routes()
        if f"| {method} | `{path}` |" not in text
    ]
    assert missing == []
    assert "| GET | `/` |" in text
    assert "| GET | `/health` |" in text


def test_backend_map_names_routers_migrations_and_playbooks():
    text = MAP.read_text(encoding="utf-8")
    for name in MOUNT:
        assert f"api/routers/{name}" in text
    for number in range(1, 36):
        assert f"| {number} |" in text
    for heading in PLAYBOOKS:
        assert heading in text


def test_backend_map_names_environment_reference_variables():
    text = MAP.read_text(encoding="utf-8")
    reference = (ROOT / "docs" / "5-CONFIGURATION" / "environment-reference.md").read_text(
        encoding="utf-8"
    )
    names = re.findall(r"^\| `([A-Z0-9_]+)`", reference, re.M)
    missing = sorted({name for name in names if f"`{name}`" not in text})
    assert missing == []
    assert "`OPEN_NOTEBOOK_CHUNK_SIZE`" in text
    assert "`OPEN_NOTEBOOK_CHUNK_OVERLAP`" in text
