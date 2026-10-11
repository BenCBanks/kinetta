"""Runs once before the database starts (service `firstrun` in docker-compose.yml): makes up the two database
passwords and keeps them in the `secrets` volume, so nobody has to invent or type them. Safe to run again: existing
passwords are never changed."""
import os
import secrets

DIR = os.environ.get('KINETTA_SECRETS', '/run/kinetta')

for name in ('db_password', 'app_password'):
    path = os.path.join(DIR, name)
    if os.path.exists(path) and os.path.getsize(path):
        continue
    with open(path, 'w') as f:
        f.write(secrets.token_hex(24))      # letters + digits only: safe inside SQL quotes and connection strings
    os.chmod(path, 0o644)                   # readable by the database container's own user; the volume is private to Kinetta
    print(f'created {name}')
print('passwords ready')
