"""Private reusable interval presets. A reviewed library version never changes a pinned session."""
from uuid import UUID
import hashlib
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from psycopg.types.json import Jsonb
from . import db, intervals
from .auth import current_user

router = APIRouter(prefix='/api/interval-presets')


class SaveIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mutation_id: UUID
    expected_version: StrictInt | None = Field(default=None, ge=1, le=2147483646)
    definition: dict


class DeleteIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: StrictInt = Field(ge=1, le=2147483646)


def checked(raw):
    try: return intervals.definition(raw)
    except ValueError as e: raise HTTPException(400, str(e))


def output(row):
    result=checked(row['definition'])
    return dict(id=str(row['id']), version=row['version'], updated=row['updated'], **result)


@router.get('')
def presets(user=Depends(current_user)):
    with db.connect() as c:
        rows=c.execute('SELECT id,version,definition,updated FROM interval_presets WHERE user_id=%s AND deleted_at IS NULL ORDER BY updated DESC,id LIMIT 200', (user['id'],)).fetchall()
    out=[]
    for row in rows:
        value=output(row);value['step_count']=len(value.pop('steps'));out.append(value)
    return out


@router.get('/{pid}')
def preset(pid: UUID, user=Depends(current_user)):
    with db.connect() as c:
        row=c.execute('SELECT id,version,definition,updated FROM interval_presets WHERE id=%s AND user_id=%s AND deleted_at IS NULL', (pid,user['id'])).fetchone()
    if not row: raise HTTPException(404, 'Preset not found')
    return output(row)


@router.put('/{pid}')
def save(pid: UUID, body: SaveIn, user=Depends(current_user)):
    plan=checked(body.definition); uid=user['id']
    digest=hashlib.sha256(json.dumps(dict(id=str(pid),base=body.expected_version,definition=plan['definition']),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    with db.connect() as c:
        c.execute("SELECT pg_advisory_xact_lock(hashtextextended('interval-presets:'||%s::text,0))", (uid,))
        row=c.execute('SELECT id,version,deleted_at FROM interval_presets WHERE id=%s AND user_id=%s', (pid,uid)).fetchone()
        if row and row['deleted_at']: raise HTTPException(410, 'This preset was deleted. Duplicate your draft to save a new preset.')
        receipt=c.execute('SELECT preset_id,request_hash,version FROM interval_preset_receipts WHERE user_id=%s AND mutation_id=%s', (uid,body.mutation_id)).fetchone()
        if receipt:
            if receipt['request_hash']!=digest or receipt['preset_id']!=pid: raise HTTPException(409, 'That save ID was already used. Review the draft before saving again.')
            return dict(id=str(pid),version=receipt['version'],replayed=True,**plan)
        if row:
            if body.expected_version!=row['version']: raise HTTPException(409, 'This preset changed on another device. Keep your draft, then reload or save a new copy.')
            version=row['version']+1
            c.execute('UPDATE interval_presets SET definition=%s,version=%s,updated=now() WHERE id=%s AND user_id=%s', (Jsonb(plan['definition']),version,pid,uid))
        else:
            if body.expected_version is not None: raise HTTPException(404, 'Preset not found. Keep your draft or save a new copy.')
            if c.execute('SELECT count(*) AS n FROM interval_presets WHERE user_id=%s AND deleted_at IS NULL', (uid,)).fetchone()['n']>=200:
                raise HTTPException(400, 'Keep at most 200 saved presets. Delete one before saving another.')
            version=1
            created=c.execute('INSERT INTO interval_presets(id,user_id,definition,version) VALUES(%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING id', (pid,uid,Jsonb(plan['definition']),version)).fetchone()
            if not created: raise HTTPException(404, 'Preset not found')
        c.execute('INSERT INTO interval_preset_receipts(user_id,mutation_id,preset_id,request_hash,version) VALUES(%s,%s,%s,%s,%s)', (uid,body.mutation_id,pid,digest,version))
    return dict(id=str(pid),version=version,replayed=False,**plan)


@router.delete('/{pid}')
def delete(pid: UUID, body: DeleteIn, user=Depends(current_user)):
    with db.connect() as c:
        c.execute("SELECT pg_advisory_xact_lock(hashtextextended('interval-presets:'||%s::text,0))", (user['id'],))
        row=c.execute('SELECT version,deleted_at FROM interval_presets WHERE id=%s AND user_id=%s FOR UPDATE', (pid,user['id'])).fetchone()
        if not row: raise HTTPException(404, 'Preset not found')
        if not row['deleted_at']:
            if body.expected_version!=row['version']: raise HTTPException(409, 'This preset changed. Reload before deleting it.')
            c.execute('UPDATE interval_presets SET definition=NULL,deleted_at=now(),updated=now(),version=version+1 WHERE id=%s AND user_id=%s', (pid,user['id']))
    return dict(deleted=True)
