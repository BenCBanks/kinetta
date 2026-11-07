"""Contact discovery suppresses either direction of a block, using fictional disposable accounts."""
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import api_contacts, auth, db
from app.main import app


class ContactBlocks(unittest.TestCase):
    def setUp(self):
        suffix = uuid.uuid4().hex[:8]
        self.owner_login = f'zz_test_contacts_a_{suffix}'
        self.peer_login = f'zz_test_contacts_b_{suffix}'
        with db.connect() as c:
            self.owner = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                                   (self.owner_login, 'Fictional contact A', auth.hash_pw('fictional contact fixture'))).fetchone()['id']
            self.peer = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                                  (self.peer_login, 'Fictional contact B', auth.hash_pw('fictional contact fixture'))).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (self.owner,))
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (self.peer,))
            c.execute('UPDATE users SET phone_e164=%s WHERE id=%s', ('+15550101102', self.peer))
        self.override_before = app.dependency_overrides.get(api_contacts.current_user)
        app.dependency_overrides[api_contacts.current_user] = lambda: {'id': self.owner}
        self.client = TestClient(app)
        self.limit = patch.object(api_contacts.account_email, 'limited', return_value=False)
        self.limit.start()

    def tearDown(self):
        self.client.close()
        self.limit.stop()
        if self.override_before is None:
            app.dependency_overrides.pop(api_contacts.current_user, None)
        else:
            app.dependency_overrides[api_contacts.current_user] = self.override_before
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id = ANY(%s)', ([self.owner, self.peer],))

    def _match(self, salt):
        digest = api_contacts.contact_digest(salt, 'phone', '+15550101102')
        response = self.client.post('/api/contacts/match', json={
            'salt': salt, 'hashes': [{'kind': 'phone', 'digest': digest}],
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['matches']

    def test_a_blocking_b_or_b_blocking_a_hides_the_match(self):
        salt = self.client.get('/api/contacts/salt').json()['salt']
        expected_hash = api_contacts.contact_digest(salt, 'phone', '+15550101102')
        self.assertEqual(self._match(salt), [{'hash': expected_hash, 'member_id': self.peer}], 'an unblocked phone matches')
        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.owner, self.peer))
        self.assertEqual(self._match(salt), [], 'A blocks B')
        with db.connect() as c:
            c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s', (self.owner, self.peer))
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.peer, self.owner))
        self.assertEqual(self._match(salt), [], 'B blocks A')


if __name__ == '__main__':
    unittest.main()
