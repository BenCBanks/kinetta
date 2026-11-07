"""Contact matching contracts with a fake database: no real accounts, addresses, or contact book."""
import hashlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path.cwd()))

from fastapi.testclient import TestClient
from app import api_contacts, request_log
from app.main import app


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, state=None, candidates=None):
        self.state = dict(state or {'phone_e164': None, 'email_ready': True, 'find_by_email': True, 'find_by_phone': True})
        self.candidates = candidates or []
        self.calls = []

    def execute(self, query, params=()):
        self.calls.append((query, params))
        if 'WITH phone_counts AS' in query:
            return FakeResult(rows=self.candidates)
        if 'SELECT u.phone_e164' in query:
            return FakeResult(row=dict(self.state))
        if query.startswith('UPDATE users SET phone_e164='):
            self.state['phone_e164'] = params[0]
        elif query.startswith('UPDATE profile SET '):
            import re
            fields = re.findall(r'(find_by_email|find_by_phone)=%s', query)
            for field, value in zip(fields, params[:-1]):
                self.state[field] = value
        return FakeResult()


class FakeContext:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self.connection

    def __exit__(self, *args):
        return False


class Contacts(unittest.TestCase):
    def setUp(self):
        self.uid = 101
        self.db = FakeConnection()
        self.limit_hit = False
        self.limit_args = []
        self.routes = []
        self.override_before = app.dependency_overrides.get(api_contacts.current_user)
        app.dependency_overrides[api_contacts.current_user] = lambda: {'id': self.uid}
        self.addCleanup(self._restore_override)
        self.connect = patch.object(api_contacts.db, 'connect', side_effect=lambda: FakeContext(self.db))
        self.connect.start(); self.addCleanup(self.connect.stop)
        def limited(_c, key, most, minutes):
            self.limit_args.append((key, most, minutes))
            return self.limit_hit
        self.limit = patch.object(api_contacts.account_email, 'limited', side_effect=limited)
        self.limit.start(); self.addCleanup(self.limit.stop)
        self.original_record = request_log.record
        self.log = patch('app.main.request_log.record', side_effect=lambda req, *_: self.routes.append(request_log.route(req)))
        self.log.start(); self.addCleanup(self.log.stop)
        self.client = TestClient(app)

    def _restore_override(self):
        if self.override_before is None:
            app.dependency_overrides.pop(api_contacts.current_user, None)
        else:
            app.dependency_overrides[api_contacts.current_user] = self.override_before

    def test_phone_normalizes_to_e164_and_rejects_missing_country_code(self):
        self.assertEqual(api_contacts.normalize_phone(' +1 (555) 010-1234 '), '+15550101234')
        self.assertIsNone(api_contacts.normalize_phone('  '))
        with self.assertRaises(Exception):
            api_contacts.normalize_phone('555 010 1234')

    def test_hash_is_salted_and_domain_separated(self):
        one = api_contacts.contact_digest('a' * 43, 'email', 'friend@example.test')
        self.assertEqual(one, hashlib.sha256(('a' * 43 + ':email:friend@example.test').encode()).hexdigest())
        self.assertNotEqual(one, api_contacts.contact_digest('b' * 43, 'email', 'friend@example.test'))
        self.assertNotEqual(one, api_contacts.contact_digest('a' * 43, 'phone', 'friend@example.test'))

    def test_settings_are_account_scoped_and_phone_is_normalized_or_cleared(self):
        initial = self.client.get('/api/contacts/settings')
        self.assertEqual(initial.json(), {'phone_e164': None, 'email_ready': True, 'find_by_email': True, 'find_by_phone': True})
        saved = self.client.put('/api/contacts/settings', json={'phone_e164': '+1 (555) 010-1234', 'find_by_email': False})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['phone_e164'], '+15550101234')
        self.assertFalse(saved.json()['find_by_email'])
        scoped = [(q, p) for q, p in self.db.calls if q.startswith('UPDATE users') or q.startswith('UPDATE profile')]
        self.assertTrue(scoped)
        self.assertTrue(all('WHERE id=%s' in q or 'WHERE user_id=%s' in q for q, _ in scoped))
        cleared = self.client.put('/api/contacts/settings', json={'phone_e164': None})
        self.assertEqual(cleared.json()['phone_e164'], None)
        bad = self.client.put('/api/contacts/settings', json={'phone_e164': '555 010 1234'})
        self.assertEqual(bad.status_code, 400)
        self.assertNotIn('555 010 1234', bad.text)

    def test_match_returns_only_matched_hash_pairs_and_does_not_store_hashes(self):
        self.db.candidates = [
            {'id': 202, 'email': 'friend@example.test', 'phone_e164': '+15550101234'},
            {'id': 303, 'email': None, 'phone_e164': None},  # duplicate phone claim was filtered in SQL
        ]
        salt = 'a' * 43
        email_hash = api_contacts.contact_digest(salt, 'email', 'friend@example.test')
        phone_hash = api_contacts.contact_digest(salt, 'phone', '+15550101234')
        unmatched_hash = api_contacts.contact_digest(salt, 'email', 'not-a-member@example.test')
        response = self.client.post('/api/contacts/match', json={
            'salt': salt, 'hashes': [
                {'kind': 'email', 'digest': email_hash}, {'kind': 'phone', 'digest': phone_hash},
                {'kind': 'email', 'digest': unmatched_hash}, {'kind': 'email', 'digest': email_hash},
            ],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'matches': [
            {'hash': digest, 'member_id': 202} for digest in sorted((email_hash, phone_hash))
        ]})  # duplicate submissions collapse; both matched fields map to the same member
        self.assertNotIn('friend@example.test', response.text)
        self.assertNotIn(unmatched_hash, response.text)
        self.assertTrue(all(set(match) == {'hash', 'member_id'} for match in response.json()['matches']))
        self.assertEqual(self.limit_args, [('contacts-check:101', 1, 1440)])
        query, params = next((q, p) for q, p in self.db.calls if 'WITH phone_counts AS' in q)
        self.assertIn('count(*) AS n FROM users WHERE phone_e164 IS NOT NULL', query)
        self.assertIn('pc.n=1', query)
        self.assertIn('u.id<>%s', query)
        self.assertIn('NOT EXISTS (SELECT 1 FROM blocks', query)
        self.assertEqual(params, (101, 101, 101))  # owner IDs only; hashes never enter SQL parameters or persistent rows
        self.assertEqual(self.routes[-1], '/api/contacts/match')

    def test_daily_limit_and_validation_errors_do_not_echo_request_values(self):
        self.limit_hit = True
        salt = 'a' * 43
        digest = 'b' * 64
        limited = self.client.post('/api/contacts/match', json={'salt': salt, 'hashes': [{'kind': 'email', 'digest': digest}]})
        self.assertEqual(limited.status_code, 429)
        self.assertFalse(any('WITH phone_counts AS' in q for q, _ in self.db.calls))
        too_many = self.client.post('/api/contacts/match', json={'salt': salt, 'hashes': [{'kind': 'email', 'digest': digest}] * 2001})
        self.assertEqual(too_many.status_code, 422)
        self.assertNotIn(digest, too_many.text)
        extra = self.client.post('/api/contacts/match', json={'salt': salt, 'hashes': [], 'names': ['Fictional Contact']})
        self.assertEqual(extra.status_code, 422)
        self.assertNotIn('Fictional Contact', extra.text)

    def test_invalid_match_body_does_not_use_the_daily_check(self):
        bad = self.client.post('/api/contacts/match', json={'salt': 'short', 'hashes': []})
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(self.limit_args, [])
        valid = self.client.post('/api/contacts/match', json={
            'salt': 'a' * 43, 'hashes': [{'kind': 'email', 'digest': 'b' * 64}],
        })
        self.assertEqual(valid.status_code, 200, valid.text)
        self.assertEqual(valid.json(), {'matches': []})
        self.assertEqual(self.limit_args, [('contacts-check:101', 1, 1440)])

    def test_request_log_keeps_route_metadata_without_body_fields(self):
        rows = []
        class Loop:
            def run_in_executor(self, _executor, _function, row):
                rows.append(row)
        request = SimpleNamespace(method='POST', scope={'route': SimpleNamespace(path='/api/contacts/match')},
                                  state=SimpleNamespace(user_id=self.uid), headers={'authorization': 'Bearer fictional'},
                                  url=SimpleNamespace(path='/api/contacts/match'))
        with patch('app.request_log.asyncio.get_running_loop', return_value=Loop()):
            self.original_record(request, 200, 1, 'fictional-request-id')
        self.assertEqual(rows[0]['route'], '/api/contacts/match')
        self.assertEqual(set(rows[0]), {'user_id', 'method', 'route', 'status', 'duration_ms', 'channel', 'request_id'})


if __name__ == '__main__':
    unittest.main()
