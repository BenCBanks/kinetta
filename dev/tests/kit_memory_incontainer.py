"""Owned memory corrections against real SQL, with no provider calls."""
import json, uuid, tempfile, zipfile
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth, db, kit_memory, api_account
from app.main import app
from app.api_mydata import _write_export
root='/api/coach/conversation/memory'
uids=[]
try:
    clients=[]
    for suffix in ('a','b'):
        login='zz_test_memory_'+suffix+uuid.uuid4().hex[:8]
        with db.connect() as c:
            uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',
              (login,'Fictional memory tester',auth.hash_pw('green kettle after morning walk'))).fetchone()['id']
            uids.append(uid)
            c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES (%s,true,now())',(uid,))
        client=TestClient(app);client.headers['Origin']='http://testserver';client.headers['Content-Type']='application/json'
        assert client.post('/api/login',json={'login':login,'password':'green kettle after morning walk'}).status_code==200
        clients.append(client)
    a,b=clients;uid,other=uids
    def req(client,method,path='',body=None,status=200):
        r=client.request(method,root+path,json=body)
        assert r.status_code==status,(r.status_code,r.text)
        return r.json()
    def save(text='I prefer evening walks.',kind='preference',**kw):
        return {'text':text,'kind':kind,'version':req(a,'GET')['version'],**kw}
    with patch('urllib.request.urlopen',side_effect=AssertionError('No provider calls')):
        assert TestClient(app).get(root).status_code==401
        assert req(a,'GET')['memories']==[]
        result=req(a,'POST',body=save());mid=result['id'];m=req(a,'GET')['memories'][0]
        assert m['source']=='user' and m['kind']=='preference' and m['created'] and m['updated']
        assert not req(b,'GET')['memories']
        req(b,'PATCH','/'+str(mid),{'text':'Other person','kind':'goal','version':0},404)
        original=m['created'];stale=save('I want a comfortable race.','goal')
        req(a,'PATCH','/'+str(mid),save('I train on Tuesdays.','routine'))
        m=req(a,'GET')['memories'][0]
        assert m['source']=='edit' and m['kind']=='routine' and m['created']==original
        req(a,'PATCH','/'+str(mid),stale,409)
        req(a,'POST',body=save('I train on Tuesdays.'),status=409)
        for body in [save(' '),save('x'*401),save(kind='diagnosis'),save(version=True),{**save(),'user_id':other}]:
            req(a,'POST',body=body,status=422)
        with db.connect() as c:
            memories,_,_=kit_memory.context(c,uid)
            assert memories[0]['user_said']=='I train on Tuesdays.' and set(memories[0])=={'said_at','user_said'}
            kit_memory.remember(c,uid,'My goal is a short race.')
            assert c.execute('SELECT kind,source FROM kit_memories WHERE user_id=%s AND text=%s',
                (uid,'My goal is a short race.')).fetchone()=={'kind':'goal','source':'chat'}
            c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(uid,))
        req(a,'POST',body=save(),status=403)
        # Own-data read/forget remain usable after consent revocation.
        assert req(a,'GET')['memories'];req(a,'DELETE','/'+str(mid))
        with db.connect() as c:
            c.execute('UPDATE profile SET ai_ok=true WHERE user_id=%s',(uid,))
            c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES (%s,'walk','healthkit','Fictional walk',now())",(uid,))
            kit_memory.remember(c,uid,'I prefer gentle walks.',True)
        health=next(m for m in req(a,'GET')['memories'] if m['health_included'])
        req(a,'PATCH','/'+str(health['id']),save('I prefer slow walks.'),403)
        with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(uid,))
        req(a,'PATCH','/'+str(health['id']),save('I prefer slow walks.'))
        assert next(m for m in req(a,'GET')['memories'] if m['id']==health['id'])['health_included']
        # Every correction cancels pending/running leases, so late work cannot persist old context.
        with db.connect() as c:
            generation=c.execute('SELECT generation FROM kit_conversations WHERE user_id=%s',(uid,)).fetchone()['generation']
            client_id=uuid.uuid4()
            c.execute("INSERT INTO kit_turns(user_id,client_id,generation,question,state,lease,expires) VALUES (%s,%s,%s,'Review my routine','running',%s,now()+interval '5 minutes')",(uid,client_id,generation,uuid.uuid4()))
        req(a,'PATCH','/'+str(health['id']),save('I prefer quiet walks.'))
        with db.connect() as c:
            row=c.execute('SELECT state,lease FROM kit_turns WHERE user_id=%s AND client_id=%s',(uid,client_id)).fetchone()
            assert row=={'state':'failed','lease':None}
        req(a,'PUT',body={'enabled':False});assert not req(a,'GET')['memories']
        req(a,'POST',body=save(),status=409);req(a,'PUT',body={'enabled':True})
        for i in range(12):req(a,'POST',body=save('I prefer fictional routine '+str(i)+'.'))
        req(a,'POST',body=save('I prefer another routine.'),status=409)
        with tempfile.TemporaryDirectory() as folder:
            dest=folder+'/export.zip';_write_export(uid,dest)
            with zipfile.ZipFile(dest) as z:
                rows=[json.loads(line) for line in z.read('data/kit_memories.jsonl').decode().splitlines()]
                assert len(rows)==12 and all(r['source']=='user' and 'kind' in r and 'user_id' not in r for r in rows)
        # Restricted owner SQL cannot read the other account's memory.
        with db.connect() as c:
            c.execute('SET LOCAL ROLE fit_readers')
            assert not c.execute('SELECT id FROM kit_memories WHERE user_id=%s',(uid,)).fetchall()
        with db.connect() as c:api_account.erase(c,{'id':uid,'sql_role':None})
        with db.connect() as c:assert not c.execute('SELECT id FROM kit_memories WHERE user_id=%s',(uid,)).fetchall()
    # Reproduce an existing 120 memory upgrading to 121, then roll back the fixture DDL.
    with db.connect() as c:
        with c.transaction(force_rollback=True):
            c.execute('ALTER TABLE kit_memories DROP COLUMN kind,DROP COLUMN source')
            row=c.execute("INSERT INTO kit_memories(user_id,text,created,updated) VALUES (%s,'My goal is a comfortable race.',now()-interval '7 days',now()-interval '2 days') RETURNING id,created,updated",(other,)).fetchone()
            c.execute(db.MIGRATIONS[120])  # Migration 121, even after later migrations are appended.
            upgraded=c.execute('SELECT kind,source,created,updated FROM kit_memories WHERE user_id=%s AND id=%s',(other,row['id'])).fetchone()
            assert upgraded=={'kind':'goal','source':'chat','created':row['created'],'updated':row['updated']}
    print('Kit memory correction: schema, ownership, versions, source/date, consent, leases, upgrade, bounds, RLS/export/delete PASS')
finally:
    with db.connect() as c:
        for uid in uids:api_account.erase(c,{'id':uid,'sql_role':None})
