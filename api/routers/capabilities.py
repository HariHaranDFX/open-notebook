"""
Capabilities Router

Reports the runtime availability of the opt-in heavy extraction engines
(Docling, Crawl4AI local) plus the ffmpeg/ffprobe binaries needed for audio and
video transcription, so the frontend can gate the corresponding engine options,
the OCR toggle and the media picker. Docling and Crawl4AI are installed on
demand at container startup (see scripts/docker-entrypoint.sh and
docs/7-DEVELOPMENT/decisions/ADR-007-optin-runtimes.md); ffmpeg ships in the
image or is expected on PATH in dev. This endpoint probes what is *actually*
importable/reachable rather than trusting the enable flags.

The probes themselves live in open_notebook.utils.runtime_capabilities because
the source-processing graph needs the same signal (it must not pass content-core
an engine whose runtime is absent, and it must not queue an audio/video
extraction that will fail deep inside content-core with no ffmpeg on PATH).

Endpoints:
- GET /capabilities - Availability of Docling, Crawl4AI and media runtimes
"""

from fastapi import APIRouter

from api.models import CapabilitiesResponse
from open_notebook.utils.runtime_capabilities import (
    crawl4ai_local_ready,
    crawl4ai_remote_configured,
    docling_available,
    media_processing_available,
)

router = APIRouter(prefix="/capabilities", tags=["capabilities"])


@router.get("", response_model=CapabilitiesResponse)
async def get_capabilities():
    """Report which opt-in extraction runtimes are available in this container."""
    crawl4ai_remote = crawl4ai_remote_configured()
    crawl4ai_local = crawl4ai_local_ready()
    return CapabilitiesResponse(
        docling_available=docling_available(),
        crawl4ai_available=crawl4ai_local or crawl4ai_remote,
        crawl4ai_remote_configured=crawl4ai_remote,
        media_processing_available=media_processing_available(),
    )
