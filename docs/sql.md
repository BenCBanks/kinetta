# Read-only SQL access to your own data

Kinetta keeps everything in PostgreSQL. If you enjoy SQL, each person can get a **read-only** login that sees only
their own rows. The database itself enforces that (row-level security), so a mistake can't show or change anyone
else's data.

## 1. Let your SQL tool reach the database

The database isn't reachable from outside Docker by default. Create a file called `docker-compose.override.yml`
next to `docker-compose.yml`:

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5433:5432"
```

and run `docker compose up -d`. `127.0.0.1` means "only from this computer". From another computer, use an SSH tunnel
(DBeaver, pgAdmin and DataGrip all have an *SSH* tab in the connection settings) instead of opening the port to your network.

## 2. Create the login

On the server, in the Kinetta folder (replace `sam` with the person's Kinetta username):

```sh
docker compose exec app python -m app.users sql-login sam
```

You'll be asked to type a password twice; it is never shown. The login is called `sam_sql`.

The admin can also make a login that reads **everyone's** rows with `--all-people`. Only do that if everyone on your
server knows about it.

## 3. Connect

PostgreSQL, host `127.0.0.1`, port `5433`, database `fit`, user `sam_sql`, the password you typed.

## Friendly views

Imperial and metric units included, one row per thing, and a `person` column:

| View | What's in it |
|---|---|
| `v_activities` | every activity: date, sport, distance, time, pace and grade-adjusted pace, speed, climb, heart rate, effort, route, gear |
| `v_weekly` | totals per week and sport |
| `v_best_efforts` | best efforts (400 m to marathon) with `all_time_rank` |
| `v_food_days` | calories and macros per day |
| `v_weights` | weigh-ins |
| `v_lift_sets` | every lifting set: day, session, exercise, reps, kg and lb, seconds, warm-up, estimated one-rep max |

The raw tables are there too: `activities`, `activity_streams` (per-second arrays), `best_efforts`, `routes`, `gear`,
`goals`, `food_entries`, `custom_foods`, `saved_meals`, `weights`, `exercises`, `lift_sets`.

```sql
SELECT week, miles, hours FROM v_weekly WHERE sport = 'run' ORDER BY week DESC LIMIT 12;
SELECT day, max(est_1rm_kg) FROM v_lift_sets WHERE exercise = 'Squat' AND NOT warmup GROUP BY day ORDER BY day;
```

## For the server owner: how the service is used

An all-people login (`--all-people`) can also read how the service is used, for every person. These tables and views
are hidden from ordinary members' logins. `user_id` is the common key; join to `owner_people` for names.

| Table or view | One row per | Kept |
|---|---|---|
| `owner_people` | account: `user_id`, login, name, email (and when it was confirmed), administrator, joined, unconfirmed signup, suspended | while the account exists |
| `api_requests` | API call: `user_id` (empty when not signed in), time, method, endpoint pattern such as `/api/activities/{aid}`, status code, `duration_ms`, channel (`web`, `app` or `portal`), `request_id` (the `X-Request-Id` the app was sent) | 90 days |
| `admin_login_events` | sign-in attempt: `user_id` (known accounts only), time, channel, outcome, stage | 90 days |
| `admin_account_days` | day an account opened the app: `user_id`, day (UTC) | 365 days |
| `owner_app_sessions` | signed-in phone or browser: `user_id`, signed in, last used, browser label | until it ends |
| `admin_audit` | administrator action: `actor_id`, action, target (a user id as text), time | kept |

Nothing here contains what people entered (food, routes, messages, health records): those stay in the personal tables
above, under the same rules. IP addresses are never stored in these tables.

```sql
-- busiest endpoints this week, and how slow they are
SELECT route, count(*) AS calls, round(avg(duration_ms)) AS avg_ms, count(*) FILTER (WHERE status >= 500) AS errors
FROM api_requests WHERE created > now() - interval '7 days' GROUP BY route ORDER BY calls DESC LIMIT 20;

-- each person's activity in the last 30 days
SELECT p.login,
  (SELECT count(*) FROM admin_account_days d WHERE d.user_id = p.user_id AND d.day > current_date - 30) AS active_days,
  (SELECT count(*) FROM api_requests r WHERE r.user_id = p.user_id AND r.created > now() - interval '30 days') AS api_calls,
  (SELECT max(created) FROM api_requests r WHERE r.user_id = p.user_id) AS last_call
FROM owner_people p ORDER BY api_calls DESC;
```
