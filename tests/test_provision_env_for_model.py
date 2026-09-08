"""Tests for provision_env_for_model — the model-scoped credential provisioner.

Used by call sites that can't pass a config dict inline (currently the
content-core audio path, which reaches esperanto's create_speech_to_text /
create_text_to_speech through a fixed signature). Mirrors what
ModelManager.get_model does for chat/embedding, but via env vars.

The key contract: prefer the credential LINKED to the model over the
provider's default credential, so a multi-credential setup (e.g. two Azure
credentials for LLM vs STT resources) routes each model to its correct
credential.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from open_notebook.ai.key_provider import provision_env_for_model


def _fake_model(provider, credential_id="credential:linked"):
    """Model MagicMock with a linked credential id."""
    m = MagicMock()
    m.provider = provider
    m.credential = credential_id
    m.id = "model:test"
    return m


def _fake_credential(**overrides):
    """Credential MagicMock with SecretStr-typed api_key, real fields otherwise."""
    api_key_value = overrides.pop("api_key", None)
    c = MagicMock()
    c.name = overrides.pop("name", "Linked Credential")
    for field in (
        "base_url", "endpoint", "api_version",
        "endpoint_llm", "endpoint_embedding", "endpoint_stt", "endpoint_tts",
        "project", "location", "credentials_path",
    ):
        setattr(c, field, overrides.pop(field, None))
    if api_key_value is not None:
        c.api_key = SecretStr(api_key_value)
    else:
        c.api_key = None
    if overrides:
        raise AssertionError(f"unexpected overrides: {list(overrides)}")
    return c


class TestAzureModalityRouting:
    """The user-hit case: two Azure credentials, one for LLM/embedding and one
    for STT/TTS on a different endpoint. The linked STT credential's values
    must land in AZURE_OPENAI_*_STT env vars, which esperanto prefers over
    the base AZURE_OPENAI_* vars."""

    @pytest.mark.asyncio
    async def test_azure_stt_uses_linked_credential_modality_vars(self, monkeypatch):
        for var in (
            "AZURE_OPENAI_API_KEY_STT", "AZURE_OPENAI_ENDPOINT_STT",
            "AZURE_OPENAI_API_VERSION_STT",
        ):
            monkeypatch.delenv(var, raising=False)

        model = _fake_model("azure")
        credential = _fake_credential(
            api_key="podcast-key",
            endpoint="https://podcast-tts-stt-resource.openai.azure.com/",
            api_version="2025-04-01-preview",
        )
        model.get_credential_obj = AsyncMock(return_value=credential)

        await provision_env_for_model(model, modality="STT")

        import os
        assert os.environ["AZURE_OPENAI_API_KEY_STT"] == "podcast-key"
        assert (
            os.environ["AZURE_OPENAI_ENDPOINT_STT"]
            == "https://podcast-tts-stt-resource.openai.azure.com/"
        )
        assert os.environ["AZURE_OPENAI_API_VERSION_STT"] == "2025-04-01-preview"

    @pytest.mark.asyncio
    async def test_azure_stt_endpoint_stt_wins_over_endpoint(self, monkeypatch):
        monkeypatch.delenv("AZURE_OPENAI_ENDPOINT_STT", raising=False)
        model = _fake_model("azure")
        credential = _fake_credential(
            api_key="k",
            endpoint="https://shared.openai.azure.com/",
            endpoint_stt="https://stt-specific.openai.azure.com/",
            api_version="2025-04-01-preview",
        )
        model.get_credential_obj = AsyncMock(return_value=credential)

        await provision_env_for_model(model, modality="STT")

        import os
        assert (
            os.environ["AZURE_OPENAI_ENDPOINT_STT"]
            == "https://stt-specific.openai.azure.com/"
        )

    @pytest.mark.asyncio
    async def test_azure_tts_uses_tts_vars(self, monkeypatch):
        monkeypatch.delenv("AZURE_OPENAI_API_KEY_TTS", raising=False)
        model = _fake_model("azure")
        credential = _fake_credential(
            api_key="voice-key", endpoint="https://voice.openai.azure.com/",
            api_version="2025-04-01-preview",
        )
        model.get_credential_obj = AsyncMock(return_value=credential)

        await provision_env_for_model(model, modality="TTS")

        import os
        assert os.environ["AZURE_OPENAI_API_KEY_TTS"] == "voice-key"

    @pytest.mark.asyncio
    async def test_azure_modality_does_not_disturb_base_vars(self, monkeypatch):
        """A different Azure credential may own the base vars (LLM/embedding).
        Setting the modality-specific vars must not clobber them."""
        monkeypatch.setenv("AZURE_OPENAI_API_KEY", "llm-key")
        monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://llm-resource/")
        model = _fake_model("azure")
        credential = _fake_credential(
            api_key="stt-key", endpoint="https://stt-resource/",
            api_version="2025-04-01-preview",
        )
        model.get_credential_obj = AsyncMock(return_value=credential)

        await provision_env_for_model(model, modality="STT")

        import os
        assert os.environ["AZURE_OPENAI_API_KEY"] == "llm-key"  # untouched
        assert os.environ["AZURE_OPENAI_API_KEY_STT"] == "stt-key"


class TestSimpleProviders:
    """OpenAI, Groq, Mistral, DeepSeek, xAI, ElevenLabs, Deepgram, etc. — one
    env var per provider. modality is ignored (no per-modality routing in
    esperanto for these)."""

    @pytest.mark.asyncio
    async def test_openai_sets_api_key_from_linked_cred(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        model = _fake_model("openai")
        model.get_credential_obj = AsyncMock(
            return_value=_fake_credential(api_key="sk-live-abc")
        )
        await provision_env_for_model(model, modality="STT")

        import os
        assert os.environ["OPENAI_API_KEY"] == "sk-live-abc"

    @pytest.mark.asyncio
    async def test_deepgram_sets_api_key(self, monkeypatch):
        monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
        model = _fake_model("deepgram")
        model.get_credential_obj = AsyncMock(
            return_value=_fake_credential(api_key="dg-xyz")
        )
        await provision_env_for_model(model, modality="STT")

        import os
        assert os.environ["DEEPGRAM_API_KEY"] == "dg-xyz"

    @pytest.mark.asyncio
    async def test_ollama_sets_base_url_and_no_key(self, monkeypatch):
        monkeypatch.delenv("OLLAMA_API_BASE", raising=False)
        model = _fake_model("ollama")
        # Local Ollama typically has no api_key; base_url points at the daemon.
        model.get_credential_obj = AsyncMock(
            return_value=_fake_credential(base_url="http://192.168.1.10:11434")
        )
        await provision_env_for_model(model, modality="TTS")

        import os
        assert os.environ["OLLAMA_API_BASE"] == "http://192.168.1.10:11434"


class TestCompatibleProviders:
    @pytest.mark.asyncio
    async def test_openai_compatible_sets_prefixed_vars(self, monkeypatch):
        monkeypatch.delenv("OPENAI_COMPATIBLE_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_COMPATIBLE_BASE_URL", raising=False)
        model = _fake_model("openai_compatible")
        model.get_credential_obj = AsyncMock(return_value=_fake_credential(
            api_key="compat-key",
            base_url="https://custom.example.com/v1",
        ))
        await provision_env_for_model(model, modality="STT")

        import os
        assert os.environ["OPENAI_COMPATIBLE_API_KEY"] == "compat-key"
        assert os.environ["OPENAI_COMPATIBLE_BASE_URL"] == "https://custom.example.com/v1"


class TestNoLinkedCredential:
    """When the model has no linked credential, delegate to the existing
    default-credential provisioner so behavior is unchanged for the common
    case (one credential per provider, marked default)."""

    @pytest.mark.asyncio
    async def test_no_linked_credential_delegates_to_default_provisioner(self, monkeypatch):
        model = _fake_model("openai", credential_id=None)
        with patch(
            "open_notebook.ai.key_provider.provision_provider_keys",
            new=AsyncMock(return_value=True),
        ) as mock_default:
            await provision_env_for_model(model, modality="STT")
        mock_default.assert_awaited_once_with("openai")

    @pytest.mark.asyncio
    async def test_get_credential_obj_returns_none_falls_back(self, monkeypatch):
        """The model.credential ID exists but the credential row was deleted —
        get_credential_obj returns None."""
        model = _fake_model("azure")
        model.get_credential_obj = AsyncMock(return_value=None)
        with patch(
            "open_notebook.ai.key_provider.provision_provider_keys",
            new=AsyncMock(return_value=True),
        ) as mock_default:
            await provision_env_for_model(model, modality="STT")
        mock_default.assert_awaited_once_with("azure")


class TestNoOp:
    @pytest.mark.asyncio
    async def test_none_model_is_noop(self):
        # No raise.
        await provision_env_for_model(None, modality="STT")

    @pytest.mark.asyncio
    async def test_model_without_provider_is_noop(self):
        m = MagicMock()
        m.provider = None
        await provision_env_for_model(m, modality="STT")
