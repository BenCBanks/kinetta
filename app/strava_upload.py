"""Account-bound resumable archives and durable, provider-free import work."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import uuid
import time
import zipfile
import subprocess
from psycopg import DataError
from fastapi import HTTPException
from . import activities, db, strava_archive as archive

CHUNK = 8*1024**2
MAX_UPLOAD = 2*1024**3
USER_BYTES, GLOBAL_BYTES = 4*1024**3, 12*1024**3
USER_JOBS, GLOBAL_JOBS = 2, 16
ACTIVE = ('uploading','preview_queued','review','importing')
DATA = Path(os.environ.get('FIT_DATA','/data'))


def path(uid,identity):
    return DATA/'uploads'/str(int(uid))/('strava-'+str(uuid.UUID(str(identity))))/'archive.zip'


def account(c,uid):
    if not c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,)).fetchone():
        raise HTTPException(404,'Account not found')


def owned(c,uid,identity,lock=False):
    row=c.execute('SELECT * FROM strava_uploads WHERE user_id=%s AND id=%s'+(' FOR UPDATE' if lock else ''),(uid,identity)).fetchone()
    if not row: raise HTTPException(404,'Upload not found')
    return row


def output(row):
    return {k:row[k] for k in ('id','state','size','received','sha256','preview','result','audience','error_code','expires')}


def disk_guard(extra=0,reserved=0):
    DATA.mkdir(parents=True,exist_ok=True)
    usage=shutil.disk_usage(DATA)
    if usage.free-extra-reserved < max(1024**3,int(usage.total*.25)):
        raise HTTPException(507,'Not enough storage for this import. Try again later.')


def begin(uid,identity,size,digest):
    with db.connect() as c:
        # A single global reservation lock makes simultaneous quota checks exact.
        c.execute("SELECT pg_advisory_xact_lock(hashtextextended('strava-capacity',0))")
        account(c,uid)
        old=c.execute('SELECT * FROM strava_uploads WHERE user_id=%s AND id=%s',(uid,identity)).fetchone()
        if old:
            if (old['size'],old['sha256'])!=(size,digest): raise HTTPException(409,'Upload identity already used')
            return output(old)
        allrows=c.execute('SELECT user_id,size,received FROM strava_uploads WHERE state=ANY(%s)',(list(ACTIVE),)).fetchall()
        attempts=c.execute("SELECT count(*) AS total,count(*) FILTER(WHERE user_id=%s) AS own FROM strava_uploads WHERE created>now()-interval '1 day'",(uid,)).fetchone()
        if attempts['own']>=10 or attempts['total']>=100:raise HTTPException(429,'The daily import allowance is full. Try tomorrow.')
        mine=[r for r in allrows if r['user_id']==uid]
        if len(mine)>=USER_JOBS or sum(r['size'] for r in mine)+size>USER_BYTES: raise HTTPException(429,'Your import allowance is full. Finish or cancel an upload.')
        if len(allrows)>=GLOBAL_JOBS or sum(r['size'] for r in allrows)+size>GLOBAL_BYTES: raise HTTPException(429,'Imports are busy. Try again later.')
        disk_guard(size+archive.MAX_FILE*4,sum(r['size']-r['received'] for r in allrows))
        row=c.execute('INSERT INTO strava_uploads(id,user_id,size,sha256) VALUES(%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING *',(identity,uid,size,digest)).fetchone()
        if not row:raise HTTPException(409,'Upload identity already used')
        c.execute("""INSERT INTO strava_import_stage(user_id,upload_id) VALUES(%s,%s)
          ON CONFLICT(user_id) DO UPDATE SET state='requested',upload_id=excluded.upload_id,updated=now(),expires=now()+interval '90 days'""",(uid,identity))
        return output(row)


def append(uid,identity,offset,raw,digest):
    if not 0<len(raw)<=CHUNK: raise HTTPException(413,'Send at most 8 MiB in one piece')
    if hashlib.sha256(raw).hexdigest()!=digest: raise HTTPException(422,'Piece checksum did not match')
    with db.connect() as c:
        account(c,uid);r=owned(c,uid,identity,True)
        if r['state']!='uploading' or r['expires']<=dt.datetime.now(dt.timezone.utc): raise HTTPException(409,'Upload is not receiving data')
        if offset+len(raw)>r['size']: raise HTTPException(422,'Piece exceeds the declared archive length')
        p=path(uid,identity)
        if offset<r['received']:
            if offset+len(raw)>r['received']: raise HTTPException(409,'Resume at the saved offset')
            try:
                with p.open('rb') as f:f.seek(offset);same=f.read(len(raw))==raw
            except OSError:same=False
            if not same:raise HTTPException(409,'Piece differs from the saved data')
            return output(r)
        if offset!=r['received']:raise HTTPException(409,'Resume at the saved offset')
        disk_guard(len(raw))
        p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with p.open('r+b' if p.exists() else 'w+b') as f:
            f.seek(0,os.SEEK_END)
            if f.tell()<r['received']:raise HTTPException(409,'Saved upload is incomplete. Start a new upload.')
            # Roll back any bytes fsynced just before a prior process lost its SQL commit.
            f.truncate(r['received']);f.seek(r['received']);f.write(raw);f.flush();os.fsync(f.fileno())
        return output(c.execute('UPDATE strava_uploads SET received=received+%s,updated=now() WHERE user_id=%s AND id=%s RETURNING *',(len(raw),uid,identity)).fetchone())


def finalize(uid,identity):
    with db.connect() as c:
        account(c,uid);r=owned(c,uid,identity,True)
        if r['state']!='uploading':return output(r)
        if r['expires']<=dt.datetime.now(dt.timezone.utc):raise HTTPException(409,'Upload expired')
        if r['received']!=r['size']:raise HTTPException(409,'Upload is incomplete')
        p=path(uid,identity);h=hashlib.sha256()
        try:
            with p.open('rb') as f:
                if os.fstat(f.fileno()).st_size!=r['size']:raise HTTPException(422,'Archive length did not match')
                while piece:=f.read(CHUNK):h.update(piece)
        except FileNotFoundError:raise HTTPException(409,'Saved upload is missing. Start a new upload.') from None
        if h.hexdigest()!=r['sha256']:raise HTTPException(422,'Archive checksum did not match')
        return output(c.execute("UPDATE strava_uploads SET state='preview_queued',updated=now() WHERE user_id=%s AND id=%s RETURNING *",(uid,identity)).fetchone())


def current_audience(c,uid,lock=False):
    return c.execute('SELECT share_default FROM profile WHERE user_id=%s'+(' FOR SHARE' if lock else ''),(uid,)).fetchone()['share_default'] or 'everyone'


def confirm(uid,identity,audience):
    with db.connect() as c:
        account(c,uid);r=owned(c,uid,identity,True)
        if r['state'] in ('importing','done'):return output(r)
        if r['state']!='review' or r['expires']<=dt.datetime.now(dt.timezone.utc):raise HTTPException(409,'Review this upload before importing')
        # The screen submits the setting it displayed; stale reviews cannot broaden it.
        if audience!=current_audience(c,uid,True):raise HTTPException(409,'Your activity privacy changed. Review it again before importing.')
        r=c.execute("UPDATE strava_uploads SET state='importing',audience=%s,updated=now() WHERE user_id=%s AND id=%s RETURNING *",(audience,uid,identity)).fetchone()
        c.execute('UPDATE strava_import_stage SET reminder_opt_in=false,reminder_due=NULL,stop_hash=NULL,updated=now() WHERE user_id=%s',(uid,))
        return output(r)


def cancel(uid,identity):
    with db.connect() as c:
        account(c,uid);owned(c,uid,identity,True)
        c.execute("UPDATE strava_uploads SET state=CASE WHEN state='done' THEN state ELSE 'cancelled' END,updated=now() WHERE user_id=%s AND id=%s",(uid,identity))
        c.execute("UPDATE strava_import_stage SET state='cancelled',reminder_opt_in=false,reminder_due=NULL,stop_hash=NULL,updated=now() WHERE user_id=%s AND upload_id=%s",(uid,identity))
    shutil.rmtree(path(uid,identity).parent,ignore_errors=True)
    return {'ok':True}


def candidate(c,uid,parsed,meta):
    # Use the same deterministic summary as store(), not CSV distance over a recorded route.
    point=archive.candidate(parsed,meta)
    session=dict(parsed.get('session') or {});session['_health_duration_authoritative']=False
    streams=activities.analysis.prepare(parsed['streams'],point['sport'])
    summary=activities.analysis.summary(streams,point['sport'],session,activities.profile_of(c,uid))
    return {**point,'distance_m':summary.get('distance_m'),'elapsed_s':summary.get('elapsed_s')}


def duplicate(c,uid,parsed,meta,raw,point=None):
    if raw and c.execute('SELECT 1 FROM activities WHERE user_id=%s AND file_sha256=%s',(uid,hashlib.sha256(raw).hexdigest())).fetchone():return True
    if meta.get('strava_id') and c.execute('SELECT 1 FROM activities WHERE user_id=%s AND strava_id=%s',(uid,meta['strava_id'])).fetchone():return True
    return bool(activities.find_duplicate(c,uid,source='strava',**(point or candidate(c,uid,parsed,meta))))


def preview(uid,identity,z,items):
    deadline=time.monotonic()+600
    counts={'added':0,'already_here':0,'unreadable':0};seen=set();candidates={}
    for name,load,meta in items:
        if time.monotonic()>deadline:raise archive.ArchiveError('processing_limit')
        try:
            parsed,raw=archive.parse_item(name,load,meta)
            keys=[('raw',hashlib.sha256(raw).hexdigest())] if raw else [('manual',str(meta.get('start')),meta.get('sport'),meta.get('distance_m'),meta.get('elapsed_s'))]
            if meta.get('strava_id'):keys.append(('strava',meta['strava_id']))
            with db.connect() as c:
                c.execute('SET TRANSACTION READ ONLY')
                r=owned(c,uid,identity)
                if r['state']!='preview_queued':return
                point=candidate(c,uid,parsed,meta);found=duplicate(c,uid,parsed,meta,raw,point)
            bucket=int(point['start'].timestamp())//120
            near=[p for index in (bucket-1,bucket,bucket+1) for p in candidates.get((point['sport'],index),[])]
            # Same-archive copies follow the existing import match tolerance without staging any workout.
            same=any(p['sport']==point['sport'] and abs((p['start']-point['start']).total_seconds())<=120
                     and abs((p['elapsed_s'] or 0)-(point['elapsed_s'] or 0))<=max(120,(p['elapsed_s'] or 0)*.1)
                     and (max(p['distance_m'] or 0,point['distance_m'] or 0)<50 or
                          min(p['distance_m'] or 0,point['distance_m'] or 0)/max(p['distance_m'] or 0,point['distance_m'] or 0)>.85) for p in near)
            if found or any(k in seen for k in keys) or same:counts['already_here']+=1
            else:counts['added']+=1;candidates.setdefault((point['sport'],bucket),[]).append(point)
            seen.update(keys)
        except (archive.ArchiveError,ValueError,OSError,KeyError,TypeError,DataError,zipfile.BadZipFile,EOFError,TimeoutError, subprocess.TimeoutExpired):counts['unreadable']+=1
    with db.connect() as c:
        account(c,uid)
        c.execute("UPDATE strava_uploads SET state='review',preview=%s,updated=now() WHERE user_id=%s AND id=%s AND state='preview_queued' AND expires>now()",(json.dumps(counts),uid,identity))


def discard_unreferenced(c,uid,raw,name):
    if raw is None:return
    digest=hashlib.sha256(raw).hexdigest()
    # The account lock excludes another import committing this same file meanwhile.
    if not c.execute('SELECT 1 FROM activities WHERE user_id=%s AND file_sha256=%s',(uid,digest)).fetchone():
        (DATA/'files'/str(uid)/(digest+''.join(Path(name).suffixes)[-20:])).unlink(missing_ok=True)


def import_items(uid,identity,items,stop):
    deadline=time.monotonic()+60
    for index,(name,load,meta) in enumerate(items):
        if stop.is_set() or time.monotonic()>deadline:return
        with db.connect() as c:
            r=owned(c,uid,identity)
            if r['state']!='importing':return
            if index<r['cursor']:continue
        parsed=raw=None
        try:parsed,raw=archive.parse_item(name,load,meta)
        except (archive.ArchiveError,ValueError,OSError,KeyError,TypeError,DataError,zipfile.BadZipFile,EOFError,TimeoutError,subprocess.TimeoutExpired):pass
        with db.connect() as c:
            account(c,uid);r=owned(c,uid,identity,True)
            if r['state']!='importing' or r['expires']<=dt.datetime.now(dt.timezone.utc):return
            result=dict(r['result'])
            if parsed is None:outcome='unreadable'
            else:
                try:
                    with c.transaction():
                        if duplicate(c,uid,parsed,meta,raw):outcome='already_here'
                        else:
                            disk_guard(len(raw or b'')+archive.MAX_FILE*4)
                            outcome,_=activities.store(uid,parsed,meta,raw=raw,ext=''.join(Path(name).suffixes)[-20:],source='strava',connection=c,visibility=r['audience'])
                            outcome='added' if outcome=='added' else 'already_here'
                except HTTPException as e:
                    if e.status_code==507:raise
                    discard_unreferenced(c,uid,raw,name);outcome='unreadable'
                except (ValueError,OverflowError,DataError,KeyError,TypeError):
                    discard_unreferenced(c,uid,raw,name);outcome='unreadable'
            result[outcome]+=1
            # Workout and cursor commit together. Restart cannot duplicate a committed item or lose its receipt.
            c.execute('UPDATE strava_uploads SET cursor=%s,result=%s,error_code=NULL,updated=now() WHERE user_id=%s AND id=%s',(index+1,json.dumps(result),uid,identity))
    with db.connect() as c:
        account(c,uid)
        c.execute("UPDATE strava_uploads SET state='done',updated=now() WHERE user_id=%s AND id=%s AND state='importing'",(uid,identity))
        c.execute("UPDATE strava_import_stage SET state='done',updated=now() WHERE user_id=%s AND upload_id=%s",(uid,identity))
    shutil.rmtree(path(uid,identity).parent,ignore_errors=True)


def cleanup():
    with db.connect() as c:
        rows=c.execute("""UPDATE strava_uploads SET state='cancelled',error_code='expired'
          WHERE expires<=now() AND state=ANY(%s) RETURNING user_id,id""",(list(ACTIVE),)).fetchall()
        rows+=c.execute("SELECT user_id,id FROM strava_uploads WHERE state IN ('done','failed','cancelled')").fetchall()
        c.execute('DELETE FROM strava_uploads WHERE expires<now() AND state NOT IN (\'importing\',\'preview_queued\')')
        c.execute('DELETE FROM strava_import_stage WHERE expires<now()')
    for r in rows:shutil.rmtree(path(r['user_id'],r['id']).parent,ignore_errors=True)


def process(r,stop):
    try:
        with archive.open_archive(path(r['user_id'],r['id'])) as z:
            entries=archive.items(z)
            if r['state']=='preview_queued':preview(r['user_id'],r['id'],z,entries)
            else:import_items(r['user_id'],r['id'],entries,stop)
    except HTTPException as e:
        if e.status_code!=507:raise
        with db.connect() as c:
            c.execute("UPDATE strava_uploads SET error_code='storage_full',updated=now() WHERE user_id=%s AND id=%s AND state='importing'",(r['user_id'],r['id']))
    except (archive.ArchiveError,zipfile.BadZipFile,OSError) as e:
        with db.connect() as c:
            code=str(e) if isinstance(e,archive.ArchiveError) else 'archive_unavailable'
            c.execute("UPDATE strava_uploads SET state='failed',error_code=%s,updated=now() WHERE user_id=%s AND id=%s AND state IN ('preview_queued','importing')",(code,r['user_id'],r['id']))


def run_one(stop=None):
    stop=stop or threading.Event()
    # A session lock serializes costly parsers globally and is released by PostgreSQL after a crash.
    with db.connect() as lease:
        if not lease.execute("SELECT pg_try_advisory_lock(hashtextextended('strava-worker',0)) AS ok").fetchone()['ok']:return False
        lease.commit()
        try:
            cleanup()
            r=lease.execute("SELECT user_id,id,state FROM strava_uploads WHERE state IN ('preview_queued','importing') AND expires>now() ORDER BY updated LIMIT 1").fetchone();lease.commit()
            if not r:return False
            process(r,stop)
            return True
        finally:
            lease.rollback();lease.execute("SELECT pg_advisory_unlock(hashtextextended('strava-worker',0))");lease.commit()


def worker(stop):
    from . import strava_stage
    while not stop.is_set():
        try:
            strava_stage.send_reminder()
            if run_one(stop):continue
        except Exception:pass # SQL rollback/restart leaves the saved cursor runnable; no private contents in logs.
        stop.wait(5)


def start_worker():
    stop=threading.Event();thread=threading.Thread(target=worker,args=(stop,),daemon=True);thread.start()
    return stop,thread
