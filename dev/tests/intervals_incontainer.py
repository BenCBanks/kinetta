"""SQL role isolation, real export/cascades and atomic rollback. Disposable fixture database only."""
import copy,datetime as dt,json,os,tempfile,uuid,zipfile
from contextlib import contextmanager
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from app import db,intervals,api_mydata,api_activities,activities,parsers

suffix=uuid.uuid4().hex[:10];role='zz_interval_reader_'+suffix;password='fictional reader password only';ids=[]
definition=dict(schema=1,name='Fictional private interval',description='Not shared',blocks=[dict(id='block',repeat=2,steps=[dict(id='run',action='run',role='effort',title='',target=dict(kind='time',amount='5',unit='s')),dict(id='walk',action='walk',role='recovery',title='',target=dict(kind='time',amount='5',unit='s'))])])
plan=intervals.definition(definition);pids=[uuid.uuid4(),uuid.uuid4()]
try:
 with db.connect() as c:
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
  for n in range(2):
   uid=c.execute('INSERT INTO users(login,name,sql_role) VALUES(%s,%s,%s) RETURNING id',('zz_test_interval_sql_'+suffix+str(n),'Fictional Interval',role if n==0 else None)).fetchone()['id'];ids.append(uid)
   c.execute('INSERT INTO interval_presets(id,user_id,definition) VALUES(%s,%s,%s)',(pids[n],uid,Jsonb(plan['definition'])))
   c.execute('INSERT INTO interval_preset_receipts(user_id,mutation_id,preset_id,request_hash,version) VALUES(%s,%s,%s,%s,1)',(uid,uuid.uuid4(),pids[n],'fixture'))
   aid=c.execute("INSERT INTO activities(user_id,source,source_id,sport,name,start_time) VALUES(%s,'track',%s,'run','Fictional workout',now()-interval '1 hour') RETURNING id",(uid,str(uuid.uuid4()))).fetchone()['id']
   payload=dict(schema=1,pin=dict(id=str(pids[n]),version=1,content_hash=plan['content_hash'],definition=plan['definition']),status='finished',results=[dict(key=plan['steps'][0]['key'],outcome='finished',start_time=0,end_time=2,start_distance=None,end_distance=None)],effects=[])
   c.execute('INSERT INTO activity_intervals(user_id,recording_id,activity_id,payload,request_hash) VALUES(%s,%s,%s,%s,%s)',(uid,uuid.uuid4(),aid,Jsonb(payload),'fixture'))
 with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as reader:
  for table in ['interval_presets','interval_preset_receipts','activity_intervals']:
   rows=reader.execute(sql.SQL('SELECT user_id FROM {}').format(sql.Identifier(table))).fetchall();assert rows and all(r['user_id']==ids[0] for r in rows),table
   try:
    with reader.transaction():reader.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier(table)))
    raise AssertionError('Reader wrote private interval data')
   except psycopg.errors.InsufficientPrivilege:pass
 with tempfile.TemporaryDirectory(prefix='kinetta-interval-export-') as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(ids[0],path)
  with zipfile.ZipFile(path) as z:
   for table in ['interval_presets','interval_preset_receipts','activity_intervals']:
    rows=[json.loads(line) for line in z.read('data/'+table+'.jsonl').decode().splitlines()];assert len(rows)==1,table
    assert all('user_id' not in row for row in rows)
   assert 'Fictional private interval' in z.read('data/activity_intervals.jsonl').decode()
 # The real store handles both Watch/phone arrival orders; immutable private results survive enrichment/replay.
 for order in ['watch-first','phone-first']:
  start=dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=2 if order=='watch-first' else 3)
  parsed=dict(sport='run',start=start,streams={k:[] for k in ('t',)+parsers.STREAMS},session=dict(elapsed_s=20,moving_s=20,distance_m=50))
  watch=lambda:activities.store(ids[0],parsed,meta=dict(source_id='fictional-watch-'+order,elapsed_s=20,moving_s=20,distance_m=50),source='apple')
  if order=='watch-first':expected=watch()[1]
  state=dict(pin=dict(id=str(pids[0]),version=1,content_hash=plan['content_hash'],definition=plan['definition']),status='finished',results=[dict(key=plan['steps'][0]['key'],outcome='finished',start_time=0,end_time=2)],effects=[])
  phone=api_activities.TrackIn(client_id=str(uuid.uuid4()),sport='run',name='Fictional combined workout',start=start,elapsed_s=20,moving_s=2,points=[],visibility='me',intervals=state)
  saved=api_activities.save_track(phone,user=dict(id=ids[0]));aid=saved['id']
  if order=='watch-first':assert aid==expected
  with db.connect() as c:original_result=c.execute('SELECT payload FROM activity_intervals WHERE user_id=%s AND activity_id=%s',(ids[0],aid)).fetchone()['payload']
  assert watch()[1]==aid
  assert api_activities.save_track(phone,user=dict(id=ids[0]))==dict(id=aid,duplicate=True)
  with db.connect() as c:
   assert c.execute('SELECT payload FROM activity_intervals WHERE user_id=%s AND activity_id=%s',(ids[0],aid)).fetchone()['payload']==original_result
   assert c.execute('SELECT count(*) n FROM activities WHERE user_id=%s AND start_time=%s',(ids[0],start)).fetchone()['n']==1
   c.execute('DELETE FROM activities WHERE user_id=%s AND id=%s',(ids[0],aid))
 # A forced failure after activity creation rolls back both activity and interval link.
 key=str(uuid.uuid4());raw=dict(pin=dict(id=str(pids[0]),version=1,content_hash=plan['content_hash'],definition=plan['definition']),status='finished',results=[dict(key=plan['steps'][0]['key'],outcome='finished',start_time=0,end_time=2)],effects=[])
 body=api_activities.TrackIn(client_id=key,sport='run',name='Rollback fixture',start=dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=30),elapsed_s=20,moving_s=2,points=[],visibility='me',intervals=raw)
 original=db.connect
 @contextmanager
 def fail_result_insert():
  with original() as connection:
   class Wrapped:
    def execute(self,query,*args,**kwargs):
     if str(query).startswith('INSERT INTO activity_intervals'):raise RuntimeError('fictional forced interval insert failure')
     return connection.execute(query,*args,**kwargs)
    def __getattr__(self,name):return getattr(connection,name)
   yield Wrapped()
 with patch.object(db,'connect',fail_result_insert):
  try:api_activities.save_track(body,user=dict(id=ids[0]));raise AssertionError('Forced failure did not occur')
  except RuntimeError as e:assert 'fictional forced' in str(e)
 with db.connect() as c:
  assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s AND source_id=%s',(ids[0],key)).fetchone()['n']==0
  assert c.execute('SELECT count(*) AS n FROM activity_intervals WHERE user_id=%s AND recording_id=%s',(ids[0],uuid.UUID(key))).fetchone()['n']==0
  c.execute('DELETE FROM interval_presets WHERE id=%s AND user_id=%s',(pids[0],ids[0]))
  assert c.execute('SELECT count(*) AS n FROM interval_preset_receipts WHERE user_id=%s',(ids[0],)).fetchone()['n']==0
  assert c.execute('SELECT count(*) AS n FROM activity_intervals WHERE user_id=%s',(ids[0],)).fetchone()['n']==1,'Pinned history is independent of template deletion'
  c.execute('DELETE FROM users WHERE id=%s',(ids[0],))
  for table in ['interval_presets','interval_preset_receipts','activity_intervals']:
   assert c.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(ids[0],)).fetchone()['n']==0,table
 print('PASS interval SQL reader ownership/write denial, actual export, forced atomic rollback, template-independent results and account cascades')
finally:
 with db.connect() as c:
  for uid in ids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
  c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
 for uid in ids:
  import shutil
  shutil.rmtree(os.path.join(api_mydata.DATA,'files',str(uid)),ignore_errors=True)
