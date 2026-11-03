"""The one-tap route refuses any linked food, including partially logged cards."""
import datetime as dt
import json
import uuid
from fastapi.testclient import TestClient
from app import auth, db, food_thread as thread
from app.main import app

login='zz_test_removal_'+uuid.uuid4().hex[:12]
with db.connect() as c:
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                  (login,'Fictional removal test',auth.hash_pw('green teapot on the hill'))).fetchone()['id']
    c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
app.dependency_overrides[thread.current_user]=lambda:{'id':uid}
try:
    client=TestClient(app);client.headers['Origin']='http://testserver'
    saved=client.post('/api/food/entries?thread=true',json=[{'day':str(dt.date.today()),'meal':'lunch',
        'name':'Fictional partial plate','kcal':200,'protein_g':10,'carbs_g':25,'fat_g':5,
        'client_id':str(uuid.uuid4())}])
    assert saved.status_code==200,saved.text
    root=saved.json()['messages'][0];reply=saved.json()['messages'][1]
    with db.connect() as c:
        result=c.execute('SELECT result FROM food_chat_messages WHERE user_id=%s AND id=%s',(uid,reply['id'])).fetchone()['result']
        result['pending_count']=1
        c.execute('UPDATE food_chat_messages SET result=%s::jsonb WHERE user_id=%s AND id=%s',(json.dumps(result),uid,reply['id']))
    refused=client.delete(f"/api/food/thread/messages/{root['id']}/unlogged",headers={'Content-Type':'application/json'})
    assert refused.status_code==409,refused.text
    assert any(m['id']==root['id'] for m in client.get('/api/food/thread').json()['messages'])
    print('Food removal route: a linked entry blocks removal while other parts remain pending PASS')
finally:
    app.dependency_overrides.pop(thread.current_user,None)
    with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s AND login=%s',(uid,login))
