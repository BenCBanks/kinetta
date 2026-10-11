# Demo data

A made-up runner, **Alex** (username `alex`, password `blue kettle morning run`), with about 120 days of runs, rides and
walks around Freedom Park in Charlotte, NC, four weeks of food log, weigh-ins and a 10K plan. Use it for screenshots and
testing. **Only ever load it into a throwaway install**, never one with real people on it: it creates the first
(admin) account.

```sh
# 1. a fresh, throwaway Kinetta on port 8798
KINETTA_PORT=8798 TZ=America/New_York docker compose -p kinettademo up -d --build
# 2. make the activities (GPX files) and load everything
python3 dev/demo/gen_gpx.py /tmp/kinetta-demo-gpx 120
KINETTA_URL=http://localhost:8798 python3 dev/demo/seed.py /tmp/kinetta-demo-gpx
# 3. open http://localhost:8798 and log in as alex
# 4. remove it all afterwards
docker compose -p kinettademo down -v
```

Route shapes in `routes.json` come from OpenStreetMap routing: © OpenStreetMap contributors, available under the
[Open Database License](https://www.openstreetmap.org/copyright).
