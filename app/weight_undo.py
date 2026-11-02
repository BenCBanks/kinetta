"""Short-lived, owner-bound recovery of an explicitly deleted private weigh-in."""
import json
from uuid import uuid4
from fastapi import HTTPException
from . import db


def expire(c, uid):
    c.execute('DELETE FROM weight_delete_undos WHERE user_id=%s AND expires_at<=now()', (uid,))


def state(c, uid, day, profile):
    fence=c.execute('SELECT before_time FROM health_weight_exclusions WHERE user_id=%s AND day=%s', (uid,day)).fetchone()
    return {**{key:str(profile[key]) for key in ('health_weight_read','health_weight_epoch','health_weight_last_synced')},
            'tz':profile['tz'] or db.DEFAULT_TZ,'fence':str(fence['before_time']) if fence else None}


def capture(c, uid, day, profile):
    expire(c,uid)
    point=c.execute('SELECT day,kg,note,source,health_sample_id,source_name FROM weights WHERE user_id=%s AND day=%s FOR UPDATE', (uid,day)).fetchone()
    if not point:return None
    before=state(c,uid,day,profile)['fence']
    samples=[]
    if point['source']=='healthkit' and profile['health_weight_read']:
        samples=[str(row['sample_id']) for row in c.execute('''SELECT sample_id FROM health_weight_samples
          WHERE user_id=%s AND NOT deleted AND NOT excluded AND (sampled_at AT TIME ZONE %s)::date=%s''', (uid,profile['tz'] or db.DEFAULT_TZ,day))]
    return {'point':point,'before':before,'samples':samples}


def remember(c, uid, day, profile, snapshot):
    if snapshot is None:return None
    identity=uuid4()
    snapshot['after']=state(c,uid,day,profile)
    c.execute('INSERT INTO weight_delete_undos(id,user_id,day,snapshot) VALUES(%s,%s,%s,%s::jsonb)', (identity,uid,day,json.dumps(snapshot,default=str)))
    return str(identity)


def restore(c, uid, identity):
    from . import api_food,api_health_weights as health
    expire(c,uid)
    receipt=c.execute('SELECT * FROM weight_delete_undos WHERE id=%s AND user_id=%s AND expires_at>now() FOR UPDATE', (identity,uid)).fetchone()
    if not receipt:raise HTTPException(404,'Undo is no longer available')
    if receipt['restored']:return {'ok':True,'replayed':True}
    data=receipt['snapshot'];point=data['point'];profile=health.profile(c,uid)
    changed=not receipt['active'] or state(c,uid,receipt['day'],profile)!=data['after']
    if changed or c.execute('SELECT 1 FROM weights WHERE user_id=%s AND day=%s', (uid,receipt['day'])).fetchone():
        raise HTTPException(409,'Weight history changed. Your current weigh-ins have been kept.')
    if point['source']=='healthkit':
        samples=c.execute('''SELECT sample_id FROM health_weight_samples WHERE user_id=%s
          AND sample_id=ANY(%s::uuid[]) AND NOT deleted AND excluded''', (uid,data['samples'])).fetchall()
        if not profile['health_weight_read'] or len(samples)!=len(data['samples']) or str(point['health_sample_id']) not in data['samples']:
            raise HTTPException(409,'Apple Health weight changed. Refresh before undoing this deletion.')
    # Consume before inserting so the weight-write trigger invalidates other receipts, never this replay result.
    c.execute('UPDATE weight_delete_undos SET restored=true WHERE id=%s AND user_id=%s', (identity,uid))
    if data['before'] is None:c.execute('DELETE FROM health_weight_exclusions WHERE user_id=%s AND day=%s', (uid,receipt['day']))
    else:c.execute('UPDATE health_weight_exclusions SET before_time=%s WHERE user_id=%s AND day=%s', (data['before'],uid,receipt['day']))
    if data['samples']:c.execute('UPDATE health_weight_samples SET excluded=false WHERE user_id=%s AND sample_id=ANY(%s::uuid[]) AND NOT deleted', (uid,data['samples']))
    c.execute('''INSERT INTO weights(user_id,day,kg,note,source,health_sample_id,source_name)
      VALUES(%s,%s,%s,%s,%s,%s,%s)''', (uid,receipt['day'],point['kg'],point['note'],point['source'],point['health_sample_id'],point['source_name']))
    api_food._latest_weight(c,uid)
    return {'ok':True,'replayed':False}
