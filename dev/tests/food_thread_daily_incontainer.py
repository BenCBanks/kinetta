"""Retired daily summaries cannot be restored by old clients; food and feedback are preserved."""
import uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db
from app.main import app
uid=None
try:
 name='zz_test_retired_'+uuid.uuid4().hex[:10];pw='green kettle morning walk'
 with db.connect() as c:
  uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(name,'Fictional retire check',auth.hash_pw(pw))).fetchone()['id']
  c.execute("INSERT INTO profile(user_id,food_chat_daily_note) VALUES (%s,'off')",(uid,))
 client=TestClient(app);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':name,'password':pw}).status_code==200
 with patch('app.coach_chat.answer',side_effect=AssertionError('Retired summary cannot call a provider')):
  assert client.post('/api/food/thread/daily-note',json={}).status_code==410
  for value in ['code','ai']:assert client.put('/api/food/thread/preferences',json={'daily_note':value}).status_code==410
  assert client.put('/api/food/thread/preferences',json={'daily_note':'off','tone':'numbers'}).status_code==200
  assert client.get('/api/food/thread/preferences').json()['tone']=='numbers'
 with db.connect() as c:assert c.execute('SELECT count(*) AS n FROM food_chat_messages WHERE user_id=%s',(uid,)).fetchone()['n']==0
 print('Retired evening summaries: old-client generation/settings blocked, feedback preserved, no model work PASS')
finally:
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
