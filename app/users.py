"""Manage accounts from the server (passwords are typed in, never on the command line, never printed):
  python -m app.users list
  python -m app.users add <login> "<Name>"
  python -m app.users password <login>        app password
  python -m app.users sql-login <login>       create/reset that person's read-only SQL login <login>_sql
                                              (sees only that person's rows)
  python -m app.users sql-login <login> --all-people
                                              admins only: the SQL login reads EVERYONE's rows. Tell the people
                                              on your server before you turn this on.
Usually you don't need this: the first person creates their account in the browser and invites everyone else.
"""
import sys, getpass
from psycopg import sql
from . import db, auth

def ask(prompt):
    p1 = getpass.getpass(prompt); p2 = getpass.getpass('Again: ')
    if p1 != p2: sys.exit('passwords differ - nothing changed')
    if len(p1) < 8: sys.exit('use at least 8 characters - nothing changed')
    return p1

def main(a):
    db.migrate()
    with db.connect() as c:
        if not a or a[0] == 'list':
            for r in c.execute('SELECT login::text AS login, name, pw_hash IS NOT NULL AS has_pw, sql_role FROM users ORDER BY id'):
                print(f"{r['login']:12} {r['name']:16} {'password set' if r['has_pw'] else 'NO PASSWORD YET':16} SQL: {r['sql_role'] or '-'}")
        elif a[0] == 'add' and len(a) == 3:
            uid = c.execute('INSERT INTO users (login, name) VALUES (%s, %s) RETURNING id', (a[1], a[2])).fetchone()['id']
            c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))
            print(f'added {a[1]} - now set a password: python -m app.users password {a[1]}')
        elif a[0] == 'password' and len(a) == 2:
            if not c.execute('SELECT 1 FROM users WHERE login = %s', (a[1],)).fetchone(): sys.exit(f'no user {a[1]}')
            pw = ask(f'New app password for {a[1]}: ')
            c.execute('UPDATE users SET pw_hash = %s WHERE login = %s', (auth.hash_pw(pw), a[1]))
            c.execute('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = %s)', (a[1],))
            print('password set (other logins for this person were signed out)')
        elif a[0] == 'sql-login' and len(a) in (2, 3) and a[2:] in ([], ['--all-people']):
            u = c.execute('SELECT id, login::text AS login, is_admin FROM users WHERE login = %s', (a[1],)).fetchone()
            if not u: sys.exit(f'no user {a[1]}')
            role = f"{u['login'].lower()}_sql"
            if not role.replace('_', '').isalnum(): sys.exit('login must be letters/numbers only')
            pw = ask(f'Password for SQL login {role}: ')
            exists = c.execute('SELECT 1 FROM pg_roles WHERE rolname = %s', (role,)).fetchone()
            verb = 'ALTER' if exists else 'CREATE'
            c.execute(sql.SQL(verb + ' ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role), sql.Literal(pw)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            everyone = a[2:] == ['--all-people']
            if everyone and not u['is_admin']: sys.exit('--all-people is only for admins - nothing changed')
            c.execute(sql.SQL(('GRANT fit_all_readers TO {}' if everyone else 'REVOKE fit_all_readers FROM {}')).format(sql.Identifier(role)))
            c.execute(sql.SQL('ALTER ROLE {} SET default_transaction_read_only = on').format(sql.Identifier(role)))
            c.execute('UPDATE users SET sql_role = %s WHERE id = %s', (role, u['id']))
            who = "everyone's rows" if everyone else f"only {u['login']}'s rows"
            print(f'SQL login {role} ready (read-only, sees {who}). Database "fit".')
        else:
            sys.exit(__doc__)

if __name__ == '__main__':
    main(sys.argv[1:])
