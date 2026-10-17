"""PostgreSQL (+PostGIS) storage. Schema changes are numbered MIGRATIONS, applied in order and recorded in schema_version.

Privacy, two layers:
 - the app only ever reads/writes rows WHERE user_id = <the logged-in person> (see auth.current_user);
 - optional read-only SQL logins for people (`python -m app.users sql-login <login>`) are members of fit_readers, and
   every personal table has row-level security: they see only their own rows (fit_me()).
   A new personal table MUST: ENABLE ROW LEVEL SECURITY, add the `own_rows` policy, GRANT SELECT TO fit_readers.
"""
import os
from contextlib import contextmanager
from zoneinfo import ZoneInfo
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def secret(name):
    """A setting from the environment, or from the file named by <name>_FILE (how docker-compose.yml passes the
    passwords it generates on first start)."""
    v = os.environ.get(name)
    if v: return v
    f = os.environ.get(name + '_FILE')
    if f and os.path.exists(f):
        with open(f) as fh: return fh.read().strip()
    return ''


def _tz(v):
    try: return ZoneInfo(v).key if v else None
    except Exception: return None


# Time zone for new people until their phone tells us theirs (set at sign-up, changeable under Me > Settings).
DEFAULT_TZ = _tz(os.environ.get('KINETTA_TZ')) or _tz(os.environ.get('TZ')) or 'UTC'
valid_tz = _tz

def _conninfo(user, password):
    from psycopg.conninfo import make_conninfo
    return make_conninfo(host=os.environ.get('FIT_DB_HOST', 'fit-db'), port=os.environ.get('FIT_DB_PORT', '5432'), dbname='fit',
                         user=user, password=password, application_name='kinetta')


CONNINFO = _conninfo('fit_app', secret('FIT_APP_PASSWORD'))
_pool = None

# The database's own logins. Docker installs (docker-compose.yml) let the app set these up on first start, using the
# superuser password from the secrets volume; older installs ran db-init/01-roles.sh instead (same SQL).
ROLES_SQL = """
CREATE ROLE fit_app LOGIN CREATEROLE PASSWORD {pw};
CREATE ROLE fit_readers NOLOGIN;
GRANT fit_readers TO fit_app WITH ADMIN OPTION;
ALTER DATABASE fit OWNER TO fit_app;
ALTER SCHEMA public OWNER TO fit_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO fit_readers;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
"""


def bootstrap():
    """First start of a Docker install: create the app's database login if it doesn't exist yet."""
    su_pw = secret('POSTGRES_PASSWORD')
    if not su_pw: return
    import psycopg
    with psycopg.connect(_conninfo('postgres', su_pw), autocommit=True) as c:
        if c.execute("SELECT 1 FROM pg_roles WHERE rolname = 'fit_app'").fetchone(): return
        with c.transaction():
            c.execute(sql.SQL(ROLES_SQL).format(pw=sql.Literal(secret('FIT_APP_PASSWORD'))))
        print('database logins created')


def pool():
    global _pool
    if _pool is None:
        _pool = ConnectionPool(CONNINFO, min_size=1, max_size=8, kwargs={'row_factory': dict_row}, open=True)
    return _pool


@contextmanager
def connect():
    """One transaction: committed when the block ends, rolled back on error."""
    with pool().connection() as c:
        yield c


@contextmanager
def coach_scope(c, user_id):
    """Restrict deterministic reads on an existing transaction, including confirmation validation.

    A savepoint restores role/settings on failure. It also avoids borrowing a second pooled connection while
    holding a confirmation lock, which could otherwise exhaust the pool under concurrent retries.
    """
    if type(user_id) is not int or user_id <= 0: raise ValueError('Authenticated account required')
    with c.transaction():
        before = c.execute("SELECT current_user AS role, current_setting('kinetta.coach_user_id', true) AS uid").fetchone()
        c.execute('SET LOCAL ROLE fit_coach')
        c.execute("SELECT set_config('kinetta.coach_user_id', %s, true)", (str(user_id),))
        yield c
        c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(before['role'])))
        c.execute("SELECT set_config('kinetta.coach_user_id', %s, true)", (before['uid'] or '',))


@contextmanager
def coach_connect(user_id):
    """Trusted application identity, never a model argument. Transaction-local role, RLS and read-only mode.

    The restricted role has no membership in the SQL admin/read-all role. LOCAL settings disappear before
    the pooled connection is reused; a tool cannot change identity, execute arbitrary SQL or write rows.
    """
    if type(user_id) is not int or user_id <= 0: raise ValueError('Authenticated account required')
    with pool().connection() as c:
        with c.transaction():
            c.execute('SET TRANSACTION READ ONLY')
            c.execute("SET LOCAL statement_timeout = '3s'")
            with coach_scope(c, user_id): yield c


MIGRATIONS = [
    # 1: accounts, login sessions, per-person settings; the fit_me() helper used by row-level security
    """
    CREATE TABLE users (
      id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      login     citext NOT NULL UNIQUE,
      name      text NOT NULL,
      pw_hash   text,
      sql_role  text UNIQUE,
      created   timestamptz NOT NULL DEFAULT now());
    CREATE TABLE sessions (
      token_hash text PRIMARY KEY,
      user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created    timestamptz NOT NULL DEFAULT now(),
      last_seen  timestamptz NOT NULL DEFAULT now(),
      agent      text);
    CREATE TABLE profile (
      user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      units   text NOT NULL DEFAULT 'imperial' CHECK (units IN ('imperial', 'metric')),
      tz      text NOT NULL DEFAULT 'America/New_York');

    -- the person behind the current SQL login (NULL for the app itself)
    CREATE FUNCTION fit_me() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT id FROM users WHERE sql_role = current_user $$;
    GRANT EXECUTE ON FUNCTION fit_me() TO fit_readers;

    GRANT SELECT (id, login, name, created) ON users TO fit_readers;
    ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON profile FOR SELECT TO fit_readers USING (user_id = fit_me());
    GRANT SELECT ON profile TO fit_readers;
    """,
    # 2: fit_me() runs as its owner, so it must look at session_user (the person who logged in), not current_user
    """
    CREATE OR REPLACE FUNCTION fit_me() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $$ SELECT id FROM users WHERE sql_role = session_user $$;
    """,
    # 3: activities (runs, rides, walks...), their recorded streams, best efforts, matched routes, gear, import jobs
    """
    ALTER TABLE profile ADD COLUMN max_hr int, ADD COLUMN rest_hr int, ADD COLUMN sex text, ADD COLUMN birth_year int,
      ADD COLUMN weight_kg real;

    CREATE TABLE gear (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'shoe' CHECK (kind IN ('shoe', 'bike', 'other')),
      name text NOT NULL, brand text, model text, notes text,
      start_distance_m real NOT NULL DEFAULT 0, alert_distance_m real,
      retired boolean NOT NULL DEFAULT false, is_default boolean NOT NULL DEFAULT false,
      created timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, name));

    CREATE TABLE routes (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sport text NOT NULL, name text NOT NULL, renamed boolean NOT NULL DEFAULT false,
      created timestamptz NOT NULL DEFAULT now());

    CREATE TABLE activities (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sport text NOT NULL, sub_sport text, name text NOT NULL, auto_name boolean NOT NULL DEFAULT true,
      description text, private_note text, commute boolean NOT NULL DEFAULT false,
      start_time timestamptz NOT NULL, tz text NOT NULL DEFAULT 'America/New_York',
      elapsed_s real, moving_s real, distance_m real, ascent_m real, descent_m real,
      avg_hr real, max_hr real, avg_cad real, avg_power real, max_power real, max_speed real, avg_temp real, calories real,
      avg_vo real, avg_gct real, avg_stride real,
      gap_s_per_km real, effort real, decoupling real, vo2max real,
      zones jsonb, laps jsonb, splits_km jsonb, splits_mi jsonb, power_curve jsonb, chart jsonb,
      device text, source text NOT NULL, source_id text, file_sha256 text, file_path text, strava_id bigint,
      gear_id bigint REFERENCES gear(id) ON DELETE SET NULL,
      route_id bigint REFERENCES routes(id) ON DELETE SET NULL,
      geom geometry(LineString, 4326), start_pt geography(Point, 4326), end_pt geography(Point, 4326),
      ai_note text, ai_note_at timestamptz,
      created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, file_sha256));
    CREATE INDEX activities_user_time ON activities (user_id, start_time DESC);
    CREATE INDEX activities_start_pt ON activities USING gist (start_pt);
    CREATE INDEX activities_route ON activities (route_id);

    CREATE TABLE activity_streams (
      activity_id bigint PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      t float8[], lat float8[], lon float8[], alt float8[], dist float8[], hr float8[], cad float8[], power float8[],
      speed float8[], temp float8[], vo float8[], gct float8[], stride float8[]);

    CREATE TABLE best_efforts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      sport text NOT NULL, distance_m real NOT NULL, label text NOT NULL,
      elapsed_s real NOT NULL, start_s real, start_time timestamptz NOT NULL);
    CREATE INDEX best_efforts_lookup ON best_efforts (user_id, sport, distance_m, elapsed_s);

    CREATE TABLE imports (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label text NOT NULL, status text NOT NULL DEFAULT 'queued',
      total int NOT NULL DEFAULT 0, done int NOT NULL DEFAULT 0, added int NOT NULL DEFAULT 0,
      duplicates int NOT NULL DEFAULT 0, failed int NOT NULL DEFAULT 0, messages jsonb NOT NULL DEFAULT '[]',
      created timestamptz NOT NULL DEFAULT now(), finished timestamptz);

    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['gear', 'routes', 'activities', 'activity_streams', 'best_efforts', 'imports'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    """,
    # 4: sport-specific numbers (rides, hikes, walks, swims) + goals
    """
    ALTER TABLE activities ADD COLUMN sport_label text, ADD COLUMN max_alt real, ADD COLUMN min_alt real,
      ADD COLUMN vam real, ADD COLUMN norm_power real, ADD COLUMN steps real,
      ADD COLUMN pool_length_m real, ADD COLUMN lengths int, ADD COLUMN strokes real, ADD COLUMN swolf real;
    CREATE TABLE goals (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sport text, period text NOT NULL CHECK (period IN ('week', 'month', 'year')),
      metric text NOT NULL CHECK (metric IN ('distance', 'time', 'elevation', 'count')),
      target real NOT NULL CHECK (target > 0), created timestamptz NOT NULL DEFAULT now());
    ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON goals FOR SELECT TO fit_readers USING (user_id = fit_me());
    GRANT SELECT ON goals TO fit_readers;
    """,
    # 5: food log (entries, own foods, saved meals), weight, nutrition targets; shared cache of public food data
    """
    ALTER TABLE profile ADD COLUMN kcal_target real, ADD COLUMN protein_target real, ADD COLUMN carbs_target real,
      ADD COLUMN fat_target real, ADD COLUMN fiber_target real;
    CREATE TABLE food_entries (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, meal text NOT NULL DEFAULT 'snacks' CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snacks')),
      name text NOT NULL, brand text, amount real NOT NULL DEFAULT 1, unit text NOT NULL DEFAULT 'serving',
      kcal real NOT NULL DEFAULT 0, protein_g real NOT NULL DEFAULT 0, carbs_g real NOT NULL DEFAULT 0, fat_g real NOT NULL DEFAULT 0,
      fiber_g real, source text NOT NULL DEFAULT 'quick', ref jsonb, position real NOT NULL DEFAULT 0,
      created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now());
    CREATE INDEX food_entries_day ON food_entries (user_id, day);
    CREATE TABLE custom_foods (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL, brand text, barcode text, serving_label text NOT NULL DEFAULT '1 serving', serving_g real,
      kcal real NOT NULL DEFAULT 0, protein_g real NOT NULL DEFAULT 0, carbs_g real NOT NULL DEFAULT 0, fat_g real NOT NULL DEFAULT 0,
      fiber_g real, favorite boolean NOT NULL DEFAULT false, created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE saved_meals (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL, items jsonb NOT NULL, created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE weights (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, kg real NOT NULL CHECK (kg BETWEEN 20 AND 400), note text, PRIMARY KEY (user_id, day));
    CREATE TABLE food_cache (key text PRIMARY KEY, data jsonb NOT NULL, fetched timestamptz NOT NULL DEFAULT now());
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['food_entries', 'custom_foods', 'saved_meals', 'weights'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    """,
    # 6: automatic connections (Apple Health Auto Export push, intervals.icu pull). Holds secrets: NOT granted to fit_readers.
    """
    CREATE TABLE connections (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('apple', 'intervals')),
      token_hash text UNIQUE, settings jsonb NOT NULL DEFAULT '{}', status text, last_sync timestamptz, last_count int,
      created timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, kind));
    ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
    """,
    # 7: friendly SQL views for the per-person SQL logins (security_invoker: row-level security still applies)
    """
    CREATE VIEW v_activities WITH (security_invoker = true) AS
      SELECT a.id, (a.start_time AT TIME ZONE a.tz) AS start_local, a.sport, a.sport_label, a.name,
        round((a.distance_m / 1609.344)::numeric, 2) AS miles, round((a.distance_m / 1000)::numeric, 2) AS km,
        round((a.moving_s / 60)::numeric, 1) AS moving_min,
        CASE WHEN a.sport IN ('run', 'walk', 'hike') AND a.distance_m > 0 THEN round((a.moving_s / 60 / (a.distance_m / 1609.344))::numeric, 2) END AS pace_min_per_mi,
        CASE WHEN a.sport IN ('run', 'walk', 'hike') AND a.gap_s_per_km > 0 THEN round((a.gap_s_per_km * 1.609344 / 60)::numeric, 2) END AS gap_min_per_mi,
        CASE WHEN a.moving_s > 0 AND a.distance_m > 0 THEN round((a.distance_m / a.moving_s * 2.23694)::numeric, 1) END AS mph,
        round(a.ascent_m * 3.28084) AS climb_ft, round(a.avg_hr) AS avg_hr, round(a.max_hr) AS max_hr, round(a.effort) AS effort,
        a.decoupling AS hr_drift_pct, a.vo2max, round(a.avg_power) AS avg_watts, round(a.calories) AS calories,
        r.name AS route, g.name AS gear, a.commute, a.source
      FROM activities a LEFT JOIN routes r ON r.id = a.route_id LEFT JOIN gear g ON g.id = a.gear_id;
    CREATE VIEW v_weekly WITH (security_invoker = true) AS
      SELECT date_trunc('week', start_time AT TIME ZONE tz)::date AS week, sport, count(*) AS activities,
        round((sum(distance_m) / 1609.344)::numeric, 1) AS miles, round((sum(moving_s) / 3600)::numeric, 1) AS hours,
        round(sum(ascent_m) * 3.28084) AS climb_ft, round(sum(effort)) AS effort
      FROM activities GROUP BY 1, 2;
    CREATE VIEW v_best_efforts WITH (security_invoker = true) AS
      SELECT b.sport, b.label, make_interval(secs => b.elapsed_s) AS time, (b.start_time AT TIME ZONE a.tz)::date AS day, a.name AS activity,
        rank() OVER (PARTITION BY b.sport, b.distance_m ORDER BY b.elapsed_s) AS all_time_rank, b.distance_m
      FROM best_efforts b JOIN activities a ON a.id = b.activity_id;
    CREATE VIEW v_food_days WITH (security_invoker = true) AS
      SELECT day, count(*) AS entries, round(sum(kcal)) AS kcal, round(sum(protein_g)) AS protein_g, round(sum(carbs_g)) AS carbs_g,
        round(sum(fat_g)) AS fat_g, round(sum(coalesce(fiber_g, 0))) AS fiber_g FROM food_entries GROUP BY day;
    CREATE VIEW v_weights WITH (security_invoker = true) AS
      SELECT day, round(kg::numeric, 1) AS kg, round((kg * 2.20462)::numeric, 1) AS lb, note FROM weights;
    GRANT SELECT ON v_activities, v_weekly, v_best_efforts, v_food_days, v_weights TO fit_readers;
    """,
    # 8: whole seconds in v_best_efforts
    """
    CREATE OR REPLACE VIEW v_best_efforts WITH (security_invoker = true) AS
      SELECT b.sport, b.label, make_interval(secs => round(b.elapsed_s)) AS time, (b.start_time AT TIME ZONE a.tz)::date AS day, a.name AS activity,
        rank() OVER (PARTITION BY b.sport, b.distance_m ORDER BY b.elapsed_s) AS all_time_rank, b.distance_m
      FROM best_efforts b JOIN activities a ON a.id = b.activity_id;
    """,
    # 9: weekly AI reviews
    """
    CREATE TABLE coach_notes (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'week', period_start date NOT NULL, text text NOT NULL,
      created timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, kind, period_start));
    ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON coach_notes FOR SELECT TO fit_readers USING (user_id = fit_me());
    GRANT SELECT ON coach_notes TO fit_readers;
    """,
    # 10: admin flag - an admin can add and invite people in the app (the first account is the admin)
    """
    ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
    UPDATE users SET is_admin = true WHERE id = (SELECT min(id) FROM users);
    """,
    # 11: optional SQL logins that read EVERYONE's rows. fit_all_readers = members see all rows (all_rows policy on
    #     every personal table); only `python -m app.users sql-login <admin> --all-people` grants it, and only to admins.
    #     Views gain a `person` column and group per person so totals never mix people.
    """
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fit_all_readers') THEN CREATE ROLE fit_all_readers NOLOGIN; END IF;
    END $$;
    GRANT fit_readers TO fit_all_readers;
    DO $$ DECLARE t text; BEGIN
      FOR t IN SELECT c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE p.polname = 'own_rows' LOOP
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
      END LOOP;
    END $$;
    DROP VIEW v_activities, v_weekly, v_best_efforts, v_food_days, v_weights;
    CREATE VIEW v_activities WITH (security_invoker = true) AS
      SELECT a.id, u.login::text AS person, (a.start_time AT TIME ZONE a.tz) AS start_local, a.sport, a.sport_label, a.name,
        round((a.distance_m / 1609.344)::numeric, 2) AS miles, round((a.distance_m / 1000)::numeric, 2) AS km,
        round((a.moving_s / 60)::numeric, 1) AS moving_min,
        CASE WHEN a.sport IN ('run', 'walk', 'hike') AND a.distance_m > 0 THEN round((a.moving_s / 60 / (a.distance_m / 1609.344))::numeric, 2) END AS pace_min_per_mi,
        CASE WHEN a.sport IN ('run', 'walk', 'hike') AND a.gap_s_per_km > 0 THEN round((a.gap_s_per_km * 1.609344 / 60)::numeric, 2) END AS gap_min_per_mi,
        CASE WHEN a.moving_s > 0 AND a.distance_m > 0 THEN round((a.distance_m / a.moving_s * 2.23694)::numeric, 1) END AS mph,
        round(a.ascent_m * 3.28084) AS climb_ft, round(a.avg_hr) AS avg_hr, round(a.max_hr) AS max_hr, round(a.effort) AS effort,
        a.decoupling AS hr_drift_pct, a.vo2max, round(a.avg_power) AS avg_watts, round(a.calories) AS calories,
        r.name AS route, g.name AS gear, a.commute, a.source
      FROM activities a JOIN users u ON u.id = a.user_id LEFT JOIN routes r ON r.id = a.route_id LEFT JOIN gear g ON g.id = a.gear_id;
    CREATE VIEW v_weekly WITH (security_invoker = true) AS
      SELECT u.login::text AS person, date_trunc('week', a.start_time AT TIME ZONE a.tz)::date AS week, a.sport, count(*) AS activities,
        round((sum(a.distance_m) / 1609.344)::numeric, 1) AS miles, round((sum(a.moving_s) / 3600)::numeric, 1) AS hours,
        round(sum(a.ascent_m) * 3.28084) AS climb_ft, round(sum(a.effort)) AS effort
      FROM activities a JOIN users u ON u.id = a.user_id GROUP BY 1, 2, 3;
    CREATE VIEW v_best_efforts WITH (security_invoker = true) AS
      SELECT u.login::text AS person, b.sport, b.label, make_interval(secs => round(b.elapsed_s)) AS time, (b.start_time AT TIME ZONE a.tz)::date AS day,
        a.name AS activity, rank() OVER (PARTITION BY b.user_id, b.sport, b.distance_m ORDER BY b.elapsed_s) AS all_time_rank, b.distance_m
      FROM best_efforts b JOIN activities a ON a.id = b.activity_id JOIN users u ON u.id = b.user_id;
    CREATE VIEW v_food_days WITH (security_invoker = true) AS
      SELECT u.login::text AS person, f.day, count(*) AS entries, round(sum(f.kcal)) AS kcal, round(sum(f.protein_g)) AS protein_g,
        round(sum(f.carbs_g)) AS carbs_g, round(sum(f.fat_g)) AS fat_g, round(sum(coalesce(f.fiber_g, 0))) AS fiber_g
      FROM food_entries f JOIN users u ON u.id = f.user_id GROUP BY 1, 2;
    CREATE VIEW v_weights WITH (security_invoker = true) AS
      SELECT u.login::text AS person, w.day, round(w.kg::numeric, 1) AS kg, round((w.kg * 2.20462)::numeric, 1) AS lb, w.note
      FROM weights w JOIN users u ON u.id = w.user_id;
    GRANT SELECT ON v_activities, v_weekly, v_best_efforts, v_food_days, v_weights TO fit_readers;
    """,
    # 12: where the running calorie-deficit total starts (Food > Trends); NULL = first day with food logged
    """
    ALTER TABLE profile ADD COLUMN deficit_start date;
    """,
    # 13: a calorie goal for one specific day (overrides the daily target + training extra); height for BMR
    """
    CREATE TABLE day_goals (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, kcal real NOT NULL CHECK (kcal BETWEEN 0 AND 10000),
      PRIMARY KEY (user_id, day));
    ALTER TABLE day_goals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON day_goals FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON day_goals FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON day_goals TO fit_readers;
    ALTER TABLE profile ADD COLUMN height_cm real;
    """,
    # 14: imported history - calories burned for a day from another app (used instead of the estimate for that day)
    """
    CREATE TABLE day_energy (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, burned_kcal real NOT NULL CHECK (burned_kcal BETWEEN 0 AND 20000),
      source text NOT NULL DEFAULT 'import',
      PRIMARY KEY (user_id, day));
    ALTER TABLE day_energy ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON day_energy FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON day_energy FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON day_energy TO fit_readers;
    ALTER TABLE weights ADD COLUMN source text;
    """,
    # 15: everyday activity outside workouts (BMR multiplier for daily needs; workouts are added only on the day)
    """
    ALTER TABLE profile ADD COLUMN activity_factor real NOT NULL DEFAULT 1.2 CHECK (activity_factor BETWEEN 1.1 AND 1.7);
    """,
    # 16 (2026-10-10): training plans (only the settings; weeks are rebuilt by plans.py) + offline-safe food logging
    # (client_id: a phone that logged food offline can resend without making duplicates)
    """
    CREATE TABLE training_plans (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      race text NOT NULL CHECK (race IN ('5k', '10k', 'half', 'marathon')),
      level text NOT NULL CHECK (level IN ('first', 'beginner', 'intermediate', 'advanced')),
      weeks int NOT NULL, runs int NOT NULL, long_day int NOT NULL, start_day date NOT NULL, race_day date NOT NULL,
      goal_s real, unit text NOT NULL DEFAULT 'mi', start_vol real,
      active boolean NOT NULL DEFAULT true, created timestamptz NOT NULL DEFAULT now(), ended timestamptz);
    CREATE UNIQUE INDEX training_plans_active ON training_plans (user_id) WHERE active;
    ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON training_plans FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON training_plans FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON training_plans TO fit_readers;
    ALTER TABLE food_entries ADD COLUMN client_id text;
    CREATE UNIQUE INDEX food_entries_client ON food_entries (user_id, client_id) WHERE client_id IS NOT NULL;
    """,
    # 17: invite links - an admin creates a one-time link (7 days); the person opens it and picks their own password.
    #     Not personal data and no SQL-login access (no grant to fit_readers).
    """
    CREATE TABLE invites (
      id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      token_hash text NOT NULL UNIQUE,
      created_by bigint REFERENCES users(id) ON DELETE CASCADE,
      note       text,
      created    timestamptz NOT NULL DEFAULT now(),
      expires    timestamptz NOT NULL,
      used_by    bigint REFERENCES users(id) ON DELETE SET NULL,
      used_at    timestamptz);
    """,
    # 18: beta waitlist - people ask to join from the public /beta page (only when KINETTA_BETA_SIGNUP=1); an admin
    #     turns a request into an invite link. Contact details of strangers: admin-only, no grant to fit_readers.
    """
    CREATE TABLE beta_requests (
      id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name      text NOT NULL,
      email     text NOT NULL,
      phone     text NOT NULL,
      watch     text,
      note      text,
      created   timestamptz NOT NULL DEFAULT now(),
      status    text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'invited', 'dismissed')),
      invite_id bigint REFERENCES invites(id) ON DELETE SET NULL);
    CREATE UNIQUE INDEX beta_requests_email ON beta_requests (lower(email));
    """,
    # 19: AI consent per person - coach notes, weekly reviews and food photos send that person's data to the AI service,
    #     so they only run once the person turns "AI features" on (NULL = never asked = off). Accounts that already
    #     existed when this shipped keep the coach they had.
    """
    ALTER TABLE profile ADD COLUMN ai_ok boolean;
    UPDATE profile SET ai_ok = true;
    """,
    # 20 (2026-10-11): workouts sent by the Kinetta iPhone app from Apple Health (api_health.py). source_id holds HealthKit's
    #     own id for the workout, so one sent twice (a retry, a second phone) is stored once, even when both arrive at the
    #     same moment. health_ai_ok: the person said yes to the AI coach reading their Apple Health workouts (off until then).
    """
    CREATE UNIQUE INDEX activities_healthkit ON activities (user_id, source_id) WHERE source = 'healthkit';
    ALTER TABLE profile ADD COLUMN health_ai_ok boolean NOT NULL DEFAULT false;
    """,
    # 21 (2026-10-11): friends, sharing and comments (api_social.py).
    #   friendships: one row per pair of people (either direction); 'pending' until the other person approves.
    #   Each activity is 'me' (only me, the default), 'friends' or 'everyone' on this server. share_details: which details
    #   others see ({} = the defaults in api_social.DETAILS); on an activity, NULL = follow the person's own setting.
    #   share_trim_m: shared maps leave out this many metres at the start and the end of the route.
    #   cheers + comments: a SQL login sees the ones it gave and the ones on its own activities.
    """
    ALTER TABLE profile ADD COLUMN share_default text NOT NULL DEFAULT 'me' CHECK (share_default IN ('me', 'friends', 'everyone')),
      ADD COLUMN share_details jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN share_trim_m int NOT NULL DEFAULT 400 CHECK (share_trim_m IN (0, 200, 400, 800));
    ALTER TABLE activities ADD COLUMN visibility text NOT NULL DEFAULT 'me' CHECK (visibility IN ('me', 'friends', 'everyone')),
      ADD COLUMN share_details jsonb;
    CREATE INDEX activities_shared ON activities (user_id, start_time DESC) WHERE visibility <> 'me';

    CREATE TABLE friendships (
      requester bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
      created   timestamptz NOT NULL DEFAULT now(),
      accepted  timestamptz,
      PRIMARY KEY (requester, addressee), CHECK (requester <> addressee));
    CREATE UNIQUE INDEX friendships_pair ON friendships (least(requester, addressee), greatest(requester, addressee));
    CREATE INDEX friendships_addressee ON friendships (addressee);
    CREATE TABLE cheers (
      activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created     timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (activity_id, user_id));
    CREATE TABLE comments (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
      created     timestamptz NOT NULL DEFAULT now());
    CREATE INDEX comments_activity ON comments (activity_id, created);

    ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON friendships FOR SELECT TO fit_readers USING (fit_me() IN (requester, addressee));
    CREATE POLICY all_rows ON friendships FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON friendships TO fit_readers;
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['cheers', 'comments'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me()
                          OR activity_id IN (SELECT id FROM activities WHERE user_id = fit_me()))', t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    """,
    # 22 (2026-10-11): cooking mode (api_dishes.py). A dish collects ingredients while it cooks (items: a jsonb list, each
    #   with its own per-100 g values so its amount can change later). known_*: a dish total typed in from a recipe, used
    #   instead of the ingredients' sum. cooked_g: the finished dish without the pan. Each portion logged from it is an
    #   ordinary food_entries row (source 'dish') and adds to eaten_g, so the leftovers are cooked_g - eaten_g.
    #   pans: the person's empty pans, so a dish can be weighed in its pan.
    """
    CREATE TABLE dishes (
      id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name      text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      items     jsonb NOT NULL DEFAULT '[]',
      known_kcal real, known_protein_g real, known_carbs_g real, known_fat_g real,
      cooked_g  real CHECK (cooked_g > 0),
      eaten_g   real NOT NULL DEFAULT 0 CHECK (eaten_g >= 0),
      created   timestamptz NOT NULL DEFAULT now(),
      updated   timestamptz NOT NULL DEFAULT now(),
      done_at   timestamptz);
    CREATE INDEX dishes_user ON dishes (user_id, created DESC);
    CREATE TABLE pans (
      id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name      text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
      grams     real NOT NULL CHECK (grams > 0),
      created   timestamptz NOT NULL DEFAULT now());
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['dishes', 'pans'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    """,    # 23 (2026-10-11): profile.findable - false keeps you out of friend search (people can still add you by your exact
    #   username). dish_shares: a dish its cook shares with friends, who can see it and log their own portion from it.
    #   A SQL login sees the shares it made and the ones made to it.
    """
    ALTER TABLE profile ADD COLUMN findable boolean NOT NULL DEFAULT true;
    CREATE TABLE dish_shares (
      dish_id   bigint NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (dish_id, user_id));
    CREATE INDEX dish_shares_user ON dish_shares (user_id);
    ALTER TABLE dish_shares ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON dish_shares FOR SELECT TO fit_readers
      USING (user_id = fit_me() OR dish_id IN (SELECT id FROM dishes WHERE user_id = fit_me()));
    CREATE POLICY all_rows ON dish_shares FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON dish_shares TO fit_readers;
    """,    # 24 (2026-10-11): AI feedback on a recipe (food_coach.py), kept on the dish as JSON; the diet review uses coach_notes
    #   (kind 'diet').
    """
    ALTER TABLE dishes ADD COLUMN ai_note text, ADD COLUMN ai_note_at timestamptz;
    """,    # 25 (2026-10-11): AI feedback on a saved meal too (food_coach.py), kept on the meal like a dish's.
    """
    ALTER TABLE saved_meals ADD COLUMN ai_note text, ADD COLUMN ai_note_at timestamptz;
    """,
    # 26 (2026-10-11): ai_requests - one row per AI food review asked for, so the daily limit counts requests (a review
    #   that is asked for again overwrites its note, so notes alone can't be counted). dishes.recipe_updated: when the
    #   recipe itself last changed (ingredients, typed totals, weight) - logging a portion doesn't make feedback stale.
    """
    CREATE TABLE ai_requests (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind    text NOT NULL,
      created timestamptz NOT NULL DEFAULT now());
    CREATE INDEX ai_requests_user ON ai_requests (user_id, created);
    ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON ai_requests FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON ai_requests FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON ai_requests TO fit_readers;
    ALTER TABLE dishes ADD COLUMN recipe_updated timestamptz NOT NULL DEFAULT now();
    UPDATE dishes SET recipe_updated = updated;
    """,
    # 27 (2026-10-11): notifications (notify.py) - who did what to which of your things (the words are made when read;
    #   deleting the activity, dish, comment or person deletes the notification). push_subscriptions: phones and browsers
    #   that asked for phone notifications (Web Push). profile.notify: which kinds to push ({} = all).
    #   server_keys: this server's own keys (the Web Push key pair) - no SQL login may read it.
    """
    CREATE TABLE notifications (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        text NOT NULL,
      actor_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_id bigint REFERENCES activities(id) ON DELETE CASCADE,
      dish_id     bigint REFERENCES dishes(id) ON DELETE CASCADE,
      comment_id  bigint REFERENCES comments(id) ON DELETE CASCADE,
      created     timestamptz NOT NULL DEFAULT now(),
      read_at     timestamptz);
    CREATE INDEX notifications_user ON notifications (user_id, created DESC);
    CREATE TABLE push_subscriptions (
      id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint text NOT NULL UNIQUE,
      p256dh   text NOT NULL,
      auth     text NOT NULL,
      created  timestamptz NOT NULL DEFAULT now());
    CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['notifications', 'push_subscriptions'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    ALTER TABLE profile ADD COLUMN notify jsonb NOT NULL DEFAULT '{}';
    CREATE TABLE server_keys (name text PRIMARY KEY, value text NOT NULL, created timestamptz NOT NULL DEFAULT now());
    ALTER TABLE server_keys ENABLE ROW LEVEL SECURITY;
    """,
    # 28 (2026-10-11): blocking and reporting (api_social.py) - Apple requires both in apps where people see each other's
    #     posts. blocks = whom each person blocked (theirs, RLS like other personal tables). reports = what was reported
    #     to the admins, with a copy of the words at the time: admin-only, no grant to fit_readers.
    """
    CREATE TABLE blocks (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, blocked), CHECK (user_id <> blocked));
    CREATE INDEX blocks_blocked ON blocks (blocked);
    ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON blocks FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON blocks FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON blocks TO fit_readers;
    CREATE TABLE reports (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      reporter    bigint REFERENCES users(id) ON DELETE SET NULL,
      person      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_id bigint REFERENCES activities(id) ON DELETE SET NULL,
      comment_id  bigint REFERENCES comments(id) ON DELETE SET NULL,
      what        text NOT NULL,
      reason      text NOT NULL CHECK (reason IN ('spam', 'abuse', 'inappropriate', 'other')),
      note        text,
      created     timestamptz NOT NULL DEFAULT now(),
      status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')));
    CREATE INDEX reports_open ON reports (created) WHERE status = 'open';
    ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
    """,
    # 29 (2026-10-12): plan workouts ticked off by hand (plans.py: done without a recorded run, e.g. on a treadmill
    # with no watch), and calorie-burn goals, including daily ones
    """
    CREATE TABLE plan_marks (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id bigint NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
      day date NOT NULL,
      created timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (plan_id, day));
    CREATE INDEX plan_marks_user ON plan_marks (user_id);
    ALTER TABLE plan_marks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON plan_marks FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON plan_marks FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON plan_marks TO fit_readers;
    ALTER TABLE goals DROP CONSTRAINT goals_period_check, DROP CONSTRAINT goals_metric_check;
    ALTER TABLE goals ADD CONSTRAINT goals_period_check CHECK (period IN ('day', 'week', 'month', 'year')),
      ADD CONSTRAINT goals_metric_check CHECK (metric IN ('distance', 'time', 'elevation', 'count', 'calories'));
    """,
    # 30 (2026-10-12): a tick by hand can also say "not done" (overrides a run that would tick the workout off)
    """
    ALTER TABLE plan_marks ADD COLUMN done boolean NOT NULL DEFAULT true;
    """,
    # 31 (2026-10-12): cooking, round two (api_dishes.py). recipes: dishes the person chose to save, to cook again (a dish
    #   isn't kept otherwise: once finished, or its leftovers are 5 days old, it's deleted; the food log keeps the portions).
    #   dishes.meal: the meal it's cooked for. dishes.recipe_id: the saved recipe it came from or was saved as (changes to
    #   the dish update it). dishes.eaten_share: portions logged as a share of a dish that has no weight (a typed-in total).
    """
    CREATE TABLE recipes (
      id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name      text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      items     jsonb NOT NULL DEFAULT '[]',
      known_kcal real, known_protein_g real, known_carbs_g real, known_fat_g real,
      ai_note   text, ai_note_at timestamptz,
      created   timestamptz NOT NULL DEFAULT now(),
      updated   timestamptz NOT NULL DEFAULT now(),
      cooked    timestamptz);
    CREATE INDEX recipes_user ON recipes (user_id, updated DESC);
    ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON recipes FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON recipes FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON recipes TO fit_readers;
    ALTER TABLE dishes ADD COLUMN meal text NOT NULL DEFAULT 'dinner' CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snacks')),
      ADD COLUMN recipe_id bigint REFERENCES recipes(id) ON DELETE SET NULL,
      ADD COLUMN eaten_share real NOT NULL DEFAULT 0 CHECK (eaten_share >= 0);
    UPDATE dishes SET meal = CASE name WHEN 'Breakfast' THEN 'breakfast' WHEN 'Lunch' THEN 'lunch' ELSE 'dinner' END;
    """,
    # 32 (2026-10-12): dishes, round three (api_dishes.py). A dish is simply saved: no cooking / leftovers / finished, no
    #   pans in the app (the table stays). serving: 'one' (a smoothie: logged as whole servings) or 'portion' (grams or
    #   "1 of N"; servings remembers N). Each saved recipe that no dish still points at becomes a dish; dishes cooked from
    #   the same recipe keep only one (a shared one first, then the newest). The recipes table stays (nothing reads it any more).
    """
    ALTER TABLE dishes ADD COLUMN serving text NOT NULL DEFAULT 'portion' CHECK (serving IN ('one', 'portion')),
      ADD COLUMN servings smallint CHECK (servings BETWEEN 1 AND 50);
    INSERT INTO dishes (user_id, name, items, known_kcal, known_protein_g, known_carbs_g, known_fat_g, ai_note, ai_note_at, recipe_updated, created, updated)
      SELECT r.user_id, r.name, r.items, r.known_kcal, r.known_protein_g, r.known_carbs_g, r.known_fat_g, r.ai_note, r.ai_note_at,
             coalesce(r.ai_note_at, r.updated), r.created, r.updated
      FROM recipes r WHERE NOT EXISTS (SELECT 1 FROM dishes d WHERE d.recipe_id = r.id);
    DELETE FROM dishes d USING dishes n
      WHERE d.recipe_id IS NOT NULL AND n.recipe_id = d.recipe_id
        AND (EXISTS (SELECT 1 FROM dish_shares s WHERE s.dish_id = n.id), n.updated, n.id)
          > (EXISTS (SELECT 1 FROM dish_shares s WHERE s.dish_id = d.id), d.updated, d.id);
    UPDATE dishes SET done_at = NULL, eaten_g = 0, eaten_share = 0;
    """,
    # 33 (2026-10-12): by servings now means the whole dish is one serving (Ben). A dish saved in the day before that as
    #   "by servings, makes N" (N > 1) would log N times too much, so it's switched to by weight (log grams; a dish with
    #   no weight asks for one before it can be logged, rather than logging the wrong amount).
    """
    UPDATE dishes SET serving = 'portion' WHERE serving = 'one' AND servings > 1;
    UPDATE dishes SET servings = 1 WHERE serving = 'one';
    """,
    # 34 (2026-10-12): photos (api_photos.py). A profile photo per person (users.photo_v changes with each new photo, so
    #   phones fetch the new one) and photos on activities, seen by whoever may see the activity. Every photo is a JPEG
    #   the server made itself (nothing from the original file: no location, no phone details). thumb: small, for lists.
    """
    ALTER TABLE users ADD COLUMN photo_v text;
    CREATE TABLE profile_photos (
      user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      img     bytea NOT NULL,
      created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE activity_photos (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      img         bytea NOT NULL,
      thumb       bytea NOT NULL,
      w           int NOT NULL,
      h           int NOT NULL,
      created     timestamptz NOT NULL DEFAULT now());
    CREATE INDEX activity_photos_activity ON activity_photos (activity_id, id);
    CREATE INDEX activity_photos_user ON activity_photos (user_id);
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['profile_photos', 'activity_photos'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    """,
    # 35 (2026-10-13): lifting (api_lifts.py). exercises: each person's own list - the common ones are added the first
    #   time they're used, so every set points at a row that can be renamed without losing its history. note: something
    #   to remember for next time ("seat on 4"). kind: 'weight' (reps x weight), 'body' (reps, weight added optional),
    #   'time' (seconds). lift_sets: one row per set, in the order done: pos = the exercise's place in the session, n =
    #   the set's number within it. done = ticked off; sets copied from last time stay planned (not done) until ticked
    #   and never count in history. activities.lift_open: a session being logged right now (its time keeps running).
    """
    CREATE TABLE exercises (
      id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name    citext NOT NULL,
      kind    text NOT NULL DEFAULT 'weight' CHECK (kind IN ('weight', 'body', 'time')),
      muscle  text,
      note    text,
      created timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, name));
    CREATE TABLE lift_sets (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_id bigint NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      exercise_id bigint NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      pos         smallint NOT NULL,
      n           smallint NOT NULL,
      reps        smallint CHECK (reps BETWEEN 0 AND 1000),
      kg          real CHECK (kg BETWEEN 0 AND 1000),
      secs        int CHECK (secs BETWEEN 0 AND 86400),
      warmup      boolean NOT NULL DEFAULT false,
      done        boolean NOT NULL DEFAULT true);
    CREATE INDEX lift_sets_activity ON lift_sets (activity_id, pos, n);
    CREATE INDEX lift_sets_exercise ON lift_sets (user_id, exercise_id);
    ALTER TABLE activities ADD COLUMN lift_open boolean NOT NULL DEFAULT false;
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['exercises', 'lift_sets'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP; END $$;
    CREATE VIEW v_lift_sets WITH (security_invoker = true) AS
      SELECT u.login::text AS person, (a.start_time AT TIME ZONE a.tz)::date AS day, a.name AS session, e.name::text AS exercise,
        s.n AS set_no, s.reps, round(s.kg::numeric, 1) AS kg, round((s.kg * 2.20462)::numeric, 1) AS lb, s.secs, s.warmup,
        CASE WHEN s.reps BETWEEN 1 AND 12 AND s.kg > 0 THEN round((s.kg * (1 + s.reps / 30.0))::numeric, 1) END AS est_1rm_kg,
        a.id AS activity_id
      FROM lift_sets s JOIN exercises e ON e.id = s.exercise_id JOIN activities a ON a.id = s.activity_id JOIN users u ON u.id = s.user_id
      WHERE s.done;
    GRANT SELECT ON v_lift_sets TO fit_readers;
    """,
    # 36: narrow read-only coach context, explicit-confirmation proposals and constrained plan overrides.
    """
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fit_coach') THEN CREATE ROLE fit_coach NOLOGIN; END IF;
    END $$;
    GRANT fit_coach TO fit_app;
    GRANT USAGE ON SCHEMA public TO fit_coach;
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['profile', 'activities', 'best_efforts', 'routes', 'food_entries', 'weights',
                               'dishes', 'day_goals', 'day_energy', 'training_plans', 'plan_marks', 'exercises', 'lift_sets'] LOOP
        EXECUTE format('GRANT SELECT ON %I TO fit_coach', t);
        EXECUTE format('CREATE POLICY coach_own_rows ON %I FOR SELECT TO fit_coach USING
          (user_id = nullif(current_setting(''kinetta.coach_user_id'', true), '''')::bigint)', t);
      END LOOP;
    END $$;
    CREATE TABLE coach_proposals (
      id uuid PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('plan', 'food')),
      payload jsonb NOT NULL,
      baseline text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
      created timestamptz NOT NULL DEFAULT now(),
      expires timestamptz NOT NULL DEFAULT now() + interval '1 day');
    CREATE INDEX coach_proposals_user ON coach_proposals (user_id, created DESC);
    CREATE TABLE plan_adjustments (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id bigint NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
      day date NOT NULL,
      workout jsonb NOT NULL,
      created timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (plan_id, day));
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['coach_proposals', 'plan_adjustments'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())', t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)', t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers', t);
      END LOOP;
    END $$;
    GRANT SELECT ON plan_adjustments TO fit_coach;
    CREATE POLICY coach_own_rows ON plan_adjustments FOR SELECT TO fit_coach USING
      (user_id = nullif(current_setting('kinetta.coach_user_id', true), '')::bigint);
    """,
    # 37: retain Health provenance when richer details enrich an existing import.
    """
    ALTER TABLE activities ADD COLUMN healthkit_id text;
    ALTER TABLE activities ADD COLUMN health_details jsonb;
    UPDATE activities SET healthkit_id = source_id WHERE source = 'healthkit'
      OR (source = 'lift' AND source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    CREATE UNIQUE INDEX activities_healthkit_identity ON activities (user_id, healthkit_id) WHERE healthkit_id IS NOT NULL;
    """,
    # 38: a short, public profile bio; existing profile RLS remains in force.
    """
    ALTER TABLE profile ADD COLUMN bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280);
    """,
    # 39: product access is independent of AI consent; only trusted server code writes it.
    """
    CREATE TABLE ai_entitlements (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature text NOT NULL CHECK (feature IN ('food', 'coach')),
      enabled boolean NOT NULL DEFAULT true,
      expires_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, feature));
    ALTER TABLE ai_entitlements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON ai_entitlements FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON ai_entitlements FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON ai_entitlements TO fit_readers;
    """,
    # 40: native iPhone push devices; logout/expired-session cleanup revokes delivery with the session.
    """
    CREATE TABLE native_push_devices (
      token text NOT NULL CHECK (token ~ '^[0-9a-f]{64,200}$'),
      environment text NOT NULL CHECK (environment IN ('production', 'sandbox')),
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      created timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (token, environment));
    CREATE INDEX native_push_user ON native_push_devices (user_id);
    ALTER TABLE native_push_devices ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON native_push_devices FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON native_push_devices FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON native_push_devices TO fit_readers;
    """,

    # 41: isolated administrator credentials/sessions, audit and beta response outbox. No reader grants.
    """
    ALTER TABLE beta_requests DROP CONSTRAINT beta_requests_status_check;
    ALTER TABLE beta_requests ADD CONSTRAINT beta_requests_status_check CHECK (status IN ('new','invited','dismissed','waitlisted','declined'));
    CREATE TABLE admin_attempts (key text NOT NULL,created timestamptz NOT NULL DEFAULT now());
    CREATE INDEX admin_attempt_key ON admin_attempts(key,created);
    CREATE TABLE admin_mfa (user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret text NOT NULL, last_counter bigint NOT NULL DEFAULT -1);
    CREATE TABLE admin_challenges (token_hash text PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,seed text,expires timestamptz NOT NULL);
    CREATE TABLE admin_sessions (token_hash text PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires timestamptz NOT NULL);
    CREATE TABLE admin_recovery (user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash text PRIMARY KEY);
    CREATE TABLE admin_audit (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id bigint REFERENCES users(id) ON DELETE SET NULL,action text NOT NULL,target text,created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE beta_responses (id uuid PRIMARY KEY,request_id bigint NOT NULL REFERENCES beta_requests(id) ON DELETE CASCADE,actor_id bigint REFERENCES users(id) ON DELETE SET NULL,kind text NOT NULL,fingerprint text NOT NULL,recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,invite_id bigint REFERENCES invites(id) ON DELETE SET NULL,state text NOT NULL DEFAULT 'queued',provider_id text UNIQUE,created timestamptz NOT NULL DEFAULT now(),first_attempt timestamptz,attempted timestamptz,error text);
    CREATE TABLE admin_mail_events (id text PRIMARY KEY,provider_id text NOT NULL,state text,created timestamptz NOT NULL DEFAULT now());
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['admin_attempts','admin_mfa','admin_challenges','admin_sessions','admin_recovery','admin_audit','beta_responses','admin_mail_events'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, fit_readers, fit_all_readers',t);
      END LOOP;
    END $$;
    CREATE INDEX admin_session_expiry ON admin_sessions(expires);
    CREATE INDEX beta_responses_request ON beta_responses(request_id,created DESC);
    """,

    # 42: corrections are separate from the imported recording and latest original summary.
    """ALTER TABLE activities ADD COLUMN summary_overrides jsonb NOT NULL DEFAULT '{}';
       ALTER TABLE activities ADD COLUMN summary_original jsonb NOT NULL DEFAULT '{}';""",

    # 43: optional Apple Health resting energy; food targets and workout calories stay independent.
    """
    ALTER TABLE profile ADD COLUMN resting_source text NOT NULL DEFAULT 'formula'
      CHECK (resting_source IN ('formula', 'apple_health'));
    CREATE TABLE health_resting (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tz text NOT NULL, day date NOT NULL,
      resting_kcal double precision NOT NULL CHECK (resting_kcal > 0 AND resting_kcal <= 10000),
      observed_at timestamptz NOT NULL, synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, tz, day));
    ALTER TABLE health_resting ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON health_resting FOR SELECT TO fit_readers USING (user_id = fit_me());
    CREATE POLICY all_rows ON health_resting FOR SELECT TO fit_all_readers USING (true);
    GRANT SELECT ON health_resting TO fit_readers;
    """,

    # 44: optional goal-first setup; existing targets, body settings and Health choices stay unchanged.
    """ALTER TABLE profile ADD COLUMN nutrition_goal text
         CHECK (nutrition_goal IN ('lose_weight','maintain','build_muscle','eat_healthier','fuel_training'));
       ALTER TABLE profile ADD COLUMN goal_pace_percent double precision
         CHECK (goal_pace_percent >= 0 AND goal_pace_percent <= 1);""",
    # 45: private food conversation text and owner-bound links; images are not retained.
    """
    ALTER TABLE profile ADD COLUMN food_chat_auto_log boolean NOT NULL DEFAULT true;
    ALTER TABLE profile ADD COLUMN food_chat_tone text NOT NULL DEFAULT 'supportive'
      CHECK (food_chat_tone IN ('supportive','numbers'));
    CREATE TABLE food_chat_messages (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('user','reply')),
      body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
      captured_at timestamptz NOT NULL,
      created timestamptz NOT NULL DEFAULT now(),
      local_day date NOT NULL,
      state text NOT NULL CHECK (state IN ('pending','answered','cancelled')),
      reply_to bigint,
      result jsonb,
      UNIQUE (user_id,client_id), UNIQUE (user_id,id), UNIQUE (user_id,reply_to),
      FOREIGN KEY (user_id,reply_to) REFERENCES food_chat_messages(user_id,id) ON DELETE CASCADE);
    CREATE INDEX food_chat_history ON food_chat_messages(user_id,id DESC);
    CREATE UNIQUE INDEX food_entries_user_identity ON food_entries(user_id,id);
    CREATE TABLE food_chat_entries (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id bigint NOT NULL,
      entry_id bigint NOT NULL,
      PRIMARY KEY (message_id,entry_id),
      FOREIGN KEY (user_id,message_id) REFERENCES food_chat_messages(user_id,id) ON DELETE CASCADE,
      FOREIGN KEY (user_id,entry_id) REFERENCES food_entries(user_id,id) ON DELETE CASCADE);
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['food_chat_messages','food_chat_entries'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())',t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)',t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers',t);
      END LOOP;
    END $$;
    """,

    # 46: durable AI request caps, service food-estimator reservations and token-only audit.
    """
    CREATE TABLE ai_daily_usage (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, kind text NOT NULL, requests int NOT NULL CHECK (requests > 0),
      PRIMARY KEY(user_id,day,kind));
    CREATE TABLE ai_service_budget (
      day date PRIMARY KEY, charged_micros bigint NOT NULL DEFAULT 0 CHECK (charged_micros >= 0));
    CREATE TABLE ai_food_attempts (
      id uuid PRIMARY KEY, user_id bigint REFERENCES users(id) ON DELETE SET NULL,
      day date NOT NULL REFERENCES ai_service_budget(day), model text NOT NULL, kind text NOT NULL,
      created timestamptz NOT NULL DEFAULT now(), state text NOT NULL DEFAULT 'reserved'
        CHECK (state IN ('reserved','measured')),
      reserved_micros bigint NOT NULL CHECK (reserved_micros >= 0),
      charged_micros bigint NOT NULL CHECK (charged_micros >= 0),
      input_tokens bigint CHECK (input_tokens >= 0), output_tokens bigint CHECK (output_tokens >= 0),
      thinking_tokens bigint CHECK (thinking_tokens >= 0));
    CREATE INDEX ai_food_attempts_owner ON ai_food_attempts(user_id,created DESC);
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['ai_daily_usage','ai_food_attempts'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())',t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)',t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers',t);
      END LOOP;
    END $$;
    ALTER TABLE ai_service_budget ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON ai_service_budget FROM PUBLIC,fit_readers,fit_all_readers;
    """,

    # 47: all-provider attempt leases; failures retain cost but release concurrency.
    """ALTER TABLE ai_food_attempts DROP CONSTRAINT ai_food_attempts_state_check;
       ALTER TABLE ai_food_attempts ADD CONSTRAINT ai_food_attempts_state_check
         CHECK (state IN ('reserved','measured','failed'));
       ALTER TABLE ai_food_attempts ADD COLUMN lease_until timestamptz;
       ALTER TABLE ai_food_attempts ADD COLUMN finished_at timestamptz;
       ALTER TABLE ai_food_attempts ADD COLUMN request_id uuid;
       ALTER TABLE ai_service_budget ADD COLUMN warned_at timestamptz;
       CREATE INDEX ai_attempts_request ON ai_food_attempts(user_id,request_id);
       CREATE INDEX ai_attempts_inflight ON ai_food_attempts(lease_until) WHERE state='reserved';
       CREATE INDEX ai_attempts_day ON ai_food_attempts(day);
       CREATE INDEX ai_attempts_owner_day ON ai_food_attempts(user_id,day);""",

    # 48: learn-once private foods and short-lived thread processing leases; no images.
    """ALTER TABLE custom_foods ADD COLUMN origin text NOT NULL DEFAULT 'manual'
          CHECK (origin IN ('manual','ai','catalog','label'));
       ALTER TABLE custom_foods ADD COLUMN origin_notes text;
       ALTER TABLE custom_foods ADD COLUMN origin_model text;
       ALTER TABLE custom_foods ADD COLUMN origin_edited boolean NOT NULL DEFAULT false;
       ALTER TABLE custom_foods ADD COLUMN origin_ref jsonb;
       CREATE TABLE food_chat_aliases (
         user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         key text NOT NULL,
         templates jsonb NOT NULL, created timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY(user_id,key));
       CREATE TABLE food_chat_cancellations (
         user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         client_id uuid NOT NULL, created timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY(user_id,client_id));
       CREATE TABLE food_chat_jobs (
         user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         message_id bigint NOT NULL, lease uuid NOT NULL, expires timestamptz NOT NULL,
         state text NOT NULL CHECK (state IN ('running','done','failed','cancelled')),
         input_hash text, created timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY(user_id,message_id),
         FOREIGN KEY(user_id,message_id) REFERENCES food_chat_messages(user_id,id) ON DELETE CASCADE);
       DO $$ DECLARE t text; BEGIN
         FOREACH t IN ARRAY ARRAY['food_chat_aliases','food_chat_jobs','food_chat_cancellations'] LOOP
           EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
           EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())',t);
           EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)',t);
           EXECUTE format('GRANT SELECT ON %I TO fit_readers',t);
         END LOOP;
       END $$;
       UPDATE ai_food_attempts SET request_id=NULL WHERE user_id IS NULL;
       CREATE FUNCTION clear_ai_request_reference() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         UPDATE ai_food_attempts SET request_id=NULL WHERE user_id=OLD.id;
         RETURN OLD;
       END $$;
       CREATE TRIGGER clear_ai_request_reference BEFORE DELETE ON users
         FOR EACH ROW EXECUTE FUNCTION clear_ai_request_reference();""",

    # 49: optional food-chat end-of-day note; off until explicitly selected.
    """ALTER TABLE profile ADD COLUMN food_chat_daily_note text NOT NULL DEFAULT 'off'
         CHECK (food_chat_daily_note IN ('off','code','ai'));""",

    # 50: private weekly target suggestions and explicit decisions; no automatic target changes.
    """CREATE TABLE nutrition_checkins (
         id uuid PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         week date NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','deferred')),
         data jsonb NOT NULL,baseline text NOT NULL,created timestamptz NOT NULL DEFAULT now(),
         updated timestamptz NOT NULL DEFAULT now(),acted_at timestamptz,UNIQUE(user_id,week));
       ALTER TABLE nutrition_checkins ENABLE ROW LEVEL SECURITY;
       CREATE POLICY own_rows ON nutrition_checkins FOR SELECT TO fit_readers USING(user_id=fit_me());
       CREATE POLICY all_rows ON nutrition_checkins FOR SELECT TO fit_all_readers USING(true);
       GRANT SELECT ON nutrition_checkins TO fit_readers;""",

    # 51: explicit recipe-link reads; parsed data only, private replay/cancellation identities.
    """CREATE TABLE recipe_link_drafts (
         user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,id uuid NOT NULL,
         url text NOT NULL,state text NOT NULL DEFAULT 'pending'
           CHECK(state IN ('pending','ready','failed','cancelled','saved')),
         data jsonb NOT NULL DEFAULT '{}'::jsonb,error_code text,error_message text,
         created timestamptz NOT NULL DEFAULT now(),expires timestamptz NOT NULL DEFAULT now()+interval '24 hours',
         saved_dish_id bigint REFERENCES dishes(id) ON DELETE SET NULL,PRIMARY KEY(user_id,id));
       CREATE INDEX recipe_link_owner_day ON recipe_link_drafts(user_id,created DESC);
       ALTER TABLE recipe_link_drafts ENABLE ROW LEVEL SECURITY;
       CREATE POLICY own_rows ON recipe_link_drafts FOR SELECT TO fit_readers USING(user_id=fit_me());
       CREATE POLICY all_rows ON recipe_link_drafts FOR SELECT TO fit_all_readers USING(true);
       GRANT SELECT ON recipe_link_drafts TO fit_readers;""",

    # 52: imported-recipe source and nullable known fiber; old recipes retain whole-meal servings.
    """ALTER TABLE dishes ADD COLUMN known_fiber_g real,
         ADD COLUMN recipe_source jsonb NOT NULL DEFAULT '{}'::jsonb;""",

    # 53: provided extra nutrients and opt-in limits; old rows remain unknown, not zero.
    """ALTER TABLE food_entries ADD COLUMN sodium_mg real CHECK(sodium_mg BETWEEN 0 AND 1000000),
         ADD COLUMN sugar_g real CHECK(sugar_g BETWEEN 0 AND 2000),ADD COLUMN saturated_fat_g real CHECK(saturated_fat_g BETWEEN 0 AND 2000);
       ALTER TABLE custom_foods ADD COLUMN sodium_mg real CHECK(sodium_mg BETWEEN 0 AND 1000000),
         ADD COLUMN sugar_g real CHECK(sugar_g BETWEEN 0 AND 2000),ADD COLUMN saturated_fat_g real CHECK(saturated_fat_g BETWEEN 0 AND 2000);
       ALTER TABLE dishes ADD COLUMN known_sodium_mg real CHECK(known_sodium_mg BETWEEN 0 AND 10000000),
         ADD COLUMN known_sugar_g real CHECK(known_sugar_g BETWEEN 0 AND 5000),ADD COLUMN known_saturated_fat_g real CHECK(known_saturated_fat_g BETWEEN 0 AND 5000);
       ALTER TABLE profile ADD COLUMN sodium_target_mg real CHECK(sodium_target_mg BETWEEN 0 AND 100000),
         ADD COLUMN sugar_target_g real CHECK(sugar_target_g BETWEEN 0 AND 2000),ADD COLUMN saturated_fat_target_g real CHECK(saturated_fat_target_g BETWEEN 0 AND 1000);""",

    # 54: explicit Health weight read, private UUID candidates and manual-deletion fences.
    """    ALTER TABLE profile ADD COLUMN health_weight_read boolean NOT NULL DEFAULT false,
      ADD COLUMN health_weight_epoch uuid NOT NULL DEFAULT gen_random_uuid(),
      ADD COLUMN health_weight_last_synced timestamptz,
      ADD COLUMN health_weight_ai_ok boolean NOT NULL DEFAULT false,
      ADD COLUMN weight_health_derived boolean NOT NULL DEFAULT false;
    CREATE TABLE health_weight_samples (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sample_id uuid NOT NULL, sampled_at timestamptz, kg real CHECK(kg BETWEEN 20 AND 400),
      source_name text, source_bundle text, deleted boolean NOT NULL DEFAULT false,
      observed_at timestamptz NOT NULL, PRIMARY KEY(user_id,sample_id),
      CHECK(deleted OR (sampled_at IS NOT NULL AND kg IS NOT NULL)));
    CREATE INDEX health_weight_sample_dates ON health_weight_samples(user_id,sampled_at DESC);
    CREATE TABLE health_weight_exclusions (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, before_time timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,day));
    ALTER TABLE weights ADD COLUMN health_sample_id uuid,
      ADD COLUMN source_name text,
      ADD CONSTRAINT weight_health_sample_owner FOREIGN KEY(user_id,health_sample_id)
        REFERENCES health_weight_samples(user_id,sample_id) ON DELETE CASCADE;
    DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY['health_weight_samples','health_weight_exclusions'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('CREATE POLICY own_rows ON %I FOR SELECT TO fit_readers USING (user_id = fit_me())',t);
        EXECUTE format('CREATE POLICY all_rows ON %I FOR SELECT TO fit_all_readers USING (true)',t);
        EXECUTE format('GRANT SELECT ON %I TO fit_readers',t);
      END LOOP;
    END $$;
    UPDATE profile p SET weight_health_derived=true WHERE EXISTS (
      SELECT 1 FROM weights w WHERE w.user_id=p.user_id AND w.source='healthkit'
      AND w.day=(SELECT max(day) FROM weights WHERE user_id=p.user_id));
""",

    # 55: optional Health nutrition output journal, including edits and deletion tombstones.
    """    ALTER TABLE profile ADD COLUMN health_nutrition_write boolean NOT NULL DEFAULT false,
      ADD COLUMN health_nutrition_epoch uuid NOT NULL DEFAULT gen_random_uuid();
    CREATE SEQUENCE health_nutrition_revision;
    CREATE TABLE health_nutrition_days (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL, revision bigint NOT NULL DEFAULT nextval('health_nutrition_revision'),
      changed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,day));
    CREATE INDEX health_nutrition_pending ON health_nutrition_days(user_id,revision);
    ALTER TABLE health_nutrition_days ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON health_nutrition_days FOR SELECT TO fit_readers USING(user_id=fit_me());
    CREATE POLICY all_rows ON health_nutrition_days FOR SELECT TO fit_all_readers USING(true);
    GRANT SELECT ON health_nutrition_days TO fit_readers;
    CREATE FUNCTION health_nutrition_touch(who bigint,which date) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(155::integer,who::integer);
      IF EXISTS(SELECT 1 FROM profile WHERE user_id=who AND health_nutrition_write) THEN
        INSERT INTO health_nutrition_days(user_id,day) VALUES(who,which)
        ON CONFLICT(user_id,day) DO UPDATE SET revision=nextval('health_nutrition_revision'),changed_at=now();
      END IF;
    END $$;
    CREATE FUNCTION health_nutrition_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN PERFORM health_nutrition_touch(OLD.user_id,OLD.day); END IF;
      IF TG_OP <> 'DELETE' AND (TG_OP='INSERT' OR (NEW.user_id,NEW.day) IS DISTINCT FROM (OLD.user_id,OLD.day)) THEN
        PERFORM health_nutrition_touch(NEW.user_id,NEW.day);
      END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER health_nutrition_change AFTER INSERT OR UPDATE OR DELETE ON food_entries
      FOR EACH ROW EXECUTE FUNCTION health_nutrition_changed();
""",

    # 56: optional private logging reminders; each local meal/day attempted at most once.
    """ALTER TABLE profile ADD COLUMN food_reminders boolean NOT NULL DEFAULT false;
    CREATE TABLE meal_reminder_attempts (
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day date NOT NULL,meal text NOT NULL CHECK(meal IN ('breakfast','lunch','dinner')),
      attempted_at timestamptz NOT NULL DEFAULT now(),delivered integer NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,day,meal));
    ALTER TABLE meal_reminder_attempts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON meal_reminder_attempts FOR SELECT TO fit_readers USING(user_id=fit_me());
    CREATE POLICY all_rows ON meal_reminder_attempts FOR SELECT TO fit_all_readers USING(true);
    GRANT SELECT ON meal_reminder_attempts TO fit_readers;""",

]


def migrate():
    bootstrap()
    with connect() as c:
        c.execute('CREATE TABLE IF NOT EXISTS schema_version (version int PRIMARY KEY, applied timestamptz NOT NULL DEFAULT now())')
        c.execute('LOCK TABLE schema_version')
        v = c.execute('SELECT coalesce(max(version), 0) AS v FROM schema_version').fetchone()['v']
        for i, stmt in enumerate(MIGRATIONS[v:], start=v + 1):
            c.execute(stmt)
            c.execute('INSERT INTO schema_version (version) VALUES (%s)', (i,))
        # new people and hand-entered activities default to this server's time zone (KINETTA_TZ / TZ)
        for table in ('profile', 'activities'):
            cur = c.execute("SELECT column_default FROM information_schema.columns WHERE table_name = %s AND column_name = 'tz'", (table,)).fetchone()
            if cur and cur['column_default'] and cur['column_default'].startswith(f"'{DEFAULT_TZ}'"): continue
            c.execute(sql.SQL('ALTER TABLE {} ALTER COLUMN tz SET DEFAULT {}').format(sql.Identifier(table), sql.Literal(DEFAULT_TZ)))
