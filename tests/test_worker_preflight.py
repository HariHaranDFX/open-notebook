"""Worker-side preflight guards inside open_notebook.graphs.source.

These checks run BEFORE content-core's extract_content() so a doomed upload
raises a permanent ConfigurationError (already in the surreal-commands
stop_on list) instead of consuming the 15-attempt retry budget and dying
with a cryptic error deep inside a third-party library.

Covers:
- Audio/video file when ffmpeg/ffprobe are missing.
- Audio/video file when no Speech-to-Text model is configured.
- Password-protected PDF -- rewritten from pdfminer's PDFPasswordIncorrect
  into a clear ConfigurationError. pdfminer (the library pdfplumber wraps)
  raises during document initialisation, so extract_content fails fast; we
  just make the error actionable.
- Log-honesty helper that labels Docling flags "n/a" when Docling isn't the
  effective document engine (they get passed through but ignored by
  content-core, and printing the raw stored preference misled operators).
"""

import pytest

from open_notebook.exceptions import ConfigurationError
from open_notebook.graphs.source import (
    _label_docling_flag,
    _office_is_encrypted,
    _preflight_upload,
    _rewrite_extraction_error,
    _safe_unlink,
    _url_looks_like_media,
    default_source_title,
)


class TestPreflightMediaFile:
    def test_no_ffmpeg_raises_configuration_error(self):
        with pytest.raises(ConfigurationError) as exc:
            _preflight_upload(
                {"file_path": "song.mp3"},
                media_available=False,
                stt_configured=True,
            )
        assert "ffmpeg" in str(exc.value).lower()

    def test_no_stt_model_raises_configuration_error(self):
        with pytest.raises(ConfigurationError) as exc:
            _preflight_upload(
                {"file_path": "clip.mp4"},
                media_available=True,
                stt_configured=False,
            )
        assert "speech-to-text" in str(exc.value).lower()

    def test_ffmpeg_and_stt_passes(self):
        _preflight_upload(
            {"file_path": "song.mp3"},
            media_available=True,
            stt_configured=True,
        )

    @pytest.mark.parametrize(
        "ext",
        [".mp3", ".mp4", ".wav", ".m4a", ".mov", ".avi", ".mkv", ".webm", ".aac", ".flac", ".ogg", ".wmv"],
    )
    def test_all_media_extensions_are_gated(self, ext):
        with pytest.raises(ConfigurationError):
            _preflight_upload(
                {"file_path": f"upload{ext}"},
                media_available=False,
                stt_configured=True,
            )

    def test_case_insensitive_extension_match(self):
        with pytest.raises(ConfigurationError):
            _preflight_upload(
                {"file_path": "SONG.MP3"},
                media_available=False,
                stt_configured=True,
            )


class TestUrlLooksLikeMedia:
    """URL detection must handle query strings and case, because the raw
    os.path.splitext of a URL wrongly puts the query into the extension
    (e.g. splitext('https://x/y.mp3?t=1') -> ('...y', '.mp3?t=1')).
    """

    @pytest.mark.parametrize(
        "url",
        [
            "https://samplelib.com/mp3/sample-speech-5m.mp3",
            "https://samplelib.com/mp4/sample-10s.mp4",
            "http://host/path/audio.wav",
            "https://cdn.example.com/media/clip.m4a",
        ],
    )
    def test_media_urls_are_detected(self, url):
        assert _url_looks_like_media(url) is True

    def test_query_string_does_not_break_detection(self):
        assert (
            _url_looks_like_media("https://x.com/audio.mp3?token=abc&sig=xyz")
            is True
        )

    def test_case_insensitive(self):
        assert _url_looks_like_media("https://EXAMPLE.COM/SONG.MP3") is True

    @pytest.mark.parametrize(
        "url",
        [
            "https://example.com/article.html",
            "https://example.com/paper.pdf",
            "https://api.example.com/media/12345",  # no extension in path
            "https://youtube.com/watch?v=abc",
            "",
        ],
    )
    def test_non_media_urls_are_not_detected(self, url):
        assert _url_looks_like_media(url) is False


class TestPreflightUrlMedia:
    """Preflight is source-agnostic: file_path OR url, whichever the caller has."""

    def test_media_url_without_ffmpeg_is_rejected(self):
        with pytest.raises(ConfigurationError) as exc:
            _preflight_upload(
                {"url": "https://samplelib.com/mp3/sample.mp3"},
                media_available=False,
                stt_configured=True,
            )
        assert "ffmpeg" in str(exc.value).lower()

    def test_media_url_with_query_string_still_gated(self):
        with pytest.raises(ConfigurationError):
            _preflight_upload(
                {"url": "https://x.com/audio.mp3?token=abc"},
                media_available=False,
                stt_configured=True,
            )

    def test_media_url_needs_stt(self):
        with pytest.raises(ConfigurationError) as exc:
            _preflight_upload(
                {"url": "https://x.com/song.mp3"},
                media_available=True,
                stt_configured=False,
            )
        assert "speech-to-text" in str(exc.value).lower()

    def test_html_url_passes_even_without_media(self):
        _preflight_upload(
            {"url": "https://example.com/article"},
            media_available=False,
            stt_configured=False,
        )

    def test_youtube_url_is_not_media_gated(self):
        """YouTube goes through its own transcript extractor, no ffmpeg needed."""
        _preflight_upload(
            {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
            media_available=False,
            stt_configured=False,
        )


class TestSafeUnlink:
    def test_deletes_existing_file(self, tmp_path):
        f = tmp_path / "delete_me.txt"
        f.write_text("bye")
        _safe_unlink(str(f))
        assert not f.exists()

    def test_missing_file_does_not_raise(self, tmp_path):
        # No raise, no complaint.
        _safe_unlink(str(tmp_path / "nope.txt"))

    def test_none_is_a_noop(self):
        _safe_unlink(None)


class TestPreflightSkips:
    def test_plaintext_file_passes(self):
        _preflight_upload(
            {"file_path": "notes.txt"},
            media_available=False,
            stt_configured=False,
        )

    def test_pdf_is_not_preflighted(self):
        """PDF encryption is caught by _rewrite_extraction_error, not preflight,
        because pdfminer fails fast at doc-init inside extract_content()."""
        _preflight_upload(
            {"file_path": "report.pdf"},
            media_available=False,
            stt_configured=False,
        )


class TestPreflightPdfEncryption:
    """The user-hit case: a password-protected PDF used to retry 15 times
    because pdfplumber wraps PDFPasswordIncorrect in an empty-message
    PdfminerException, then content-core wraps THAT again as
    Exception('An error occurred: '). By the time our code sees it, both the
    type and the message are useless for keyword matching. The preemptive
    /Encrypt byte scan sidesteps both wrappers -- if the marker is in the
    file, it's encrypted, period."""

    def test_encrypted_pdf_is_rejected_via_byte_scan(self, tmp_path):
        # Minimal PDF-shaped bytes with a trailer that references /Encrypt.
        # The scan is a substring match; no real cryptography needed.
        pdf = tmp_path / "protected.pdf"
        pdf.write_bytes(
            b"%PDF-1.4\n"
            b"1 0 obj\n<< /Type /Catalog >>\nendobj\n"
            b"trailer\n<< /Size 1 /Root 1 0 R /Encrypt 2 0 R >>\n"
            b"%%EOF\n"
        )
        with pytest.raises(ConfigurationError) as exc:
            _preflight_upload(
                {"file_path": str(pdf)},
                media_available=True,
                stt_configured=True,
            )
        assert "password" in str(exc.value).lower()

    def test_plain_pdf_passes(self, tmp_path):
        pdf = tmp_path / "open.pdf"
        pdf.write_bytes(
            b"%PDF-1.4\n"
            b"1 0 obj\n<< /Type /Catalog >>\nendobj\n"
            b"trailer\n<< /Size 1 /Root 1 0 R >>\n"
            b"%%EOF\n"
        )
        # Must not raise.
        _preflight_upload(
            {"file_path": str(pdf)},
            media_available=True,
            stt_configured=True,
        )

    def test_missing_pdf_file_does_not_raise_here(self, tmp_path):
        """A missing file is not an "encrypted" verdict; the preflight lets
        the extractor's own FileNotFoundError surface with its real message."""
        _preflight_upload(
            {"file_path": str(tmp_path / "gone.pdf")},
            media_available=True,
            stt_configured=True,
        )

    def test_non_pdf_extension_is_not_byte_scanned(self, tmp_path):
        """A .docx that happens to contain the bytes /Encrypt anywhere in its
        zip payload must NOT be flagged as an encrypted PDF."""
        docx = tmp_path / "innocent.docx"
        docx.write_bytes(b"PK\x03\x04 zip-bytes with /Encrypt in a stream")
        # Must not raise.
        _preflight_upload(
            {"file_path": str(docx)},
            media_available=True,
            stt_configured=True,
        )


class TestPreflightOfficeEncryption:
    """python-docx / openpyxl / python-pptx expect their input to be a ZIP
    archive (docx/xlsx/pptx are ZIP-based). When Office encrypts a file, it
    switches the container to OLE compound-document format (magic bytes
    D0 CF 11 E0 A1 B1 1A E1). The Python libraries then fail with vague
    "Package not found" / "not a zip file" errors that our post-hoc
    _rewrite_extraction_error can't match on. Detect the OLE magic before
    extraction so the user sees the actual cause on the first attempt."""

    _OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    _ZIP = b"PK\x03\x04"

    @pytest.mark.parametrize("ext", [".docx", ".xlsx", ".pptx"])
    def test_encrypted_office_is_rejected(self, tmp_path, ext):
        f = tmp_path / f"protected{ext}"
        f.write_bytes(self._OLE + b"\x00" * 64)
        with pytest.raises(ConfigurationError) as exc:
            _preflight_upload(
                {"file_path": str(f)},
                media_available=True,
                stt_configured=True,
            )
        assert "password" in str(exc.value).lower()

    @pytest.mark.parametrize("ext", [".docx", ".xlsx", ".pptx"])
    def test_plain_office_passes(self, tmp_path, ext):
        f = tmp_path / f"open{ext}"
        f.write_bytes(self._ZIP + b"rest of a normal Office file")
        _preflight_upload(
            {"file_path": str(f)},
            media_available=True,
            stt_configured=True,
        )

    def test_legacy_doc_is_not_ole_checked(self, tmp_path):
        """Legacy .doc/.xls/.ppt are ALWAYS OLE (encrypted or not). Applying
        the check to them would falsely reject every plain legacy file."""
        f = tmp_path / "old.doc"
        f.write_bytes(self._OLE + b"legacy but not encrypted")
        # Must not raise.
        _preflight_upload(
            {"file_path": str(f)},
            media_available=True,
            stt_configured=True,
        )

    def test_office_helper_direct(self, tmp_path):
        f = tmp_path / "e.docx"
        f.write_bytes(self._OLE + b"...")
        assert _office_is_encrypted(str(f)) is True
        f.write_bytes(self._ZIP + b"...")
        assert _office_is_encrypted(str(f)) is False

    def test_missing_file_returns_false(self, tmp_path):
        assert _office_is_encrypted(str(tmp_path / "gone.docx")) is False


class TestRewriteExtractionErrorForEncryption:
    """content-core -> pdfplumber -> pdfminer raises PDFPasswordIncorrect (and
    friends) when it opens an encrypted PDF. Without translation, the worker
    treats it as transient and burns 15 retry attempts. We map the family of
    encryption errors to ConfigurationError so surreal-commands stops on the
    first try and the UI shows a real message."""

    def test_pdfminer_password_incorrect_becomes_configuration_error(self):
        from pdfminer.pdfdocument import PDFPasswordIncorrect

        with pytest.raises(ConfigurationError) as exc:
            _rewrite_extraction_error(PDFPasswordIncorrect("wrong password"))
        assert "password" in str(exc.value).lower()

    def test_pdfminer_encryption_error_becomes_configuration_error(self):
        from pdfminer.pdfdocument import PDFEncryptionError

        with pytest.raises(ConfigurationError) as exc:
            _rewrite_extraction_error(PDFEncryptionError("bad crypto"))
        assert "password" in str(exc.value).lower()

    def test_generic_error_mentioning_encryption_is_translated(self):
        """Belt-and-suspenders: if an Office/other extractor raises its own
        encryption-flavoured exception, the message-substring fallback catches it."""
        with pytest.raises(ConfigurationError) as exc:
            _rewrite_extraction_error(
                RuntimeError("File is encrypted and cannot be read")
            )
        assert "password" in str(exc.value).lower()

    def test_unrelated_error_is_reraised_unchanged(self):
        original = ConnectionError("network down")
        with pytest.raises(ConnectionError) as exc:
            _rewrite_extraction_error(original)
        assert exc.value is original


class TestDoclingLogHonesty:
    """The log line used to print the user's stored Docling preferences verbatim
    even when the effective document engine wasn't Docling (e.g. Docling not
    installed -> engine falls back to 'auto' via _usable_engine, but
    docling_ocr=True was still logged). content-core ignores those flags
    outside Docling; printing them read as if OCR/formulas/vision were active
    when they weren't. See the log excerpt attached to commit #3 of
    fix/ingestion-media-capability for the real-world case."""

    def test_docling_engine_shows_the_stored_value(self):
        assert _label_docling_flag(True, "docling") == "True"
        assert _label_docling_flag(False, "docling") == "False"

    def test_none_shows_auto_under_docling(self):
        assert _label_docling_flag(None, "docling") == "auto"

    def test_non_docling_engine_shows_na(self):
        assert _label_docling_flag(True, "auto") == "n/a"
        assert _label_docling_flag(True, "simple") == "n/a"
        assert _label_docling_flag(None, "auto") == "n/a"


class TestDefaultSourceTitle:
    """The friendly fallback the source gets when the user doesn't type a title.

    Uploads become their filename (invoice.pdf), URLs become the URL string,
    and text sources fall back to 'Processing...' because extraction always
    succeeds for text and will overwrite immediately. The friendly default
    means a permanent-failure source keeps a meaningful title instead of
    being frozen as 'Processing...' forever.
    """

    def test_upload_uses_basename(self):
        assert default_source_title({"file_path": "/uploads/invoice.pdf"}) == "invoice.pdf"

    def test_upload_windows_path(self):
        # Backslash separator resolves the same way on all platforms because
        # our upload folder is always posix-style; guard against surprises.
        result = default_source_title({"file_path": r"C:\uploads\report Q4.docx"})
        assert result.endswith("report Q4.docx")

    def test_url_returns_the_url_string(self):
        assert (
            default_source_title({"url": "https://samplelib.com/mp3/sample.mp3"})
            == "https://samplelib.com/mp3/sample.mp3"
        )

    def test_url_with_query_string_kept_intact(self):
        url = "https://example.com/doc?tab=1&sig=abc"
        assert default_source_title({"url": url}) == url

    def test_text_content_falls_back_to_processing(self):
        # Text sources always extract on the first attempt; the placeholder
        # never sticks in practice, so no filename to derive from.
        assert default_source_title({"content": "some text"}) == "Processing..."

    def test_empty_content_state_falls_back_to_processing(self):
        assert default_source_title({}) == "Processing..."

    def test_file_path_wins_over_url_when_both_present(self):
        # This shouldn't happen in practice, but the ordering is deterministic.
        state = {"file_path": "/uploads/a.pdf", "url": "https://example.com/x"}
        assert default_source_title(state) == "a.pdf"


class TestConfigurationErrorIsStopped:
    """Retries are gated by ``stop_on=[ValueError, ConfigurationError]`` on the
    surreal-commands @command decorator (commands/source_commands.py). Raising
    ConfigurationError makes the worker mark the job ``failed`` on the first
    try instead of burning 15 attempts of exponential backoff (1s -> 120s cap)
    -- the exact loop that made the bank-statement PDF and .mp3 URL retry
    forever with a cryptic finish."""

    def test_ffmpeg_missing_raises_configuration_error_not_valueerror(self):
        """Deliberately narrow: ConfigurationError so the API's global handler
        maps it to HTTP 422, matching how ContentSettings errors are surfaced."""
        with pytest.raises(ConfigurationError):
            _preflight_upload(
                {"file_path": "clip.wav"},
                media_available=False,
                stt_configured=True,
            )
