"""Owner summary corrections never alter recordings or manufacture split/record evidence."""
import json
from . import analysis, activities
FIELDS=('distance_m','moving_s','elapsed_s','ascent_m','calories','avg_hr','max_hr')
JSON_FIELDS=('zones','splits_km','splits_mi')
DERIVED=('gap_s_per_km','vo2max','decoupling','vam','max_speed','effort')+JSON_FIELDS
MOTION={'distance_m','moving_s','elapsed_s'}

def original(row):
    return {**row,**(row.get('summary_original') or {})} if row.get('summary_overrides') else row


def capture(c,row,updates):
    """Remember genuinely imported/analysed values before reapplying corrections."""
    base=row.get('summary_original') or {}
    if not base:return
    base=dict(base)
    for k in FIELDS+DERIVED:
        if k in updates:
            v=updates[k]
            base[k]=json.loads(v) if k in JSON_FIELDS and isinstance(v,str) else v
    c.execute('UPDATE activities SET summary_original=%s WHERE id=%s AND user_id=%s',(json.dumps(base),row['id'],row['user_id']))


def apply(c,uid,aid,restore_records=False):
    row=c.execute('SELECT * FROM activities WHERE id=%s AND user_id=%s FOR UPDATE',(aid,uid)).fetchone()
    base=row.get('summary_original') or {};over=row.get('summary_overrides') or {}
    if not base:return
    values={k:base.get(k) for k in FIELDS+DERIVED};values.update(over)
    motion=bool(MOTION.intersection(over));hr=bool({'avg_hr','max_hr'}.intersection(over))
    if motion:
        for k in ('gap_s_per_km','vo2max','decoupling','vam','max_speed','effort'):values[k]=None
        values['splits_km']=[];values['splits_mi']=[]
        c.execute('DELETE FROM best_efforts WHERE activity_id=%s AND user_id=%s',(aid,uid))
        c.execute('UPDATE activities SET route_id=NULL WHERE id=%s AND user_id=%s',(aid,uid))
    if 'ascent_m' in over:
        values['vam']=None;values['gap_s_per_km']=None
    if hr:
        for k in ('zones','effort','vo2max','decoupling'):values[k]=None
    for k in JSON_FIELDS:values[k]=json.dumps(values[k])
    c.execute('UPDATE activities SET '+','.join(k+'=%('+k+')s' for k in values)+',ai_note=NULL,updated=now() WHERE id=%(id)s AND user_id=%(uid)s',{**values,'id':aid,'uid':uid})
    if restore_records and not motion:
        from .parsers import STREAMS
        s=c.execute('SELECT * FROM activity_streams WHERE activity_id=%s AND user_id=%s',(aid,uid)).fetchone()
        c.execute('DELETE FROM best_efforts WHERE activity_id=%s AND user_id=%s',(aid,uid))
        if s:
            S=analysis.prepare({k:s.get(k) or [] for k in ('t',)+STREAMS},row['sport'])
            for e in analysis.best_efforts(S,row['sport']):
                c.execute('INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_s,start_time) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',(uid,aid,row['sport'],e['distance_m'],e['label'],e['elapsed_s'],e['start_s'],row['start_time']))
        c.execute('UPDATE activities SET route_id=NULL WHERE id=%s AND user_id=%s',(aid,uid))
        activities.match_route(c,uid,aid)
