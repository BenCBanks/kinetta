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

`photos/` holds three photos of Freedom Park and the Little Sugar Creek Greenway (where the demo routes run), from
Wikimedia Commons, used as activity photos in the screenshots (`dev/screenshots/stage.py` adds them). They keep their own
licenses, not Kinetta's:

| File | Photo | By | License |
|---|---|---|---|
| `freedom-park-lake.jpg` | [Freedom Park, Charlotte](https://commons.wikimedia.org/wiki/File:Freedom_Park,_Charlotte_-_panoramio.jpg) | James Willamor | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `freedom-park-bridge.jpg` | [Freedom Park, Charlotte](https://commons.wikimedia.org/wiki/File:Freedom_Park,_Charlotte_-_panoramio_-_James_Willamor.jpg) | James Willamor | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `sugar-creek-greenway.jpg` | [Little Sugar Creek Greenway near 18th St](https://commons.wikimedia.org/wiki/File:Little_Sugar_Creek_Greenway_near_18th_St_Late_March_2024.jpg) | City Dweller 2 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |

All three are the 960 px wide versions Commons serves, otherwise unchanged.
