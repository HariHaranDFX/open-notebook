"""Tests for the opt-in runtime availability probes.

The engine choice lives in the database; the runtime that serves it comes from
environment flags evaluated at boot. engine_runtime_missing() is what keeps the
two from drifting into a state where extraction is routed to a runtime that
isn't installed.
"""

from unittest.mock import patch

from open_notebook.utils.runtime_capabilities import (
    engine_runtime_missing,
    media_processing_available,
)


class TestEngineRuntimeMissing:
    def test_runtime_free_engines_need_nothing(self):
        """auto/simple/firecrawl/jina carry no opt-in runtime."""
        for engine in ("auto", "simple", "firecrawl", "jina"):
            assert engine_runtime_missing(engine) is None

    def test_none_and_empty_are_not_missing(self):
        assert engine_runtime_missing(None) is None
        assert engine_runtime_missing("") is None

    def test_unknown_engine_is_passed_through(self):
        """An engine we don't know about is content-core's problem, not ours."""
        assert engine_runtime_missing("some-future-engine") is None

    def test_crawl4ai_reports_its_env_var_when_absent(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.crawl4ai_available",
            return_value=False,
        ):
            assert (
                engine_runtime_missing("crawl4ai") == "OPEN_NOTEBOOK_ENABLE_CRAWL4AI"
            )

    def test_crawl4ai_is_usable_when_available(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.crawl4ai_available",
            return_value=True,
        ):
            assert engine_runtime_missing("crawl4ai") is None

    def test_docling_reports_its_env_var_when_absent(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.docling_available",
            return_value=False,
        ):
            assert engine_runtime_missing("docling") == "OPEN_NOTEBOOK_ENABLE_DOCLING"

    def test_docling_is_usable_when_available(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.docling_available",
            return_value=True,
        ):
            assert engine_runtime_missing("docling") is None

    def test_engine_name_is_normalized(self):
        """Stored values shouldn't have to be exactly lowercased to be gated."""
        with patch(
            "open_notebook.utils.runtime_capabilities.crawl4ai_available",
            return_value=False,
        ):
            assert (
                engine_runtime_missing("  Crawl4AI  ")
                == "OPEN_NOTEBOOK_ENABLE_CRAWL4AI"
            )

    def test_remote_crawl4ai_counts_as_available(self):
        """CRAWL4AI_API_URL offloads rendering — no local install needed."""
        with patch(
            "open_notebook.utils.runtime_capabilities.crawl4ai_local_ready",
            return_value=False,
        ), patch(
            "open_notebook.utils.runtime_capabilities.crawl4ai_remote_configured",
            return_value=True,
        ):
            assert engine_runtime_missing("crawl4ai") is None


class TestMediaProcessingAvailable:
    """FFmpeg + FFprobe gate audio/video ingestion.

    content-core shells out to both binaries to decode media before transcription;
    if either is missing, extraction fails deep inside the worker with a cryptic
    error that used to consume the 15-attempt retry budget. The probe lets the
    API/UI advertise media honestly and lets the worker fail fast with a clear
    message. Both binaries must resolve — ffprobe ships alongside ffmpeg in the
    same LGPL apt/brew/winget package, so "one present, one missing" indicates a
    broken install we should not silently paper over.
    """

    def test_both_present_is_available(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.shutil.which",
            side_effect=lambda name: f"/usr/bin/{name}",
        ):
            assert media_processing_available() is True

    def test_only_ffmpeg_present_is_not_available(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.shutil.which",
            side_effect=lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None,
        ):
            assert media_processing_available() is False

    def test_only_ffprobe_present_is_not_available(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.shutil.which",
            side_effect=lambda name: "/usr/bin/ffprobe" if name == "ffprobe" else None,
        ):
            assert media_processing_available() is False

    def test_neither_present_is_not_available(self):
        with patch(
            "open_notebook.utils.runtime_capabilities.shutil.which",
            return_value=None,
        ):
            assert media_processing_available() is False
