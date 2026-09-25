"""Packaging gates. Failure text names files and keys, never secret values."""

from scripts.check_release_config import (
    callback_example_problems,
    connector_problems,
    env_name_gaps,
    example_compose_problems,
    forbidden_upstream_hits,
    image_ref_problem,
    local_compose_problems,
    pull_compose_problems,
    storage_problems,
)

def test_image_ref_accepts_latest_and_version_tags():
    assert image_ref_problem("haribabudfx/open-notebook-commercial:latest") is None
    assert image_ref_problem("haribabudfx/open-notebook-commercial:v1.0.0") is None
    assert image_ref_problem("")
    assert image_ref_problem("lfnovo/open_notebook:latest")
    assert image_ref_problem("datafabricx/open-notebook-commercial:latest")
    assert image_ref_problem("haribabudfx/open-notebook-commercial:v1-latest")
    assert image_ref_problem("haribabudfx/open-notebook-commercial@sha256:" + ("a" * 64))


def test_pull_compose_uses_docker_hub_latest_and_requires_encryption():
    assert pull_compose_problems() == []


def test_local_compose_builds_this_checkout():
    assert local_compose_problems() == []


def test_examples_build_from_the_repo_or_pull_docker_hub():
    assert example_compose_problems() == []


def test_active_packaging_does_not_pull_upstream_images():
    assert forbidden_upstream_hits() == []


def test_connector_callback_example_uses_the_frontend_origin():
    assert callback_example_problems() == []


def test_ignored_env_has_every_example_key_name():
    gaps = env_name_gaps()
    assert gaps == []
    assert all("=" not in name for name in gaps)


def test_selected_sharepoint_storage_fails_closed_without_values():
    incomplete = {"OPEN_NOTEBOOK_ORIGINAL_FILE_STORE": "sharepoint_embedded"}
    missing = storage_problems(incomplete)
    assert "SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH" in missing
    assert "SHAREPOINT_STORAGE_CONTAINER_ID" in missing
    assert storage_problems({"OPEN_NOTEBOOK_ORIGINAL_FILE_STORE": "filesystem"}) == []


def test_entra_callback_problem_does_not_echo_the_uri():
    problems = connector_problems({
        "AUTH_PROVIDER": "entra",
        "SHAREPOINT_CONNECTOR_REDIRECT_URI": "http://localhost:5055/api/connectors/sharepoint/callback",
    })
    assert problems == ["SHAREPOINT_CONNECTOR_REDIRECT_URI must use the public frontend origin"]
    assert connector_problems({"AUTH_PROVIDER": "password"}) == []
