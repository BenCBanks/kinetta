#!/bin/sh
# Older installs only (Docker installs from docker-compose.yml don't use this; the app creates the same logins itself,
# see db.ROLES_SQL). Runs once, when the database is first created. fit_app = the app's own login (owns the tables, can
# create the per-person read-only SQL logins). fit_readers = group for those logins; what they may see is set per table.
set -e
[ -z "$FIT_APP_PASSWORD" ] && [ -n "$FIT_APP_PASSWORD_FILE" ] && FIT_APP_PASSWORD=$(cat "$FIT_APP_PASSWORD_FILE")
[ -z "$FIT_APP_PASSWORD" ] && { echo "01-roles.sh: no FIT_APP_PASSWORD - the app will create its login on first start"; exit 0; }
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE fit_app LOGIN CREATEROLE PASSWORD '$FIT_APP_PASSWORD';
CREATE ROLE fit_readers NOLOGIN;
GRANT fit_readers TO fit_app WITH ADMIN OPTION;
ALTER DATABASE $POSTGRES_DB OWNER TO fit_app;
ALTER SCHEMA public OWNER TO fit_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO fit_readers;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
