"""Opt-in reviewer demo integration on a marked, disposable journeys deployment only.

Seed fictional `alex` on that deployment first, then run with an exact confirmation, for example:
python3 dev/tests/test_reviewer_integration.py --url http://127.0.0.1:8798 \
  --project kt-reviewer-demo \
  --confirm 'RUN FICTIONAL REVIEWER TEST ON http://127.0.0.1:8798 PROJECT kt-reviewer-demo'
"""
import argparse
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'dev/tests'))
sys.path.insert(0, str(ROOT / 'dev/demo'))

from dev.portal_fixture import admin_headers
from journeys_guard import target as guard_target
import reviewer


def expected_confirmation(base, project):
    return f'RUN FICTIONAL REVIEWER TEST ON {base} PROJECT {project}'


class CreatedAccounts:
    """Track only successful account-creation responses for finally cleanup."""
    def __init__(self, api):
        self.api = api
        self.created = []

    def get(self, path):
        return self.api.get(path)

    def post(self, path, body=None):
        result = self.api.post(path, body)
        if path == '/api/admin/people' and result.get('ok') and isinstance(body, dict) and body.get('login'):
            self.created.append(body['login'])
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--confirm', required=True)
    args = parser.parse_args(argv)
    base = args.url.rstrip('/')
    if args.confirm != expected_confirmation(base, args.project):
        print('Stopped: exact isolated-test confirmation did not match. No credentials or requests were made.')
        return 1

    # This validates checkout, Compose project/services, loopback port, fixture marker and volumes
    # before the admin fixture can prompt or any application endpoint is contacted.
    try:
        guard_target(base, args.project)
    except Exception:
        print('Stopped: target is not this checkout’s marked disposable journeys deployment.')
        return 1

    parsed = urlsplit(base)
    if parsed.port is None or parsed.port < 8798:
        print('Stopped: reviewer integration requires the isolated test port >=8798.')
        return 1

    # kc.py reads KINETTA_URL at import time; it contains only the fictional CI/demo login.
    os.environ['KINETTA_URL'] = base
    from kc import ALEX, PW, login

    reviewer_name = 'zz_test_review_' + uuid.uuid4().hex[:8]
    friend_name = reviewer_name + '_friend'
    headers = admin_headers(base)  # Existing MFA session state is stored privately with mode 0600.
    admin_api = reviewer.API(base)
    admin_api.opener.addheaders = list(headers.items())
    admin_api.csrf = headers['X-Admin-CSRF']
    admin = CreatedAccounts(admin_api)
    clients = []

    def api_factory(origin):
        client = reviewer.API(origin)
        clients.append(client)
        return client

    ordinary_admin = login(*ALEX)
    before = ordinary_admin.get('/api/me')[1]
    try:
        reviewer.seed(admin, base, reviewer_name, friend_name, PW, api_factory=api_factory)
        person, pal = clients
        activities = person.get('/api/activities?limit=100')
        assert len(activities) == 8
        assert all(row['visibility'] == 'me' for row in activities)
        assert len(person.get('/api/heatmap')) == 8
        assert person.get('/api/food/insights?days=30')['summary']['logged'] == 13
        assert len(person.get('/api/dishes')) == 1
        assert len(person.get('/api/friends')['friends']) == 1
        friend_activities = pal.get('/api/activities?limit=100')
        assert len(friend_activities) == 1 and friend_activities[0]['visibility'] == 'friends'
        try:
            reviewer.seed(admin, base, reviewer_name, friend_name, PW, api_factory=api_factory)
        except reviewer.Refused:
            pass
        else:
            raise AssertionError('An existing reviewer family was reused')
        assert len(person.get('/api/activities?limit=100')) == 8
        assert len(person.get('/api/dishes')) == 1
        assert ordinary_admin.get('/api/me')[1] == before, 'The demo administrator profile changed'
    finally:
        cleanup_failed = False
        for login_name in reversed(admin.created):
            try:
                if not admin.post(f'/api/admin/people/{login_name}/remove', {'confirm': login_name}).get('ok'):
                    cleanup_failed = True
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            raise RuntimeError('Authenticated cleanup failed for a newly created fictional test account') from None
    print('Guarded fictional reviewer integration and authenticated cleanup PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
