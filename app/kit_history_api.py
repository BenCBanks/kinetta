"""Authenticated history reads/deletion never need a provider or AI consent."""
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from . import db, kit_history as store, kit_thread as chat, ai_release
from .auth import current_user

router=APIRouter(prefix='/api/coach/conversation/threads')


class ResumeIn(chat.GenerationIn):
    visit_id: UUID


class ThreadIn(ResumeIn):
    conversation_id: UUID


def messages(c,uid,conversation_id,generation,before=None,visit_id=None):
    store.thread(c,uid,conversation_id)
    c.execute("""UPDATE kit_turns SET state='failed',lease=NULL,expires=NULL,
      error='This answer was interrupted. Tap Retry to try again.' WHERE user_id=%s
      AND conversation_id=%s AND state='running' AND expires<=now()""",(uid,conversation_id))
    rows=c.execute('''SELECT * FROM kit_turns WHERE user_id=%s AND conversation_id=%s
      AND (%s::bigint IS NULL OR id<%s) ORDER BY id DESC LIMIT 51''',
      (uid,conversation_id,before,before)).fetchall()
    return {'conversation_id':conversation_id,'generation':generation,'visit_id':visit_id,
      'messages':[chat.public(r) for r in reversed(rows[:50])],
      'before':rows[49]['id'] if len(rows)>50 else None,'ready':ai_release.enabled('kit')}


@router.get('')
def listing(before:UUID | None=None,user=Depends(current_user)):
    uid=user['id']
    with db.connect() as c:
        generation=chat.locked(c,uid)
        cursor=store.thread(c,uid,before) if before else None
        rows=c.execute('''SELECT q.id AS conversation_id,q.created,q.updated,
          coalesce((SELECT left(t.question,80) FROM kit_turns t WHERE t.user_id=q.user_id
            AND t.conversation_id=q.id ORDER BY t.id LIMIT 1),'New conversation') AS title,
          (SELECT count(*) FROM kit_turns t WHERE t.user_id=q.user_id AND t.conversation_id=q.id) AS message_count
          FROM kit_threads q WHERE q.user_id=%s AND (%s::timestamptz IS NULL OR (q.updated,q.id)<(%s,%s))
          ORDER BY q.updated DESC,q.id DESC LIMIT 21''',
          (uid,cursor['updated'] if cursor else None,cursor['updated'] if cursor else None,before)).fetchall()
        return {'enabled':store.enabled(),'retention':'until_deleted','retention_decision_pending':False,
          'generation':generation,'conversations':rows[:20],
          'before':rows[19]['conversation_id'] if len(rows)>20 else None}


def open_thread(c,uid,conversation_id,body):
    if not store.enabled():raise HTTPException(409,'Saved Kit conversations are not enabled on this server.')
    store.thread(c,uid,conversation_id)
    c.execute('INSERT INTO kit_visits(id,user_id,conversation_id) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',
              (body.visit_id,uid,conversation_id))
    chat.locked(c,uid,body.generation,body.visit_id)
    if store.conversation(c,uid,body.visit_id)!=conversation_id:
        raise HTTPException(404,'Kit conversation unavailable')
    return messages(c,uid,conversation_id,body.generation,visit_id=body.visit_id)


@router.post('')
def create(body:ThreadIn,user=Depends(current_user)):
    uid=user['id']
    with db.connect() as c:
        chat.locked(c,uid,body.generation)
        if not store.enabled():raise HTTPException(409,'Saved Kit conversations are not enabled on this server.')
        c.execute('INSERT INTO kit_threads(id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING',(body.conversation_id,uid))
        return open_thread(c,uid,body.conversation_id,body)


@router.post('/{conversation_id}/resume')
def resume(conversation_id:UUID,body:ResumeIn,user=Depends(current_user)):
    with db.connect() as c:
        chat.locked(c,user['id'],body.generation)
        return open_thread(c,user['id'],conversation_id,body)


@router.get('/{conversation_id}')
def read(conversation_id:UUID,before:int | None=Query(default=None,gt=0),user=Depends(current_user)):
    with db.connect() as c:
        return messages(c,user['id'],conversation_id,chat.locked(c,user['id']),before)


def erase(uid,conversation_id=None):
    with db.connect() as c:
        chat.locked(c,uid)
        store.remove(c,uid,conversation_id)
        # Fence queued creates/resumes too, not just the running answer's lease.
        generation=uuid4()
        c.execute('UPDATE kit_conversations SET generation=%s WHERE user_id=%s',(generation,uid))
        if conversation_id is None:
            c.execute('UPDATE kit_visits SET ended=coalesce(ended,now()) WHERE user_id=%s',(uid,))
            c.execute('DELETE FROM kit_turns WHERE user_id=%s',(uid,))
        else:
            c.execute("""UPDATE kit_turns SET state='failed',lease=NULL,expires=NULL,
              error='Kit history changed. Tap Retry to try again.' WHERE user_id=%s AND state IN ('pending','running')""",(uid,))
        return {'ok':True,'generation':generation}


@router.delete('')
def delete_all(user=Depends(current_user)):
    return erase(user['id'])


@router.delete('/{conversation_id}')
def delete_one(conversation_id:UUID,user=Depends(current_user)):
    return erase(user['id'],conversation_id)
