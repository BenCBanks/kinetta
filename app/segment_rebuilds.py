"""Stage a complete course generation, then replace its derived answers in one transaction.

Course definitions never change. Epochs fence cancelled/replaced jobs; source revisions fence late GPS updates.
Moderation/appeals live on stable effort identities and are consulted at activation, not copied at queue time.
"""
import json
from . import segments


def lock_state(c, sid):
    # Course first everywhere: retirement/deletion cannot race a late worker into resurrecting a board.
    s=c.execute("SELECT status,matcher FROM segments WHERE id=%s FOR SHARE",(sid,)).fetchone()
    if not s or s['status']!='active': return None
    c.execute('INSERT INTO segment_match_state(segment_id,active_matcher) VALUES(%s,%s) ON CONFLICT DO NOTHING',(sid,s['matcher']))
    return c.execute('SELECT * FROM segment_match_state WHERE segment_id=%s FOR UPDATE',(sid,)).fetchone()


def begin(c,sid,expected):
    g=lock_state(c,sid)
    if not g: return None
    if g['pending'] is not None or g['active']!=expected: return False
    epoch=g['next_epoch']
    c.execute('DELETE FROM segment_stage_scans WHERE segment_id=%s',(sid,))
    c.execute('''UPDATE segment_match_state SET pending=%s,pending_matcher=%s,next_epoch=next_epoch+1,
      processed=0,cursor=0,swept=false,started=now() WHERE segment_id=%s''',(epoch,segments.MATCHER,sid))
    c.execute("INSERT INTO segment_jobs(kind,ref,epoch) VALUES('rebuild',%s,%s)",(sid,epoch))
    return epoch


def stage(c,sid,epoch,aid,points,sport):
    data=segments.calculate(c,sid,aid,points,sport)
    if not data: return
    a,passes,outcome,why=data
    # Only the material used for calculation; no complete source stream is retained in this ledger.
    keys=('start_i','end_i','started','elapsed_raw','elapsed_s','state','reason','on_line','start_m','end_m','line_m')
    c.execute('''INSERT INTO segment_stage_scans(segment_id,epoch,activity_id,user_id,source_revision,matcher,result,outcome,reason)
      VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(segment_id,epoch,activity_id) DO UPDATE SET
      source_revision=EXCLUDED.source_revision,matcher=EXCLUDED.matcher,result=EXCLUDED.result,outcome=EXCLUDED.outcome,reason=EXCLUDED.reason''',
      (sid,epoch,aid,a['user_id'],a['segment_revision'],segments.MATCHER,json.dumps([{k:p[k] for k in keys} for p in passes]),outcome,why))


# Include old passes as well as nearby recordings: moving a source away must remove its old result.
CANDIDATE=f"""s.id=%(sid)s AND s.status='active' AND ((a.geom IS NOT NULL AND {segments.NEAR})
  OR EXISTS(SELECT 1 FROM segment_efforts e WHERE e.segment_id=s.id AND e.activity_id=a.id)
  OR EXISTS(SELECT 1 FROM segment_stage_scans old WHERE old.segment_id=s.id AND old.epoch=%(epoch)s AND old.activity_id=a.id))"""


def run_batch(c,sid,epoch):
    # Lock source members and the creator before the course, matching account deletion's order.
    members=[r['id'] for r in c.execute(f'''SELECT a.user_id AS id FROM activities a CROSS JOIN segments s WHERE {CANDIDATE}
      UNION SELECT creator_id FROM segments WHERE id=%(sid)s AND creator_id IS NOT NULL''',{'sid':sid,'epoch':epoch}).fetchall()]
    segments.lock_people(c,members)
    g=lock_state(c,sid)
    if not g or g['pending']!=epoch or g['pending_matcher']!=segments.MATCHER:
        c.execute('DELETE FROM segment_stage_scans WHERE segment_id=%s AND epoch=%s',(sid,epoch))
        return True
    points,sport=segments._segment_points(c,sid)
    args={'sid':sid,'epoch':epoch,'batch':segments.BATCH,'cursor':g['cursor']}
    # Walk the initial population once by ID. The final catch-up finds changed and newly added sources.
    if not g['swept']:
        rows=c.execute(f'''SELECT a.id,a.user_id FROM activities a CROSS JOIN segments s
          WHERE {CANDIDATE} AND a.id>%(cursor)s ORDER BY a.id LIMIT %(batch)s''',args).fetchall()
        if rows:
            if any(r['user_id'] not in members for r in rows):return False
            for r in rows:stage(c,sid,epoch,r['id'],points,sport)
            c.execute('UPDATE segment_match_state SET processed=processed+%s,cursor=%s WHERE segment_id=%s',(len(rows),rows[-1]['id'],sid))
            return False
        c.execute('UPDATE segment_match_state SET swept=true WHERE segment_id=%s',(sid,))
    rows=c.execute(f'''SELECT a.id,a.user_id FROM activities a CROSS JOIN segments s
      LEFT JOIN segment_stage_scans st ON st.segment_id=s.id AND st.epoch=%(epoch)s AND st.activity_id=a.id
      WHERE {CANDIDATE} AND (st.activity_id IS NULL OR st.source_revision<>a.segment_revision)
      ORDER BY a.id LIMIT %(batch)s''',args).fetchall()
    if rows:
        if any(r['user_id'] not in members for r in rows):return False
        for r in rows: stage(c,sid,epoch,r['id'],points,sport)
        c.execute('UPDATE segment_match_state SET processed=processed+%s WHERE segment_id=%s',(len(rows),sid))
        return False
    activate(c,sid,epoch,g['pending_matcher'])
    return True


RAW='''
 SELECT st.activity_id,st.user_id,st.source_revision,st.matcher,p.* FROM segment_stage_scans st
 JOIN activities a ON a.id=st.activity_id AND a.segment_revision=st.source_revision,
 LATERAL jsonb_to_recordset(st.result) AS p(start_i int,end_i int,started double precision,elapsed_raw real,elapsed_s int,
   state text,reason text,on_line boolean,start_m real,end_m real,line_m real)
 WHERE st.segment_id=%(sid)s AND st.epoch=%(epoch)s'''
MATERIAL='''WITH material AS (SELECT r.*,EXISTS(SELECT 1 FROM pg_temp.segment_activation d
 WHERE d.user_id=r.user_id AND d.activity_id<r.activity_id AND d.started>r.started-30 AND d.started<r.started+30
 AND abs(d.elapsed_s-r.elapsed_s)<=greatest(3,r.elapsed_s*0.05)) AS duplicate FROM pg_temp.segment_activation r)'''


def activate(c,sid,epoch,matcher):
    g=lock_state(c,sid)
    if not g or g['pending']!=epoch or g['pending_matcher']!=matcher or matcher!=segments.MATCHER: return False
    # The final generation switch and all effort updates commit together.
    args={'sid':sid,'epoch':epoch}
    # Index the transaction-local calculation once, avoiding a quadratic duplicate scan across every member.
    c.execute('DROP TABLE IF EXISTS pg_temp.segment_activation')
    c.execute('CREATE TEMP TABLE segment_activation ON COMMIT DROP AS '+RAW,args)
    c.execute('CREATE INDEX ON segment_activation(user_id,started)')
    c.execute('ANALYZE segment_activation')
    c.execute(MATERIAL+''' INSERT INTO segment_efforts(segment_id,user_id,activity_id,start_i,end_i,started,elapsed_raw,elapsed_s,
      matcher,state,reason,on_line,start_m,end_m,line_m,generation,source_revision)
      SELECT %(sid)s,user_id,activity_id,start_i,end_i,to_timestamp(started),elapsed_raw,elapsed_s,matcher,
        CASE WHEN duplicate THEN 'excluded' ELSE state END,CASE WHEN duplicate THEN 'duplicate' ELSE reason END,
        on_line,start_m,end_m,line_m,%(epoch)s,source_revision FROM material
      ON CONFLICT(segment_id,activity_id,start_i) DO UPDATE SET
        state=CASE WHEN segment_efforts.reason='reviewed' AND segment_efforts.matcher=EXCLUDED.matcher
              AND segment_efforts.source_revision=EXCLUDED.source_revision AND segment_efforts.elapsed_raw=EXCLUDED.elapsed_raw
          AND segment_efforts.end_i=EXCLUDED.end_i AND segment_efforts.started=EXCLUDED.started AND EXCLUDED.reason IS DISTINCT FROM 'duplicate'
          THEN 'ok' ELSE EXCLUDED.state END,
        reason=CASE WHEN segment_efforts.reason='reviewed' AND segment_efforts.matcher=EXCLUDED.matcher
              AND segment_efforts.source_revision=EXCLUDED.source_revision AND segment_efforts.elapsed_raw=EXCLUDED.elapsed_raw
          AND segment_efforts.end_i=EXCLUDED.end_i AND segment_efforts.started=EXCLUDED.started AND EXCLUDED.reason IS DISTINCT FROM 'duplicate'
          THEN 'reviewed' ELSE EXCLUDED.reason END,
        end_i=EXCLUDED.end_i,started=EXCLUDED.started,elapsed_raw=EXCLUDED.elapsed_raw,elapsed_s=EXCLUDED.elapsed_s,
        matcher=EXCLUDED.matcher,on_line=EXCLUDED.on_line,start_m=EXCLUDED.start_m,end_m=EXCLUDED.end_m,line_m=EXCLUDED.line_m,
        generation=EXCLUDED.generation,source_revision=EXCLUDED.source_revision,rev=segment_efforts.rev+1''',args)
    # Preserve historical case identities if a corrected recording no longer has this pass.
    c.execute('''UPDATE segment_efforts SET state='excluded',reason='recomputed',generation=%s,rev=rev+1
      WHERE segment_id=%s AND generation<>%s''',(epoch,sid,epoch))
    c.execute('''INSERT INTO segment_scans(segment_id,activity_id,user_id,matcher,outcome,reason,generation,source_revision)
      SELECT st.segment_id,st.activity_id,st.user_id,st.matcher,st.outcome,st.reason,st.epoch,st.source_revision
      FROM segment_stage_scans st JOIN activities a ON a.id=st.activity_id AND a.segment_revision=st.source_revision
      WHERE st.segment_id=%s AND st.epoch=%s ON CONFLICT(segment_id,activity_id) DO UPDATE SET
      matcher=EXCLUDED.matcher,outcome=EXCLUDED.outcome,reason=EXCLUDED.reason,generation=EXCLUDED.generation,
      source_revision=EXCLUDED.source_revision,scanned=now()''',(sid,epoch))
    c.execute('''UPDATE segment_match_state SET active=%s,active_matcher=%s,pending=NULL,pending_matcher=NULL,activated=now()
      WHERE segment_id=%s AND pending=%s''',(epoch,matcher,sid,epoch))
    c.execute('DELETE FROM segment_stage_scans WHERE segment_id=%s AND epoch=%s',(sid,epoch))
    return True
