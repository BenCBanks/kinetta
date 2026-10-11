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
DEFAULT_TZ = _tz(os.environ.get('LANKKI_TZ')) or _tz(os.environ.get('TZ')) or 'UTC'
valid_tz = _tz

def _conninfo(user, password):
    from psycopg.conninfo import make_conninfo
    return make_conninfo(host=os.environ.get('FIT_DB_HOST', 'fit-db'), port=os.environ.get('FIT_DB_PORT', '5432'), dbname='fit',
                         user=user, password=password, application_name='lankki')


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
    # 18: beta waitlist - people ask to join from the public /beta page (only when LANKKI_BETA_SIGNUP=1); an admin
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
        # new people and hand-entered activities default to this server's time zone (LANKKI_TZ / TZ)
        for table in ('profile', 'activities'):
            cur = c.execute("SELECT column_default FROM information_schema.columns WHERE table_name = %s AND column_name = 'tz'", (table,)).fetchone()
            if cur and cur['column_default'] and cur['column_default'].startswith(f"'{DEFAULT_TZ}'"): continue
            c.execute(sql.SQL('ALTER TABLE {} ALTER COLUMN tz SET DEFAULT {}').format(sql.Identifier(table), sql.Literal(DEFAULT_TZ)))
