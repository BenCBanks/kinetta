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
        self.peer_email = f'{self.peer_login}@example.test'
        self.peer_phone = '+1555' + f'{int(suffix, 16) % 10_000_000:07d}'
        with db.connect() as c:
            self.owner = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                                   (self.owner_login, 'Fictional contact A', auth.hash_pw('fictional contact fixture'))).fetchone()['id']
            self.peer = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                                  (self.peer_login, 'Fictional contact B', auth.hash_pw('fictional contact fixture'))).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (self.owner,))
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (self.peer,))
            c.execute('UPDATE users SET email=%s,email_verified_at=now(),phone_e164=%s WHERE id=%s',
                      (self.peer_email, self.peer_phone, self.peer))
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

    def _match(self, salt, kind='phone'):
        value = self.peer_phone if kind == 'phone' else self.peer_email
        digest = api_contacts.contact_digest(salt, kind, value)
        response = self.client.post('/api/contacts/match', json={
            'salt': salt, 'hashes': [{'kind': kind, 'digest': digest}],
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['matches']

    def test_a_blocking_b_or_b_blocking_a_hides_the_match(self):
        salt = self.client.get('/api/contacts/salt').json()['salt']
        expected_hash = api_contacts.contact_digest(salt, 'phone', self.peer_phone)
        self.assertEqual(self._match(salt), [{'hash': expected_hash, 'login': self.peer_login}], 'an unblocked phone matches')
        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.owner, self.peer))
        self.assertEqual(self._match(salt), [], 'A blocks B')
        with db.connect() as c:
            c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s', (self.owner, self.peer))
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.peer, self.owner))
        self.assertEqual(self._match(salt), [], 'B blocks A')

    def test_email_and_phone_opt_outs_hide_the_submitted_hashes(self):
        salt = self.client.get('/api/contacts/salt').json()['salt']
        email_hash = api_contacts.contact_digest(salt, 'email', self.peer_email)
        phone_hash = api_contacts.contact_digest(salt, 'phone', self.peer_phone)
        self.assertEqual(self._match(salt, 'email'), [{'hash': email_hash, 'login': self.peer_login}])
        self.assertEqual(self._match(salt, 'phone'), [{'hash': phone_hash, 'login': self.peer_login}])

        with db.connect() as c:
            c.execute('UPDATE profile SET find_by_email=false WHERE user_id=%s', (self.peer,))
        self.assertEqual(self._match(salt, 'email'), [], 'email opt-out hides a submitted matching hash')
        self.assertEqual(self._match(salt, 'phone'), [{'hash': phone_hash, 'login': self.peer_login}],
                         'phone matching remains available when only email discovery is off')

        with db.connect() as c:
            c.execute('UPDATE profile SET find_by_email=true,find_by_phone=false WHERE user_id=%s', (self.peer,))
        self.assertEqual(self._match(salt, 'phone'), [], 'phone opt-out hides a submitted matching hash')


if __name__ == '__main__':
    unittest.main()
