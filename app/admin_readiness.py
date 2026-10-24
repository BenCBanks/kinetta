"""Operator evidence is an explicit dated attestation, never a fabricated backup/email probe."""
import datetime as dt
import os
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import StrictBool
from . import db, admin_mail, signup
from .admin_auth import admin_user, cipher, mfa_required
from .admin_actions import ActionIn, replay, complete

router = APIRouter(prefix='/api/admin')
# Freshness is about when the evidence happened, not when someone clicked Save.
CHECKS = {
    'email_delivery': ('Email delivery', 7, 'Verify a delivered confirmation/reset message and its signed provider event.'),
    'support_mailbox': ('Support mailbox', 7, 'Check that a reply reaches the monitored support mailbox.'),
    'backup': ('Recent backup', 1, 'Verify the latest completed backup; do not enter paths, keys or contents here.'),
    'restore': ('Isolated restore drill', 30, 'Restore a backup into an isolated test copy and verify account/data recovery.'),
    'rollback': ('Release and rollback', 7, 'Check the candidate version and a documented way to return to the prior release.'),
    'capacity': ('Capacity and failure handling', 30, 'Check the planned account cap, latency, failure/retry behavior and monitoring.'),
    'moderation': ('Report triage and support', 7, 'Assign someone to check reports and support requests daily.'),
    'device': ('iPhone and connected sources', 30, 'Record the installed-build and real-device/provider acceptance privately.'),
}


def snapshot(c):
    now = dt.datetime.now(dt.timezone.utc)
    rows = []
    def add(key, title, ok, explanation, action='readiness'):
        rows.append({'key': key, 'title': title, 'status': 'verified' if ok else 'attention', 'source': 'configuration',
                     'checked_at': now, 'recorded_at': None, 'by': None, 'detail': explanation, 'action': action, 'manual': False})
    add('mfa', 'Portal authenticator', mfa_required(), 'Authenticator required.' if mfa_required() else 'Password-only mode is on. Enable the portal authenticator.')
    try: cipher(); key_ok = True
    except HTTPException: key_ok = False
    add('encryption', 'Admin encryption key', key_ok, 'A usable key is configured; recovery of that key still needs a restore drill.' if key_ok else 'Configure a valid admin encryption key.')
    state = signup.state(c)
    add('signup', 'Sign-up and account cap', state['mode'] != 'open' or state['cap'] is not None,
        f"Mode: {state['mode']}; " + (f"{state['accounts']} of {state['cap']} places." if state['cap'] is not None else 'no account cap configured.'))
    mail = admin_mail.settings()
    add('mail_config', 'Email configuration', mail['ready'], 'Sender, reply-to, key and webhook are configured. Delivery is a separate check.' if mail['ready'] else 'Email configuration is incomplete.')
    evidence = {r['check_key']: r for r in c.execute('SELECT e.*,u.name AS by FROM admin_readiness e LEFT JOIN users u ON u.id=e.actor_id').fetchall()}
    for key, (title, days, detail) in CHECKS.items():
        e = evidence.get(key)
        fresh = e and e['observed_at'] >= now - dt.timedelta(days=days)
        status = 'not_checked' if not e else 'verified' if fresh and e['passed'] else 'attention'
        if e and key in ('email_delivery', 'support_mailbox') and not mail['ready']: status = 'attention'
        rows.append({'key': key, 'title': title, 'status': status, 'source': 'administrator evidence',
                     'checked_at': e['observed_at'] if e else None, 'recorded_at': e['recorded_at'] if e else None,
                     'by': e['by'] if e else None, 'detail': ('Evidence is out of date. ' if e and not fresh else '') + detail,
                     'action': 'readiness', 'manual': True, 'fresh_days': days})
    return {'checks': rows, 'at': now, 'version': os.environ.get('KINETTA_VERSION', 'Not supplied'),
            'counts': {s: sum(r['status'] == s for r in rows) for s in ('verified', 'attention', 'not_checked')}}


@router.get('/readiness')
def readiness(user=Depends(admin_user)):
    with db.connect() as c: return snapshot(c)


class EvidenceIn(ActionIn):
    passed: StrictBool
    observed_at: dt.datetime
    confirmed: StrictBool


@router.post('/readiness/{key}')
def evidence(key: str, body: EvidenceIn, user=Depends(admin_user)):
    if key not in CHECKS: raise HTTPException(404, 'Unknown check.')
    if not body.confirmed: raise HTTPException(400, 'Confirm that you checked the evidence yourself.')
    now = dt.datetime.now(dt.timezone.utc)
    if not body.observed_at.tzinfo or not now - dt.timedelta(days=365) <= body.observed_at <= now + dt.timedelta(minutes=5):
        raise HTTPException(400, 'Enter when the check actually happened, within the past year.')
    with db.connect() as c:
        digest, old = replay(c, user, body, 'readiness.record', key)
        if old: return old
        c.execute('''INSERT INTO admin_readiness(check_key,passed,observed_at,actor_id) VALUES (%s,%s,%s,%s)
                     ON CONFLICT(check_key) DO UPDATE SET passed=excluded.passed,observed_at=excluded.observed_at,
                     actor_id=excluded.actor_id,recorded_at=now()''', (key, body.passed, body.observed_at, user['id']))
        return complete(c, user, body, 'readiness.record', key, digest)
