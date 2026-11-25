"""A content-free daily operator summary; configuration is not a live service probe."""
from . import admin_mail, ai_budget, ai_release, coach
from .admin_auth import mfa_required
from .admin_usage import KIT_BUDGET_KINDS


def snapshot(c):
    day = c.execute("SELECT (now() AT TIME ZONE 'UTC')::date AS day").fetchone()['day']
    counts = c.execute("""SELECT
        (SELECT count(*) FROM users WHERE created >= %(day)s::date AT TIME ZONE 'UTC'
          AND created < (%(day)s::date+1) AT TIME ZONE 'UTC') AS new_signups,
        (SELECT count(*) FROM users WHERE needs_email_confirm AND suspended_at IS NULL) AS unconfirmed,
        (SELECT count(*) FROM reports WHERE status='open') AS open_reports,
        (SELECT count(*) FROM ai_food_attempts WHERE day=%(day)s AND kind=ANY(%(kinds)s)
          AND state='measured') AS kit_requests""", {'day': day, 'kinds': list(KIT_BUDGET_KINDS)}).fetchone()
    failures = c.execute("""SELECT
        (SELECT count(*) FROM imports WHERE status='failed' AND created>=now()-interval '1 day') AS imports,
        (SELECT count(*) FROM connections WHERE status LIKE 'sync failed:%%') AS connections,
        (SELECT count(*) FROM admin_mail_events WHERE state IN ('failed','bounced')
          AND created>=now()-interval '1 day') AS email""").fetchone()
    backup = c.execute("""SELECT passed AND observed_at>=now()-interval '1 day' AS fresh
        FROM admin_readiness WHERE check_key='backup'""").fetchone()
    # Only booleans escape these helpers: sender addresses and provider keys never do.
    services = [
        {'key': 'database', 'label': 'Database', 'status': 'available', 'source': 'this request'},
        {'key': 'email', 'label': 'Email', 'status': 'configured' if admin_mail.settings()['ready'] else 'not_configured', 'source': 'configuration'},
        {'key': 'kit', 'label': 'Kit', 'status': 'configured' if coach.enabled() and ai_budget.enabled() and ai_release.enabled('kit') else 'disabled', 'source': 'configuration'},
        {'key': 'authenticator', 'label': 'Portal authenticator', 'status': 'required' if mfa_required() else 'disabled', 'source': 'configuration'},
        {'key': 'backup', 'label': 'Recent backup', 'status': 'verified' if backup and backup['fresh'] else 'needs_check', 'source': 'administrator evidence'},
    ]
    attention = []
    def add(key, label, count, severity, destination):
        if count:
            attention.append({'key': key, 'label': label, 'count': count, 'severity': severity, 'destination': destination})
    add('reports', 'Open reports', counts['open_reports'], 'red', 'reports')
    add('email_failures', 'Email delivery failures in the past 24 hours', failures['email'], 'red', 'readiness')
    add('imports', 'Failed imports in the past 24 hours', failures['imports'], 'amber', 'people?issue=imports')
    add('connections', 'Failed connections', failures['connections'], 'amber', 'people?issue=connections')
    add('unconfirmed', 'Unconfirmed accounts', counts['unconfirmed'], 'amber', 'people?status=unconfirmed')
    for row in services:
        if row['key'] in ('email', 'authenticator', 'backup') and row['status'] in ('not_configured', 'disabled', 'needs_check'):
            add(row['key'], row['label'], 1, 'red' if row['key']=='authenticator' else 'amber', 'readiness')
    return {'day': day, 'zone': 'UTC', 'counts': counts, 'needs_attention': attention[:15], 'services': services}
