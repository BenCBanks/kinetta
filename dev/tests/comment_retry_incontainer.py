"""Real fictional DB/API replay, concurrency and permissions. Disposable server only."""
import uuid
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
    # Legacy clients may omit the key; their API contract stays accepted.
    assert owner.post(path,json={'text':'Fictional old client'}).status_code == 200
    print('Comment retries: account scope/concurrent replay/one notification+budget/conflict/access/confirmation/suspension/legacy PASS')
finally:
    for client in clients:client.close()
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=ANY(%s)',([uid for uid,_ in people],))
