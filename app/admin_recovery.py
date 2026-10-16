"""Offline operator recovery. Run interactively on the server; never through the public API."""
import sys
from . import db
from .admin_auth import audit

def main():
    if len(sys.argv)!=2 or not sys.stdin.isatty():raise SystemExit('Run interactively: python -m app.admin_recovery <admin-username>')
    login=sys.argv[1]
    if input('This removes MFA and signs the administrator out. Type the username to confirm: ')!=login:raise SystemExit('Cancelled.')
    with db.connect() as c:
        u=c.execute('SELECT id FROM users WHERE login=%s AND is_admin FOR UPDATE',(login,)).fetchone()
        if not u:raise SystemExit('Administrator not found. No roles changed.')
        for table in ['admin_sessions','admin_challenges','admin_recovery','admin_mfa','sessions']:
            c.execute(f'DELETE FROM {table} WHERE user_id=%s',(u['id'],))
        audit(c,u['id'],'mfa.offline_recovery',u['id'])
    print('MFA reset; sign in with the existing password and enroll a new authenticator. No role was changed.')
if __name__=='__main__':main()
