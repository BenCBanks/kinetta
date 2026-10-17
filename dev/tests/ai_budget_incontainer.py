"""Durable cap/budget tests with fictional accounts and zero provider calls."""
import concurrent.futures as futures
import datetime as dt
import importlib
import io
import json
import os
import secrets
import psycopg
from psycopg import sql
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from app import db,ai_budget as B,food_photo as F,api_mydata

class Budget(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with db.connect() as c:
   cls.uid=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_ai_budget','Fictional budget') RETURNING id").fetchone()['id']
   cls.other=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_ai_budget_other','Fictional other') RETURNING id").fetchone()['id']
 @classmethod
 def tearDownClass(cls):
  with db.connect() as c:
   for uid in (cls.uid,cls.other):
    rows=c.execute('DELETE FROM ai_food_attempts WHERE user_id=%s RETURNING day,charged_micros',(uid,)).fetchall()
    for r in rows:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(r['charged_micros'],r['day']))
    c.execute('DELETE FROM users WHERE id=%s',(uid,))
 def refused(self,fn,code):
  with self.assertRaises(HTTPException) as e:fn()
  self.assertEqual(e.exception.status_code,code)
 def reserve(self):
  with B.scope(self.uid):return B.reserve('gemini-3.1-flash-lite','budget-test')
 def test_01_daily_concurrency_restart(self):
  def attempt(_):
   try:B.daily(self.uid,'concurrent',7,'estimates');return True
   except HTTPException as e:self.assertEqual(e.status_code,429);return False
  with futures.ThreadPoolExecutor(max_workers=12) as pool:self.assertEqual(sum(pool.map(attempt,range(30))),7)
  importlib.reload(B)
  self.refused(lambda:B.daily(self.uid,'concurrent',7,'estimates'),429)
  B.daily(self.other,'concurrent',7,'estimates')
  with db.connect() as c:
   self.assertEqual(c.execute("SELECT requests FROM ai_daily_usage WHERE user_id=%s AND kind='concurrent'",(self.uid,)).fetchone()['requests'],7)
 def test_02_scope_and_disabled(self):
  self.refused(lambda:B.reserve('gemini-3.1-flash-lite','test'),503)
  with patch.dict(os.environ,{'KINETTA_AI_ENABLED':'0'}),patch('urllib.request.urlopen') as net:
   self.refused(lambda:B.daily(self.uid,'photo',40,'estimates'),503)
   self.refused(self.reserve,503);net.assert_not_called()
  with B.scope(self.uid):self.refused(lambda:B.reserve('unknown-model','test'),503)
  with patch.dict(os.environ,{'KINETTA_FOOD_AI_DAILY_USD':'NaN'}):self.refused(self.reserve,503)
  with patch.dict(os.environ,{'KINETTA_FOOD_AI_DAILY_USD':'0'}):self.refused(self.reserve,429)
 def test_03_budget_concurrency(self):
  with db.connect() as c:before=c.execute("SELECT coalesce(sum(charged_micros),0) AS n FROM ai_service_budget WHERE day=(now() AT TIME ZONE 'UTC')::date").fetchone()['n']
  hold=B.price('gemini-3.1-flash-lite',*B.request_tokens())
  cap=str((before+hold*2)/1_000_000)
  def attempt(_):
   try:return self.reserve()
   except HTTPException as e:self.assertEqual(e.status_code,429);return None
  with patch.dict(os.environ,{'KINETTA_FOOD_AI_DAILY_USD':cap,'KINETTA_AI_USER_DAILY_MICROUSD':'100000000'}):
   with futures.ThreadPoolExecutor(max_workers=8) as pool:ids=[r for r in pool.map(attempt,range(12)) if r]
  self.assertEqual(len(ids),2)
  B.settle(ids[0],{'usageMetadata':{'promptTokenCount':1000,'candidatesTokenCount':50,'thoughtsTokenCount':150}})
  B.settle(ids[0],{'usageMetadata':{'promptTokenCount':1,'candidatesTokenCount':1}})
  B.settle(ids[1],{'usageMetadata':{'promptTokenCount':100}})
  with db.connect() as c:
   row=c.execute('SELECT * FROM ai_food_attempts WHERE id=%s',(ids[0],)).fetchone()
   self.assertEqual(row['charged_micros'],550);self.assertEqual(row['thinking_tokens'],150)
   self.assertEqual(c.execute('SELECT state FROM ai_food_attempts WHERE id=%s',(ids[1],)).fetchone()['state'],'reserved')
 def test_04_every_attempt_and_usage_before_parse(self):
  asked=[]
  def transport(req,timeout=None):
   import urllib.error
   asked.append(req)
   if len(asked)<3:raise urllib.error.HTTPError(req.full_url,503,'busy',{},io.BytesIO(b'private response omitted'))
   return io.BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'text':'{"ok":true}'}]}}],
       'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':10,'thoughtsTokenCount':20}}).encode())
  with patch.dict(os.environ,{'KINETTA_FOOD_AI_DAILY_USD':'100'}),B.scope(self.uid),patch('urllib.request.urlopen',side_effect=transport),patch('time.sleep'):
   out,_,_=F.ask([{'text':'Fictional food'}],{'type':'OBJECT'},'budget-transport');self.assertTrue(out['ok'])
  with db.connect() as c:
   rows=c.execute("SELECT * FROM ai_food_attempts WHERE user_id=%s AND kind='budget-transport' ORDER BY created",(self.uid,)).fetchall()
   self.assertEqual(len(rows),3);self.assertEqual([r['state'] for r in rows],['measured','measured','measured'])
   self.assertEqual(rows[-1]['charged_micros'],375)
   self.assertEqual(sum(r['charged_micros'] for r in rows[:2]),0)
  self.assertEqual(len(asked),3)
 def test_045_sized_hold_and_unknown_failures(self):
  request={'contents':[{'parts':[{'text':'Fictional food'},{'inlineData':{'mimeType':'image/jpeg','data':'x'*1000000}}]}],'generationConfig':{'maxOutputTokens':2048}}
  estimated,output=B.request_tokens(request)
  self.assertGreater(estimated,16384);self.assertLess(estimated,20000);self.assertEqual(output,2048)
  self.assertLess(B.price('gemini-3.1-flash-lite',estimated,output),10000)
  with patch.dict(os.environ,{'KINETTA_FOOD_AI_DAILY_USD':'100'}):rid=self.reserve()
  B.release_failed(rid,None)
  with db.connect() as c:self.assertEqual(c.execute('SELECT state FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['state'],'reserved')
  B.release_failed(rid,429);B.release_failed(rid,503)
  with db.connect() as c:self.assertEqual(c.execute('SELECT charged_micros FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['charged_micros'],0)
  with patch.dict(os.environ,{'KINETTA_AI_PRICING_REVIEW_BY':'2020-01-01'}):self.refused(self.reserve,503)
  with patch.dict(os.environ,{'KINETTA_AI_PRICING_REVIEW_BY':'not-a-date'}):self.refused(self.reserve,503)
 def test_05_private_schema_export(self):
  self.assertIn('ai_daily_usage',api_mydata.TABLES);self.assertIn('ai_food_attempts',api_mydata.TABLES)
  with db.connect() as c:
   for table in ('ai_daily_usage','ai_food_attempts','ai_service_budget'):
    self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE oid=%s::regclass',(table,)).fetchone()['relrowsecurity'])
   self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers','ai_service_budget','SELECT') AS yes").fetchone()['yes'])
   cols={r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name='ai_food_attempts'").fetchall()}
   self.assertFalse(cols & {'body','photo','image','prompt','response','token','api_key'})
 def test_055_real_read_only_identity(self):
  role='zz_test_ai_budget_reader';password=secrets.token_urlsafe(24)
  try:
   with db.connect() as c:
    c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
    c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
    c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.other))
   with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
    rows=reader.execute('SELECT user_id FROM ai_daily_usage').fetchall()
    self.assertTrue(rows);self.assertTrue(all(r['user_id']==self.other for r in rows))
    self.assertEqual(reader.execute('SELECT * FROM ai_food_attempts').fetchall(),[])
    for query in ('SELECT * FROM ai_service_budget','DELETE FROM ai_daily_usage'):
     with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute(query)
     reader.rollback()
  finally:
   with db.connect() as c:
    c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.other,))
    c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
 def test_06_account_delete_keeps_bill(self):
  with db.connect() as c:uid=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_ai_budget_delete','Fictional delete') RETURNING id").fetchone()['id']
  with B.scope(uid):rid=B.reserve('gemini-3.1-flash-lite','delete-test')
  with db.connect() as c:
   old=c.execute('SELECT day,charged_micros FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()
   c.execute('DELETE FROM users WHERE id=%s',(uid,))
   row=c.execute('SELECT user_id,charged_micros FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()
   self.assertIsNone(row['user_id']);self.assertEqual(old['charged_micros'],row['charged_micros'])
   c.execute('DELETE FROM ai_food_attempts WHERE id=%s',(rid,));c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(old['charged_micros'],old['day']))

unittest.main()
