"""Actual private weight recovery, source preservation and Nutrition arithmetic; fictional accounts only."""
import datetime as dt
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import auth,db,api_food as food
from app.main import app

uids=[];clients=[];password='green teapot on the hill';role='zz_test_weightundo_'+uuid.uuid4().hex[:8]
today=dt.datetime.now(dt.timezone.utc).date();day=str(today)
def ok(response,status=200):
    assert response.status_code==status,(response.status_code,response.text)
    return response.json() if status!=500 else None
def undo(identity,client=None,status=200):
    return ok((client or clients[0]).post('/api/food/weights/undo',json={'id':identity,'confirmed':True}),status)
def remove(date=day,client=None):return ok((client or clients[0]).delete('/api/food/weights/'+date,headers={'Content-Type':'application/json'}))['undo_id']
def point(date=day):
    with db.connect() as c:return c.execute('SELECT day,kg,note,source,health_sample_id,source_name FROM weights WHERE user_id=%s AND day=%s',(uids[0],date)).fetchone()
try:
    for _ in range(2):
        login='zz_test_weightundo_'+uuid.uuid4().hex[:10]
        with db.connect() as c:
            uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Weight Undo',auth.hash_pw(password))).fetchone()['id'];uids.append(uid)
            c.execute("INSERT INTO profile(user_id,tz,weight_kg,kcal_target) VALUES(%s,'UTC',70,2100)",(uid,))
        client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver'
        ok(client.post('/api/login',json={'login':login,'password':password}));clients.append(client)
    a,b=clients;uid,other=uids
    with patch('urllib.request.urlopen',side_effect=AssertionError('No provider calls')):
        ok(a.put('/api/food/weights',json={'day':day,'kg':70.125,'note':'Fictional precise note'}));original=point();identity=remove();assert point() is None
        ok(a.post('/api/food/weights/undo',json={'id':identity}),400)
        ok(a.post('/api/food/weights/undo',json={'id':identity,'confirmed':1}),422)
        undo(identity,b,404);assert point() is None
        assert TestClient(app).post('/api/food/weights/undo',json={'id':identity,'confirmed':True}).status_code==401
        with patch('app.api_food._latest_weight',side_effect=RuntimeError('Fictional rollback')):undo(identity,status=500)
        assert point() is None
        body=food.WeightUndoIn(id=identity,confirmed=True)
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:food.weight_undo(body,{'id':uid}),range(2)))
        assert sum(r['replayed'] for r in results)==1 and point()==original
        assert undo(identity)['replayed'] and point()==original
        old=remove();ok(a.put('/api/food/weights',json={'day':day,'kg':72,'note':'Newer fictional edit'}));new=remove()
        undo(old,status=409);assert point() is None;undo(new);assert point()['kg']==72
        expired=remove()
        with db.connect() as c:c.execute("UPDATE weight_delete_undos SET expires_at=now()-interval '1 second' WHERE user_id=%s AND id=%s",(uid,expired))
        undo(expired,status=404);assert point() is None
        # Every writer invalidates an old recovery, even when a newer import is subsequently cleared.
        imported=str(today-dt.timedelta(days=3))
        ok(a.post('/api/food/history',json={'rows':[{'day':imported,'weight_kg':68.5}]}));saved=point(imported)
        receipt=remove(imported);undo(receipt);assert point(imported)==saved and saved['source']=='import'
        receipt=remove(imported)
        ok(a.post('/api/food/history',json={'rows':[{'day':imported,'weight_kg':75}]}))
        ok(a.post('/api/food/history',json={'replace':True,'rows':[{'day':imported,'weight_kg':None}]}))
        undo(receipt,status=409);assert point(imported) is None

        def health_point():
            with db.connect() as c:
                c.execute('DELETE FROM weights WHERE user_id=%s',(uid,));c.execute('DELETE FROM health_weight_samples WHERE user_id=%s',(uid,));c.execute('DELETE FROM health_weight_exclusions WHERE user_id=%s',(uid,))
            ok(a.put('/api/profile',json={'tz':'UTC'}))
            state=ok(a.put('/api/health/weights/preferences',json={'enabled':True,'confirmed':True}))
            date=today-dt.timedelta(days=2);first,last=str(uuid.uuid4()),str(uuid.uuid4());at=dt.datetime.combine(date,dt.time(12),dt.timezone.utc)
            samples=[{'sample_id':key,'sampled_at':(at+dt.timedelta(hours=i)).isoformat(),'kg':69-i,'source_name':'Fictional Scale','source_bundle':'example.test.scale'} for i,key in enumerate((first,last))]
            ok(a.post('/api/health/weights',json={'epoch':state['epoch'],'tz':'UTC','observed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'samples':samples}))
            with db.connect() as c:
                c.execute('UPDATE health_weight_samples SET excluded=true WHERE user_id=%s AND sample_id=%s',(uid,first))
                c.execute('INSERT INTO health_weight_exclusions(user_id,day,before_time) VALUES(%s,%s,%s)',(uid,date,at-dt.timedelta(hours=1)))
            return str(date),first,last,state
        date,first,last,state=health_point();saved=point(date)
        with db.connect() as c:fence=c.execute('SELECT before_time FROM health_weight_exclusions WHERE user_id=%s AND day=%s',(uid,date)).fetchone()
        receipt=remove(date);assert point(date) is None;undo(receipt);assert point(date)==saved
        with db.connect() as c:
            flags={str(r['sample_id']):r['excluded'] for r in c.execute('SELECT sample_id,excluded FROM health_weight_samples WHERE user_id=%s',(uid,))}
            assert flags=={first:True,last:False}
            assert c.execute('SELECT before_time FROM health_weight_exclusions WHERE user_id=%s AND day=%s',(uid,date)).fetchone()==fence
        me=ok(a.get('/api/me'));assert me['weight_kg']==68 and me['weight_health_derived'] and not me['health_ai_ok'] and not me['health_weight_ai_ok']
        date,first,last,state=health_point();receipt=remove(date)
        ok(a.post('/api/health/weights',json={'epoch':state['epoch'],'tz':'UTC','observed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'deleted':[last]}))
        undo(receipt,status=409);assert point(date) is None
        date,first,last,state=health_point();receipt=remove(date)
        ok(a.put('/api/health/weights/preferences',json={'enabled':False,'confirmed':True}));undo(receipt,status=409)
        ok(a.put('/api/health/weights/preferences',json={'enabled':True,'confirmed':True}));undo(receipt,status=409);assert point(date) is None
        date,first,last,state=health_point();receipt=remove(date);ok(a.put('/api/profile',json={'tz':'America/New_York'}));undo(receipt,status=409)

        # Zero-calorie logged days remain discoverable; incomplete weekly macros never become known zero.
        ok(b.post('/api/food/entries',json=[{'day':day,'meal':'lunch','name':'Fictional zero','kcal':0,'protein_g':0,'ref':{'unknown_nutrients':['protein_g']}}]))
        with db.connect() as c:c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal) VALUES(%s,%s,'lunch','Fictional future',9000)",(other,today+dt.timedelta(days=1)))
        row=next(r for r in ok(b.get('/api/food/insights?days=30'))['rows'] if r['day']==day);assert row['entries']==1 and row['eaten']==0 and row['protein_g'] is None
        week=ok(b.get('/api/food/weeks'))['weeks'][-1];assert week['days_logged']==1 and week['kcal']==0 and week['protein_g'] is None
        recipe=ok(b.post('/api/dishes',json={'name':'Fictional precise recipe'}));rid=recipe['id']
        recipe=ok(b.patch('/api/dishes/'+str(rid),json={'known_kcal':642,'yield_servings':2,'serving':'one'}));assert recipe['totals']['kcal']==642 and recipe['per_serving']['kcal']==321
        portion=ok(b.post(f'/api/dishes/{rid}/portion',json={'day':day,'meal':'dinner','count':1,'client_id':str(uuid.uuid4())}));assert portion['entry']['kcal']==321

        # The SQL reader sees its own recovery data only, and account deletion removes that data too.
        ok(a.put('/api/food/weights',json={'day':day,'kg':70}));own_id=remove()
        ok(b.put('/api/food/weights',json={'day':day,'kg':80}));other_id=remove(client=b)
        secret=secrets.token_urlsafe(24)
        with db.connect() as c:
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(secret)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
        with psycopg.connect(db._conninfo(role,secret),row_factory=psycopg.rows.dict_row) as reader:
            rows=reader.execute('SELECT id,user_id FROM weight_delete_undos').fetchall();assert rows and all(r['user_id']==uid for r in rows)
            assert own_id in {str(r['id']) for r in rows} and other_id not in {str(r['id']) for r in rows}
            try:reader.execute('UPDATE weight_delete_undos SET active=false')
            except psycopg.errors.InsufficientPrivilege:reader.rollback()
            else:raise AssertionError('Personal SQL reader could write recovery data')
        ok(a.post('/api/account/delete',json={'password':password}))
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM weight_delete_undos WHERE user_id=%s',(uid,)).fetchone()
            assert c.execute('SELECT 1 FROM weight_delete_undos WHERE user_id=%s',(other,)).fetchone()
    print('Weight Undo HTTP/SQL: exact manual/import/Health recovery, rollback/concurrent replay, newer writes/import clearing, expiry, owner/RLS/cascade, Health flags/fence/tombstone/permission/timezone and profile consent PASS; zero-day/weekly unknowns and precise recipe storage PASS')
finally:
    for client in clients:client.close()
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
