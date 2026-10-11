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

The raw tables are there too: `activities`, `activity_streams` (per-second arrays), `best_efforts`, `routes`, `gear`,
`goals`, `food_entries`, `custom_foods`, `saved_meals`, `weights`.

```sql
SELECT week, miles, hours FROM v_weekly WHERE sport = 'run' ORDER BY week DESC LIMIT 12;
```
