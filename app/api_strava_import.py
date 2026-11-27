"""Backend for the guided import. Legacy /api/import remains unchanged."""
import asyncio
import re
from typing import Literal
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Request,Query
from pydantic import BaseModel,Field,StrictBool,ConfigDict
from starlette.concurrency import run_in_threadpool
from .auth import current_user
from . import db,strava_upload as uploads,strava_stage

router=APIRouter(prefix='/api/strava-import')
_piece_slots=asyncio.Semaphore(2)
_piece_accounts=set()
PIECE_RECEIVE_SECONDS=60
PIECE_IDLE_SECONDS=15


class StageIn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    reminder_opt_in:StrictBool=False


class UploadIn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:UUID
    size:int=Field(strict=True,gt=0,le=uploads.MAX_UPLOAD)
    sha256:str=Field(pattern=r'^[0-9a-f]{64}$')


class ConfirmIn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirm:Literal[True]
    audience:Literal['me','friends','everyone']


@router.get('/stage')
def stage(user=Depends(current_user)):
    return strava_stage.read(user['id'])


@router.put('/stage')
def save_stage(body:StageIn,user=Depends(current_user)):
    return strava_stage.save(user['id'],body.reminder_opt_in)


@router.delete('/stage')
def cancel_stage(user=Depends(current_user)):
    return strava_stage.cancel(user['id'])


@router.get('/reminders/stop')
def stop_reminder(token:str=Query(min_length=20,max_length=100)):
    return strava_stage.stop(token)


@router.post('/uploads')
def create_upload(body:UploadIn,user=Depends(current_user)):
    return uploads.begin(user['id'],body.id,body.size,body.sha256)


@router.get('/uploads/{identity}')
def upload_status(identity:UUID,user=Depends(current_user)):
    with db.connect() as c:return uploads.output(uploads.owned(c,user['id'],identity))


@router.put('/uploads/{identity}/pieces/{offset}')
async def piece(identity:UUID,offset:int,request:Request,user=Depends(current_user)):
    if offset<0:raise HTTPException(422,'Invalid offset')
    digest=request.headers.get('x-content-sha256','')
    if not re.fullmatch('[0-9a-f]{64}',digest):raise HTTPException(422,'Piece checksum is required')
    # Reject other-account IDs before reading a potentially large body.
    await run_in_threadpool(upload_status,identity,user)
    uid=user['id']
    if uid in _piece_accounts or _piece_slots.locked():raise HTTPException(429,'Uploads are busy. Retry this piece.')
    async with _piece_slots:
        _piece_accounts.add(uid)
        try:
            data=bytearray();stream=request.stream().__aiter__()
            try:
                async with asyncio.timeout(PIECE_RECEIVE_SECONDS):
                    while True:
                        try:chunk=await asyncio.wait_for(anext(stream),PIECE_IDLE_SECONDS)
                        except StopAsyncIteration:break
                        if len(data)+len(chunk)>uploads.CHUNK:raise HTTPException(413,'Send at most 8 MiB in one piece')
                        data.extend(chunk)
            except TimeoutError:raise HTTPException(408,'Upload timed out. Retry this piece.') from None
            return await run_in_threadpool(uploads.append,uid,identity,offset,bytes(data),digest)
        finally:
            _piece_accounts.discard(uid)


@router.post('/uploads/{identity}/finalize')
def finalize(identity:UUID,user=Depends(current_user)):
    return uploads.finalize(user['id'],identity)


@router.post('/uploads/{identity}/confirm')
def confirm(identity:UUID,body:ConfirmIn,user=Depends(current_user)):
    return uploads.confirm(user['id'],identity,body.audience)


@router.delete('/uploads/{identity}')
def cancel(identity:UUID,user=Depends(current_user)):
    return uploads.cancel(user['id'],identity)
