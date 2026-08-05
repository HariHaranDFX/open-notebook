from typing import List

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from api.models import (
    DefaultPromptResponse,
    DefaultPromptUpdate,
    TransformationCreate,
    TransformationExecuteRequest,
    TransformationExecuteResponse,
    TransformationResponse,
    TransformationUpdate,
)
from api.transformation_access import (
    access_flags,
    assert_can_delete,
    assert_can_edit,
    assert_can_edit_default_prompt,
    assert_can_restore,
    assert_can_view,
    current_user_for_transformations,
    list_visible_transformations,
    restore_builtin,
    soft_delete_builtin,
    stamp_on_create,
)
from open_notebook.ai.models import Model
from open_notebook.domain.transformation import DefaultPrompts, Transformation
from open_notebook.exceptions import InvalidInputError, OpenNotebookError
from open_notebook.graphs.transformation import graph as transformation_graph

router = APIRouter()


def _transformation_response(
    transformation: Transformation, request: Request
) -> TransformationResponse:
    user = current_user_for_transformations(request)
    can_edit, can_delete, can_restore = access_flags(transformation, user)
    deleted_at = (
        str(transformation.deleted_at) if transformation.deleted_at is not None else None
    )
    return TransformationResponse(
        id=transformation.id or "",
        name=transformation.name,
        title=transformation.title,
        description=transformation.description,
        prompt=transformation.prompt,
        apply_default=transformation.apply_default,
        model_id=transformation.model_id,
        user_id=transformation.user_id,
        is_builtin=transformation.is_builtin,
        deleted_at=deleted_at,
        can_edit=can_edit,
        can_delete=can_delete,
        can_restore=can_restore,
        created=str(transformation.created),
        updated=str(transformation.updated),
    )


@router.get("/transformations", response_model=List[TransformationResponse])
async def get_transformations(request: Request):
    """List shared + own personal transformations (admins see soft-deleted builtins)."""
    try:
        transformations = await list_visible_transformations(request)
        return [
            _transformation_response(transformation, request)
            for transformation in transformations
        ]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching transformations: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching transformations: {str(e)}"
        )


@router.post("/transformations", response_model=TransformationResponse)
async def create_transformation(
    request: Request, transformation_data: TransformationCreate
):
    """Create a transformation (admin → shared; user → personal)."""
    try:
        if transformation_data.model_id:
            model = await Model.get(transformation_data.model_id)
            if not model:
                raise HTTPException(status_code=404, detail="Model not found")

        new_transformation = Transformation(
            name=transformation_data.name,
            title=transformation_data.title,
            description=transformation_data.description,
            prompt=transformation_data.prompt,
            apply_default=transformation_data.apply_default,
            model_id=transformation_data.model_id,
        )
        stamp_on_create(new_transformation, current_user_for_transformations(request))
        await new_transformation.save()

        return _transformation_response(new_transformation, request)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating transformation: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating transformation: {str(e)}"
        )


@router.post("/transformations/execute", response_model=TransformationExecuteResponse)
async def execute_transformation(
    request: Request, execute_request: TransformationExecuteRequest
):
    """Execute a transformation on input text."""
    try:
        transformation = await Transformation.get(execute_request.transformation_id)
        if not transformation:
            raise HTTPException(status_code=404, detail="Transformation not found")
        assert_can_view(transformation, request)

        model_id = execute_request.model_id or transformation.model_id

        if model_id:
            model = await Model.get(model_id)
            if not model:
                raise HTTPException(status_code=404, detail="Model not found")

        result = await transformation_graph.ainvoke(  # type: ignore[call-overload]
            dict(
                input_text=execute_request.input_text,
                transformation=transformation,
            ),
            config=dict(configurable={"model_id": model_id}),
        )

        return TransformationExecuteResponse(
            output=result["output"],
            transformation_id=execute_request.transformation_id,
            model_id=model_id,
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error executing transformation: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error executing transformation: {str(e)}"
        )


@router.get("/transformations/default-prompt", response_model=DefaultPromptResponse)
async def get_default_prompt():
    """Get the default transformation prompt."""
    try:
        default_prompts: DefaultPrompts = await DefaultPrompts.get_instance()  # type: ignore[assignment]

        return DefaultPromptResponse(
            transformation_instructions=default_prompts.transformation_instructions
            or ""
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching default prompt: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching default prompt: {str(e)}"
        )


@router.put("/transformations/default-prompt", response_model=DefaultPromptResponse)
async def update_default_prompt(request: Request, prompt_update: DefaultPromptUpdate):
    """Update the default transformation prompt (admin only when auth is on)."""
    try:
        assert_can_edit_default_prompt(request)

        default_prompts: DefaultPrompts = await DefaultPrompts.get_instance()  # type: ignore[assignment]

        default_prompts.transformation_instructions = (
            prompt_update.transformation_instructions
        )
        await default_prompts.update()

        return DefaultPromptResponse(
            transformation_instructions=default_prompts.transformation_instructions
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating default prompt: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating default prompt: {str(e)}"
        )


@router.post(
    "/transformations/{transformation_id}/restore",
    response_model=TransformationResponse,
)
async def restore_transformation(transformation_id: str, request: Request):
    """Restore a soft-deleted builtin transformation (admin only)."""
    try:
        transformation = await Transformation.get(transformation_id)
        if not transformation:
            raise HTTPException(status_code=404, detail="Transformation not found")
        assert_can_restore(transformation, request)
        await restore_builtin(transformation)
        return _transformation_response(transformation, request)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error restoring transformation {transformation_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error restoring transformation: {str(e)}"
        )


@router.get(
    "/transformations/{transformation_id}", response_model=TransformationResponse
)
async def get_transformation(transformation_id: str, request: Request):
    """Get a specific transformation by ID."""
    try:
        transformation = await Transformation.get(transformation_id)
        if not transformation:
            raise HTTPException(status_code=404, detail="Transformation not found")
        assert_can_view(transformation, request)

        return _transformation_response(transformation, request)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching transformation {transformation_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching transformation: {str(e)}"
        )


@router.put(
    "/transformations/{transformation_id}", response_model=TransformationResponse
)
async def update_transformation(
    transformation_id: str,
    transformation_update: TransformationUpdate,
    request: Request,
):
    """Update a transformation."""
    try:
        transformation = await Transformation.get(transformation_id)
        if not transformation:
            raise HTTPException(status_code=404, detail="Transformation not found")
        assert_can_edit(transformation, request)

        if transformation_update.name is not None:
            transformation.name = transformation_update.name
        if transformation_update.title is not None:
            transformation.title = transformation_update.title
        if transformation_update.description is not None:
            transformation.description = transformation_update.description
        if transformation_update.prompt is not None:
            transformation.prompt = transformation_update.prompt
        if transformation_update.apply_default is not None:
            transformation.apply_default = transformation_update.apply_default
        if "model_id" in transformation_update.model_fields_set:
            if transformation_update.model_id:
                model = await Model.get(transformation_update.model_id)
                if not model:
                    raise HTTPException(status_code=404, detail="Model not found")
            transformation.model_id = transformation_update.model_id

        await transformation.save()

        return _transformation_response(transformation, request)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating transformation {transformation_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating transformation: {str(e)}"
        )


@router.delete("/transformations/{transformation_id}")
async def delete_transformation(transformation_id: str, request: Request):
    """Delete a transformation (builtins soft-delete; others hard-delete)."""
    try:
        transformation = await Transformation.get(transformation_id)
        if not transformation:
            raise HTTPException(status_code=404, detail="Transformation not found")
        assert_can_delete(transformation, request)

        if transformation.is_builtin:
            await soft_delete_builtin(transformation)
            return {"message": "Transformation archived successfully"}

        await transformation.delete()
        return {"message": "Transformation deleted successfully"}
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting transformation {transformation_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting transformation: {str(e)}"
        )
