"""Real fictional DB/API replay, concurrency and permissions. Disposable server only."""
import uuid
import hashlib
import psycopg
from psycopg import sql
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from app import auth, db
from app.main import app

suffix = uuid.uuid4().hex[:8]
password = 'green teapot on the hill'
people = []
# Draft runs append to their own base without placeholder slots. Restack after 129/130 before Ready;
# the test also allows later migrations once this PR has landed.
comment_slot = next(i for i,m in enumerate(db.MIGRATIONS,1) if 'CREATE UNIQUE INDEX IF NOT EXISTS comments_request' in m)
for marker in ('reports ADD COLUMN IF NOT EXISTS group_update_id', 'auth_attempts_enrollment_expiry'):
    predecessors = [i for i,m in enumerate(db.MIGRATIONS,1) if marker in m]
    assert all(i < comment_slot for i in predecessors), 'pending prerequisites must precede comments'
db.migrate();db.migrate()
with db.connect() as c:
    assert c.execute('SELECT max(version) AS v FROM schema_version').fetchone()['v'] == len(db.MIGRATIONS)

    migration = next(m for m in db.MIGRATIONS if 'CREATE UNIQUE INDEX IF NOT EXISTS comments_request' in m)
    before = c.execute('SELECT id,activity_id,user_id,text FROM comments ORDER BY id').fetchall()
    c.execute(migration);c.execute(migration)
    assert c.execute('SELECT id,activity_id,user_id,text FROM comments ORDER BY id').fetchall() == before
    assert c.execute("SELECT relrowsecurity FROM pg_class WHERE oid='comments'::regclass").fetchone()['relrowsecurity']
    for name in ('owner', 'writer', 'other'):
        login = f'zz_test_retry_{name}_{suffix}'
        uid = c.execute("""INSERT INTO users(login,name,first_name,last_name,pw_hash,email_verified_at,signup_confirmed_at)
            VALUES(%s,'Jordan Example','Jordan','Example',%s,now(),now()) RETURNING id""",
            (login,auth.hash_pw(password))).fetchone()['id']
        c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
        people.append((uid,login))
    aid = c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,visibility)
        VALUES(%s,'run','Fictional retry run',now(),'manual','everyone') RETURNING id""",(people[0][0],)).fetchone()['id']
clients = []
try:
    for uid,login in people:
        client = TestClient(app,headers={'Origin':'http://testserver'})
        response = client.post('/api/login',json={'login':login,'password':password,'app':True})
        assert response.status_code == 200,response.text
        client.headers['Authorization'] = 'Bearer '+response.json()['token']
        clients.append(client)
    owner,writer,other = clients
    path = f'/api/activities/{aid}/comments'
    key = str(uuid.uuid4())
    payload = {'text':'Fictional retry comment','client_id':key}
    response = writer.post(path,json=payload)
    assert response.status_code == 200,response.text
    cid = response.json()['comments'][-1]['id']
    for _ in range(3):
        replay = writer.post(path,json=payload)
        assert replay.status_code == 200 and replay.json()['comments'][-1]['id'] == cid
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM comments WHERE user_id=%s AND client_id=%s',(people[1][0],key)).fetchone()['n'] == 1
        assert c.execute('SELECT count(*) AS n FROM notifications WHERE comment_id=%s',(cid,)).fetchone()['n'] == 1
        assert c.execute('SELECT count(*) AS n FROM auth_attempts WHERE key=%s',(f'new-social:comment:{people[1][0]}',)).fetchone()['n'] == 1
    assert writer.post(path,json={**payload,'text':'Changed intention'}).status_code == 409
    with db.connect() as c:
        other_aid = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility) VALUES(%s,'run','Fictional second run',now(),'manual','everyone') RETURNING id",(people[0][0],)).fetchone()['id']
    assert writer.post(f'/api/activities/{other_aid}/comments',json=payload).status_code == 409
    assert writer.post(f'/api/activities/{aid+999999}/comments',json=payload).status_code == 404
    assert writer.post(path,json={**payload,'client_id':'not-a-uuid'}).status_code == 422
    # The key is scoped to the authenticated account, never a globally readable identifier.
    assert other.post(path,json=payload).status_code == 200
    # Export the owner's retry metadata without mixing another writer using the same UUID.
    from app import api_mydata
    with db.connect() as c:
        def exported(uid):
            return [next(iter(row.values())) for row in c.execute(api_mydata.TABLES['comments_written'],(uid,))]
        own,peer=exported(people[1][0]),exported(people[2][0])
        assert len(own)==len(peer)==1
        assert set(own[0])=={'id','activity_id','text','created','client_id'}
        assert own[0]['id']==cid and own[0]['client_id']==key
        assert peer[0]['id']!=cid and peer[0]['client_id']==key
    concurrent = {**payload,'client_id':str(uuid.uuid4()),'text':'Fictional concurrent retry'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        replies = list(pool.map(lambda _:writer.post(path,json=concurrent),range(4)))
    assert all(r.status_code == 200 for r in replies),[r.text for r in replies]
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM comments WHERE user_id=%s AND client_id=%s',(people[1][0],concurrent['client_id'])).fetchone()['n'] == 1
        c.execute("UPDATE activities SET visibility='me' WHERE id=%s",(aid,))
    assert writer.post(path,json=payload).status_code == 404,'replay rechecks changed audience'
    with db.connect() as c:
        c.execute("UPDATE activities SET visibility='everyone' WHERE id=%s",(aid,))
        c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(people[0][0],people[1][0]))
    assert writer.post(path,json=payload).status_code == 404,'replay rechecks blocking'
    with db.connect() as c:
        c.execute('DELETE FROM blocks WHERE user_id=%s',(people[0][0],))
        c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s',(people[1][0],))
    assert writer.post(path,json=payload).status_code == 403,'replay rechecks email confirmation'
    with db.connect() as c:
        c.execute('UPDATE users SET needs_email_confirm=false,suspended_at=now() WHERE id=%s',(people[1][0],))
    assert writer.post(path,json=payload).status_code == 401,'suspended session cannot replay'
    with db.connect() as c:
        c.execute('UPDATE users SET needs_email_confirm=false,suspended_at=NULL WHERE id=%s',(people[1][0],))
    # Deletion by either author or activity owner keeps the receipt, never resurrects or re-notifies.
    for actor in (writer,owner):
        tombstone_key=str(uuid.uuid4());body={'text':'Fictional removable comment','client_id':tombstone_key}
        posted=writer.post(path,json=body);assert posted.status_code==200,posted.text
        removed=next(row['id'] for row in posted.json()['comments'] if row['text']==body['text'])
        deletion=actor.delete(f'/api/comments/{removed}',headers={'Content-Type':'application/json'});assert deletion.status_code==200,(deletion.status_code,deletion.text)
        with db.connect() as c:
            notifications=c.execute('SELECT count(*) AS n FROM notifications WHERE actor_id=%s',(people[1][0],)).fetchone()['n']
            budget=c.execute('SELECT count(*) AS n FROM auth_attempts WHERE key=%s',(f'new-social:comment:{people[1][0]}',)).fetchone()['n']
        with ThreadPoolExecutor(max_workers=3) as pool:
            retried=list(pool.map(lambda _:writer.post(path,json=body),range(3)))
        assert all(r.status_code==200 and all(row['id']!=removed for row in r.json()['comments']) for r in retried)
        assert writer.post(path,json={**body,'text':'Different body after deletion'}).status_code==409
        with db.connect() as c:
            assert not c.execute('SELECT 1 FROM comments WHERE user_id=%s AND client_id=%s',(people[1][0],tombstone_key)).fetchone()
            assert c.execute('SELECT count(*) AS n FROM notifications WHERE actor_id=%s',(people[1][0],)).fetchone()['n']==notifications
            assert c.execute('SELECT count(*) AS n FROM auth_attempts WHERE key=%s',(f'new-social:comment:{people[1][0]}',)).fetchone()['n']==budget
            receipt=c.execute('SELECT * FROM comment_receipts WHERE user_id=%s AND client_id=%s',(people[1][0],tombstone_key)).fetchone()
            assert receipt['text_hash']==hashlib.sha256(body['text'].encode()).hexdigest()
            assert (receipt['expires']-receipt['created']).total_seconds()==7*86400
    # Upgrade from131 backfills live keys exactly once; replaying132 preserves existing receipts.
    with db.connect() as c:
        upgrade_key=uuid.uuid4()
        c.execute("INSERT INTO comments(activity_id,user_id,text,client_id) VALUES(%s,%s,'Fictional131 upgrade',%s)",(aid,people[1][0],upgrade_key))
        migration132=next(m for m in db.MIGRATIONS if 'CREATE TABLE IF NOT EXISTS comment_receipts' in m)
        # Rehearse the actual131 table state, not just CREATE IF NOT EXISTS on132.
        c.execute('SAVEPOINT upgrade_from_131');c.execute('DROP TABLE comment_receipts');c.execute(migration132)
        backfilled=c.execute('SELECT text_hash FROM comment_receipts WHERE user_id=%s AND client_id=%s',(people[1][0],upgrade_key)).fetchone()
        assert backfilled['text_hash']==hashlib.sha256(b'Fictional131 upgrade').hexdigest()
        c.execute('ROLLBACK TO SAVEPOINT upgrade_from_131')
        c.execute(migration132)
        original=c.execute('SELECT * FROM comment_receipts WHERE user_id=%s ORDER BY client_id',(people[1][0],)).fetchall()
        c.execute(migration132);assert c.execute('SELECT * FROM comment_receipts WHERE user_id=%s ORDER BY client_id',(people[1][0],)).fetchall()==original
        assert any(row['client_id']==upgrade_key for row in original)
        assert c.execute("SELECT relrowsecurity FROM pg_class WHERE oid='comment_receipts'::regclass").fetchone()['relrowsecurity']
        own_receipts=[next(iter(row.values())) for row in c.execute(api_mydata.TABLES['comment_receipts'],(people[1][0],))]
        peer_receipts=[next(iter(row.values())) for row in c.execute(api_mydata.TABLES['comment_receipts'],(people[2][0],))]
        assert set(own_receipts[0])=={'client_id','activity_id','text_hash','created','expires'}
        assert len(peer_receipts)==1 and peer_receipts[0]['client_id']==key
        assert tombstone_key in {row['client_id'] for row in own_receipts}
    # Real SQL reporting login: grants never expose another owner's receipt (even the same UUID).
    role=f'zz_test_receipts_{suffix}';role_pw='fictional receipt reader password'
    try:
        with db.connect() as c:
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(role_pw)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,people[2][0]))
        with psycopg.connect(db._conninfo(role,role_pw)) as reader:
            rows=reader.execute('SELECT user_id,client_id FROM comment_receipts').fetchall()
            assert rows==[(people[2][0],uuid.UUID(key))],rows
    finally:
        with db.connect() as c:
            c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(people[2][0],))
            c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
    # Expired hash-only metadata is pruned on next own write, including deleted comments.
    with db.connect() as c:
        c.execute("UPDATE comment_receipts SET expires=now()-interval '1 second' WHERE user_id=%s AND client_id=%s",(people[1][0],tombstone_key))
    fresh=writer.post(path,json={'text':'Fictional after expiry','client_id':str(uuid.uuid4())});assert fresh.status_code==200,fresh.text
    with db.connect() as c:
        assert not c.execute('SELECT 1 FROM comment_receipts WHERE user_id=%s AND client_id=%s',(people[1][0],tombstone_key)).fetchone()
    # Full account deletion removes all its receipts, preserving unrelated writers.
    assert writer.post('/api/account/delete',json={'password':password}).status_code==200
    with db.connect() as c:
        assert not c.execute('SELECT 1 FROM comment_receipts WHERE user_id=%s',(people[1][0],)).fetchone()
        assert c.execute('SELECT 1 FROM comment_receipts WHERE user_id=%s',(people[2][0],)).fetchone()
    # Legacy clients may omit the key; their API contract stays accepted.
    assert owner.post(path,json={'text':'Fictional old client'}).status_code == 200
    print('Comment receipts: delete/replay/no notification or budget, upgrade132, seven-day expiry, export/RLS/account erasure PASS')
    print('Comment retries: account scope/concurrent replay/one notification+budget/conflict/access/confirmation/suspension/legacy PASS')
finally:
    for client in clients:client.close()
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=ANY(%s)',([uid for uid,_ in people],))
