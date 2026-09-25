"""Release packaging checks. Prints file names and key names, never .env values."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = ("lfnovo/open_notebook", "ghcr.io/lfnovo", "datafabricx/open-notebook-commercial")
IMAGE_REF = re.compile(
    r"^haribabudfx/open-notebook-commercial:(latest|latest-single|local|v\d+\.\d+\.\d+(-single)?)$"
)
KEY_NAME = re.compile(r"^\s*#?\s*([A-Z][A-Z0-9_]*)=")
ACTIVE = (
    "docker-compose.yml",
    "docker-compose.local.yml",
    "examples/docker-compose-dev.yml",
    "examples/docker-compose-single.yml",
    "examples/docker-compose-ollama.yml",
    "examples/docker-compose-speaches.yml",
    "examples/docker-compose-full-local.yml",
    "examples/easypanel/meta.yaml",
    "Makefile",
    ".github/workflows/build-dev.yml",
    ".github/workflows/build-and-release.yml",
)


def _read(relative: str) -> str:
    path = ROOT / relative
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _active_texts() -> list[tuple[str, str]]:
    found = [(name, _read(name)) for name in ACTIVE]
    for folder in ("scripts/release-test", "docs/1-INSTALLATION"):
        base = ROOT / folder
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if path.is_file():
                found.append((path.relative_to(ROOT).as_posix(), path.read_text(encoding="utf-8")))
    return found


def forbidden_upstream_hits() -> list[str]:
    hits: list[str] = []
    for name, text in _active_texts():
        for needle in FORBIDDEN:
            if needle in text:
                hits.append(f"{name}: {needle}")
    return hits


def image_ref_problem(value: str) -> str | None:
    if IMAGE_REF.fullmatch(value or ""):
        return None
    return "OPEN_NOTEBOOK_IMAGE_REF must be haribabudfx/open-notebook-commercial:latest or :v1.0.0"


def pull_compose_problems() -> list[str]:
    text = _read("docker-compose.yml")
    problems = []
    if "image: ${OPEN_NOTEBOOK_IMAGE_REF:-haribabudfx/open-notebook-commercial:latest}" not in text:
        problems.append("docker-compose.yml: Docker Hub latest tag is missing")
    if "${OPEN_NOTEBOOK_ENCRYPTION_KEY:?set encryption key}" not in text:
        problems.append("docker-compose.yml: encryption key is not required")
    for name in (
        "ENTRA_CLIENT_ID",
        "SHAREPOINT_CONNECTOR_REDIRECT_URI",
        "SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH",
        "SHAREPOINT_STORAGE_CONTAINER_ID",
        "SHAREPOINT_STORAGE_PROFILE_ID",
    ):
        if name not in text:
            problems.append(f"docker-compose.yml: missing {name}")
    return problems


def local_compose_problems() -> list[str]:
    text = _read("docker-compose.local.yml")
    problems = []
    if "image: haribabudfx/open-notebook-commercial:local" not in text:
        problems.append("docker-compose.local.yml: local image tag missing")
    if "build:" not in text or "context: ." not in text:
        problems.append("docker-compose.local.yml: build context missing")
    if "pull_policy: build" not in text:
        problems.append("docker-compose.local.yml: app must build instead of pulling")
    return problems


def example_compose_problems() -> list[str]:
    problems = []
    for name in ("examples/docker-compose-dev.yml", "examples/docker-compose-single.yml"):
        text = _read(name)
        if "context: .." not in text:
            problems.append(f"{name}: build context must be the repository root")
    for name in (
        "examples/docker-compose-ollama.yml",
        "examples/docker-compose-speaches.yml",
        "examples/docker-compose-full-local.yml",
    ):
        if "image: ${OPEN_NOTEBOOK_IMAGE_REF:-haribabudfx/open-notebook-commercial:latest}" not in _read(name):
            problems.append(f"{name}: pull image is not the Docker Hub tag")
    return problems


def callback_example_problems() -> list[str]:
    text = _read(".env.example")
    problems = []
    if "SHAREPOINT_CONNECTOR_REDIRECT_URI=http://localhost:3000/api/connectors/sharepoint/callback" not in text:
        problems.append(".env.example: connector callback must use the frontend origin")
    if ":5055/api/connectors/sharepoint/callback" in text:
        problems.append(".env.example: connector callback must not use the API port")
    return problems


def key_names(text: str) -> set[str]:
    return {match.group(1) for match in (KEY_NAME.match(line) for line in text.splitlines()) if match}


def env_name_gaps() -> list[str]:
    example = key_names(_read(".env.example"))
    private = ROOT / ".env"
    if not private.exists():
        return []
    return sorted(example - key_names(private.read_text(encoding="utf-8")))


def storage_problems(values: dict[str, str]) -> list[str]:
    if values.get("OPEN_NOTEBOOK_ORIGINAL_FILE_STORE") != "sharepoint_embedded":
        return []
    required = (
        "SHAREPOINT_STORAGE_PROFILE_ID",
        "SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH",
        "SHAREPOINT_STORAGE_CONTAINER_ID",
    )
    return [name for name in required if not values.get(name, "").strip()]


def connector_problems(values: dict[str, str]) -> list[str]:
    if values.get("AUTH_PROVIDER") != "entra":
        return []
    uri = values.get("SHAREPOINT_CONNECTOR_REDIRECT_URI", "")
    if not uri.strip():
        return ["SHAREPOINT_CONNECTOR_REDIRECT_URI is unset"]
    if ":5055/" in uri:
        return ["SHAREPOINT_CONNECTOR_REDIRECT_URI must use the public frontend origin"]
    return []


def _parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        values[name.strip()] = value
    return values


def main() -> int:
    problems = [
        *forbidden_upstream_hits(),
        *pull_compose_problems(),
        *local_compose_problems(),
        *example_compose_problems(),
        *callback_example_problems(),
        *[f".env: missing {name}" for name in env_name_gaps()],
    ]
    private = ROOT / ".env"
    if private.exists():
        values = _parse_env(private.read_text(encoding="utf-8"))
        problems.extend(storage_problems(values))
        problems.extend(connector_problems(values))
        ref = values.get("OPEN_NOTEBOOK_IMAGE_REF", "")
        if ref and image_ref_problem(ref):
            problems.append("OPEN_NOTEBOOK_IMAGE_REF is not a Docker Hub tag")
    if problems:
        print("\n".join(problems))
        return 1
    print("release config ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
