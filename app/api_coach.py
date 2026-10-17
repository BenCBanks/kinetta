"""Authenticated coach tools, answers and confirmation-only proposals."""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator

from . import coach_chat, coach_proposals, ai_release, ai_access
from .auth import current_user
from .coach_tools import AccountTools, Empty
from .food_photo import brake

router = APIRouter(prefix='/api/coach')


class ToolIn(Empty):
    name: str = Field(min_length=1, max_length=60)
    arguments: dict = Field(default_factory=dict)


class AskIn(Empty):
    question: str = Field(min_length=3, max_length=1500)


class ConfirmIn(Empty):
    confirmed: Literal[True]

    @field_validator('confirmed', mode='before')
    @classmethod
    def explicit_true(cls, value):
        if value is not True: raise ValueError('Explicit confirmation required')
        return value


@router.post('/tools')
def tool(body: ToolIn, user=Depends(current_user)):
    try: return {'data': AccountTools(user['id']).call(body.name, body.arguments)}
    except ValueError: raise HTTPException(400, 'Invalid tool request or record not found') from None


@router.post('/ask')
def ask(body: AskIn, user=Depends(current_user)):
    if not ai_release.enabled(): raise HTTPException(503, 'Kit questions are not available yet.')
    ai_access.require(user['id'], 'coach')
    brake(user['id'], limit=10, kind='coach_questions', what='questions for Kit')
    try: return coach_chat.answer(user['id'], body.question)
    except ValueError as e: raise HTTPException(400, str(e)) from e


@router.post('/proposals')
def propose(body: coach_proposals.ProposalIn, user=Depends(current_user)):
    try: return coach_proposals.create(user['id'], body)
    except ValueError: raise HTTPException(400, 'This proposal is not allowed') from None


@router.post('/proposals/{pid}/confirm')
def confirm(pid: uuid.UUID, body: ConfirmIn, user=Depends(current_user), thread:bool=False):
    return coach_proposals.confirm(user['id'], pid,thread=thread)
