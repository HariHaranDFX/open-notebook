from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from api.models import NoteResponse, SaveAsNoteRequest, SourceInsightResponse
from api.ownership import (
    assert_can_edit_notebook_or_403,
    assert_can_edit_source_or_403,
    assert_can_view_source_or_404,
)
from open_notebook.domain.notebook import Notebook, SourceInsight
from open_notebook.exceptions import (
    InvalidInputError,
    NotFoundError,
    OpenNotebookError,
)

router = APIRouter()


@router.get("/insights/{insight_id}", response_model=SourceInsightResponse)
async def get_insight(insight_id: str, request: Request):
    """Get a specific insight by ID."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        # Get source ID from the insight relationship
        source = await insight.get_source()
        await assert_can_view_source_or_404(
            source.user_id, source.id or "", request, "Insight not found"
        )

        return SourceInsightResponse(
            id=insight.id or "",
            source_id=source.id or "",
            insight_type=insight.insight_type,
            content=insight.content,
            created=insight.created.isoformat() if insight.created else None,
            updated=insight.updated.isoformat() if insight.updated else None,
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching insight {insight_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching insight")


@router.delete("/insights/{insight_id}")
async def delete_insight(insight_id: str, request: Request):
    """Delete a specific insight."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        source = await insight.get_source()
        await assert_can_edit_source_or_403(
            source.user_id, source.id or "", request, "Insight not found"
        )

        await insight.delete()

        return {"message": "Insight deleted successfully"}
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting insight {insight_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error deleting insight")


@router.post("/insights/{insight_id}/save-as-note", response_model=NoteResponse)
async def save_insight_as_note(
    insight_id: str, request: SaveAsNoteRequest, http_request: Request
):
    """Convert an insight to a note."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        source = await insight.get_source()
        await assert_can_view_source_or_404(
            source.user_id, source.id or "", http_request, "Insight not found"
        )
        if request.notebook_id:
            notebook = await Notebook.get(request.notebook_id)
            await assert_can_edit_notebook_or_403(
                notebook.user_id,
                request.notebook_id,
                http_request,
                "Notebook not found",
            )

        # Use the existing save_as_note method from the domain model
        note = await insight.save_as_note(request.notebook_id)

        return NoteResponse(
            id=note.id or "",
            title=note.title,
            content=note.content,
            note_type=note.note_type,
            created=str(note.created),
            updated=str(note.updated),
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error saving insight {insight_id} as note: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Error saving insight as note"
        )
