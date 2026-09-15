from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from api.auth.deps import require_admin_if_auth
from api.models import SettingsResponse, SettingsUpdate
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.exceptions import (
    InvalidInputError,
    OpenNotebookError,
)

router = APIRouter(dependencies=[Depends(require_admin_if_auth)])


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    """Get all application settings."""
    try:
        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]

        return _to_response(settings)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching settings: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Error fetching settings"
        )


def _to_response(settings: ContentSettings) -> SettingsResponse:
    """Map domain settings to the public SettingsResponse.

    Retention-governance rollout: ``auto_delete_files`` is no longer
    surfaced. Legacy clients that still send it get 422 from
    SettingsUpdate's ``extra='forbid'`` — they must adopt the new
    ``original_file_policy`` explicitly.
    """
    return SettingsResponse(
        default_content_processing_engine_doc=settings.default_content_processing_engine_doc,
        default_content_processing_engine_url=settings.default_content_processing_engine_url,
        default_embedding_option=settings.default_embedding_option,
        docling_ocr=settings.docling_ocr,
        docling_formulas=settings.docling_formulas,
        docling_vision=settings.docling_vision,
        youtube_preferred_languages=settings.youtube_preferred_languages,
        original_file_policy=settings.original_file_policy,
        original_file_user_default=settings.original_file_user_default,
        allow_source_owner_cleanup=settings.allow_source_owner_cleanup,
    )


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(settings_update: SettingsUpdate):
    """Update application settings."""
    try:
        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]

        # Assign typed Pydantic values directly — the model already
        # narrowed the strings via Literal validators.
        update_dict = settings_update.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            setattr(settings, field, value)

        await settings.update()

        return _to_response(settings)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating settings: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Error updating settings"
        )
