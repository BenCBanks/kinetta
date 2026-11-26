"""API request log and the owner's SQL access to operational tables (migration 70)."""
import time, unittest
from fastapi.testclient import TestClient
from app import db, auth
from app.main import app

PW = 'test account private password'


def rows(where, *args):
    for _ in range(50):      # written on a worker thread just after each response
        with db.connect() as c:
            found = c.execute(f'SELECT * FROM api_requests WHERE {where} ORDER BY id', args).fetchall()
        if found: return found
        time.sleep(0.05)
    return []


class RequestLog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login = 'zz_test_reqlog'")
            cls.uid = c.execute("INSERT INTO users (login, name, pw_hash) VALUES ('zz_test_reqlog', 'Request Log', %s) RETURNING id", (auth.hash_pw(PW),)).fetchone()['id']
            c.execute('INSERT INTO profile (user_id) VALUES (%s)', (cls.uid,))

    @classmethod
    def tearDownClass(cls):
        with db.connect() as c: c.execute("DELETE FROM users WHERE login = 'zz_test_reqlog'")

    def test_calls_are_recorded_without_values(self):
        c = TestClient(app); c.headers['Origin'] = 'http://testserver'
        self.assertEqual(c.post('/api/login', json={'login': 'zz_test_reqlog', 'password': PW}).status_code, 200)
        aid = c.post('/api/activities/manual', json={'sport': 'run', 'start': '2026-10-01T08:00:00+00:00', 'duration_s': 600, 'distance_m': 2000, 'name': 'Private morning loop'}).json()['id']
        r = c.get(f'/api/activities/{aid}?units=metric')
        rid = r.headers['x-request-id']
        got = rows('request_id = %s', rid)
        self.assertEqual(len(got), 1)
        row = got[0]
        self.assertEqual((row['user_id'], row['method'], row['route'], row['status'], row['channel']), (self.uid, 'GET', '/api/activities/{aid}', 200, 'web'))
        self.assertGreaterEqual(row['duration_ms'], 0)
        mine = rows('user_id = %s', self.uid)
        self.assertTrue(any(x['route'] == '/api/activities/manual' and x['method'] == 'POST' for x in mine))
        self.assertNotIn('Private morning loop', str(mine)); self.assertNotIn(str(aid), ' '.join(x['route'] for x in mine)); self.assertNotIn('metric', str(mine))
        anon = TestClient(app).get('/api/setup')
        self.assertIsNone(rows('request_id = %s', anon.headers['x-request-id'])[0]['user_id'])
        app_call = TestClient(app).get('/api/me', headers={'Authorization': 'Bearer not-a-real-token'})
        self.assertEqual(rows('request_id = %s', app_call.headers['x-request-id'])[0]['channel'], 'app')
        self.assertNotIn('x-request-id', TestClient(app).get('/').headers, 'pages are not API calls')

    def test_only_the_owner_sql_role_reads_it(self):
        with db.connect() as c:
            q = lambda role, obj, kind='table': c.execute(f"SELECT has_{kind}_privilege(%s, %s, 'SELECT') AS ok", (role, obj)).fetchone()['ok']
            for t in ('api_requests', 'admin_login_events', 'admin_account_days', 'admin_audit', 'owner_people', 'owner_app_sessions'):
                self.assertTrue(q('fit_all_readers', t), t); self.assertFalse(q('fit_readers', t), t)
            cols = {r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name IN ('owner_people', 'owner_app_sessions')").fetchall()}
            self.assertFalse(cols & {'pw_hash', 'token_hash', 'sql_role'}, 'no password or token hashes in the views')
            self.assertTrue(c.execute("SELECT relrowsecurity FROM pg_class WHERE relname = 'api_requests'").fetchone()['relrowsecurity'])


if __name__ == '__main__': unittest.main()
