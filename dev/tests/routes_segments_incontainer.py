"""Planned routes, segments, leaderboards and their integrity tools (#276, #278, #285, #286; 2026-10-26).
Fictional zz_test accounts and made-up coordinates in open countryside; map services are stand-ins (no network)."""
import datetime as dt
import io
import math
import os
import unittest
import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from psycopg import errors

from app import activities, api_segments, auth, db, route_geo, route_providers, segments
from app.main import app

PW = 'test account private password'
LAT0, LON0 = 45.30, 10.20          # made-up open countryside
M_LAT = 1 / 110_540
M_LON = 1 / (111_320 * math.cos(math.radians(LAT0)))


def north(m, east=0.0): return [LAT0 + m * M_LAT, LON0 + east * M_LON]


def stand_in(url, body):
    """Map services stand-in: straight 'paths' between points (so we can test the editor contract) and flat heights."""
    if url.endswith('/route'):
        locs = body['locations']
        if any(l['lat'] > 80 for l in locs): return 400, {'error_code': 442}       # 'no path' up north
        legs = [{'shape': _enc6([[a['lat'], a['lon']], [(a['lat'] + b['lat']) / 2 + 0.0001, (a['lon'] + b['lon']) / 2], [b['lat'], b['lon']]])} for a, b in zip(locs, locs[1:])]
        return 200, {'trip': {'legs': legs}}
    if url.endswith('/height'):
        return 200, {'height': [100 + i % 3 for i, _ in enumerate(body['shape'])]}
    raise AssertionError(url)


def _enc6(points):
    out, plat, plon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * 1e6), round(lon * 1e6)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return ''.join(out)


def client(token=None):
    c = TestClient(app); c.headers['Origin'] = 'http://testserver'; c.headers['Content-Type'] = 'application/json'
    if token: c.cookies.set(auth.COOKIE, token)
    return c


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = patch.object(route_providers, '_post', side_effect=stand_in); cls.p.start()
        route_providers._cache.clear(); route_providers._people.clear()
        for g in route_providers._gates.values(): g.gap = 0
        cls.clean()
        cls.ids, cls.c = {}, {}
        with db.connect() as c:
            for name in ('ann', 'bo', 'cy', 'dee', 'admin'):
                login = 'zz_test_rs_' + name
                uid = c.execute('INSERT INTO users (login, name, pw_hash, is_admin) VALUES (%s, %s, %s, %s) RETURNING id',
                                (login, name.title(), auth.hash_pw(PW), name == 'admin')).fetchone()['id']
                c.execute('INSERT INTO profile (user_id, segment_boards) VALUES (%s, %s)', (uid, name in ('ann', 'bo', 'cy')))
                cls.ids[name] = uid; cls.c[name] = client(auth.new_session(c, uid, 'test'))

    @classmethod
    def tearDownClass(cls):
        cls.clean(); cls.p.stop()

    @staticmethod
    def clean():
        with db.connect() as c:
            ids = [r['id'] for r in c.execute("SELECT id FROM users WHERE login LIKE 'zz\\_test\\_rs\\_%%'").fetchall()]
            if ids:
                from app.api_account import erase
                for uid in ids: erase(c, {'id': uid, 'sql_role': None})
            c.execute("DELETE FROM segment_jobs WHERE kind = 'segment' AND ref NOT IN (SELECT id FROM segments)")

    def run_activity(self, who, speed, seg_len=400, lead=600, sport='run', label=None, source='track', visibility='everyone', gap_at=None, start=None, east=0.0, begin=0.0):
        """A fictional GPS recording that runs north through the test segment at `speed` m/s, one fix a second.
        gap_at: metres along it where the recording stops for two minutes (a recording gap)."""
        total = lead * 2 + seg_len
        n = int(total / speed)
        ms = [total * i / n for i in range(n + 1)]
        t = [i + (120 if gap_at and m > gap_at else 0) for i, m in enumerate(ms)]
        pts = [north(begin + m, east) for m in ms]
        st = {'t': [float(x) for x in t], 'lat': [p[0] for p in pts], 'lon': [p[1] for p in pts]}
        with db.connect() as c:
            aid = c.execute("""INSERT INTO activities (user_id, sport, sport_label, name, start_time, source, visibility, distance_m, elapsed_s)
                               VALUES (%s, %s, %s, 'Fictional run', %s, %s, %s, %s, %s) RETURNING id""",
                            (self.ids[who], sport, label, start or dt.datetime(2026, 10, 1, 8, tzinfo=dt.timezone.utc), source, visibility, total, t[-1])).fetchone()['id']
            c.execute("UPDATE activities SET segment_assistance='unassisted' WHERE id=%s",(aid,))
            c.execute('INSERT INTO activity_streams (activity_id, user_id, t, lat, lon) VALUES (%s, %s, %s, %s, %s)', (aid, self.ids[who], st['t'], st['lat'], st['lon']))
            activities.set_geometry(c, aid, st)
        return aid

    def jobs(self):
        """Finish all matching work. The server's own worker may be doing some of it at the same moment."""
        import time
        for _ in range(100):
            segments.run_jobs(50)
            with db.connect() as c:
                if not c.execute('SELECT 1 FROM segment_jobs WHERE attempts < 5 LIMIT 1').fetchone(): return
            time.sleep(0.1)
        self.fail('segment jobs did not finish')

    def segment(self, who='ann', length=400, start=600, name='Fictional hill', audience='everyone', sport='run', east=0.0):
        r = self.c[who].post('/api/segments', json={'client_id': str(uuid.uuid4()), 'name': name, 'sport': sport, 'audience': audience, 'understood_fixed': True,
                                                  'line': route_geo.encode([north(start, east), north(start + length / 2, east + 0.5), north(start + length, east)])})
        self.assertEqual(r.status_code, 200, r.text); return r.json()


class PlannedRoutes(Base):
    def test_elevation_follows_configured_routing_service(self):
        with patch.dict(os.environ, {'KINETTA_ROUTING_URL': 'https://example.test', 'KINETTA_ELEVATION_URL': ''}):
            self.assertEqual(route_providers.elevation_url(), 'https://example.test')
            with patch.dict(os.environ, {'KINETTA_ROUTING_URL': 'off'}):
                self.assertIsNone(route_providers.elevation_url())
    def test_single_use_gpx_download(self):
        from app import api_routes_plan
        way, legs = self.plan()
        route = self.c['ann'].post('/api/planned-routes', json={'client_id': str(uuid.uuid4()), 'name': 'Fictional café', 'description': 'Optional note', 'sport': 'walk', 'waypoints': way, 'legs': legs}).json()
        path = f"/api/planned-routes/{route['id']}/gpx-link"
        self.assertEqual(self.c['bo'].post(path, json={}).status_code, 404)
        self.assertEqual(client().post(path, json={}).status_code, 401)
        ticket = self.c['ann'].post(path, json={}).json()['path']
        result = client().get(ticket)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn('Fictional café', result.text)
        self.assertNotIn('Optional note', result.text)
        self.assertEqual(result.headers['cache-control'], 'no-store')
        self.assertEqual(client().get(ticket).status_code, 404, 'a Safari ticket works once')
        ticket = self.c['ann'].post(path, json={'description': True}).json()['path']
        key = ticket.rsplit('/', 1)[-1]
        with api_routes_plan._download_lock:
            old = api_routes_plan._downloads[key]; api_routes_plan._downloads[key] = (0, *old[1:])
        self.assertEqual(client().get(ticket).status_code, 404, 'expired link')
        ticket = self.c['ann'].post(path, json={}).json()['path']
        self.c['ann'].delete(f"/api/planned-routes/{route['id']}")
        self.assertEqual(client().get(ticket).status_code, 404, 'deleting the route revokes downloads')

    def plan(self, n=3):
        way = [north(i * 500) for i in range(n)]
        path = self.c['ann'].post('/api/plan/path', json={'sport': 'walk', 'points': way}).json()
        self.assertTrue(all(l['ok'] for l in path['legs']))
        return way, [{'mode': 'path', 'line': l['line']} for l in path['legs']]

    def test_draw_save_edit_copy_delete(self):
        ann, bo = self.c['ann'], self.c['bo']
        way, legs = self.plan()
        cid = str(uuid.uuid4())
        body = {'client_id': cid, 'name': 'Park loop', 'sport': 'walk', 'waypoints': way, 'legs': legs}
        r = ann.post('/api/planned-routes', json=body); self.assertEqual(r.status_code, 200, r.text); route = r.json()
        self.assertAlmostEqual(route['distance_m'], 1000, delta=15, msg='the server measures')
        self.assertIsNotNone(route['ascent_m'], 'elevation from the stand-in')
        again = ann.post('/api/planned-routes', json={**body, 'name': 'Different'}).json()
        self.assertEqual((again['id'], again['duplicate']), (route['id'], True), 'a retried save makes one route')
        # client totals are ignored; bad shapes are refused rather than trimmed
        self.assertEqual(ann.post('/api/planned-routes', json={**body, 'client_id': str(uuid.uuid4()), 'legs': legs[:1]}).status_code, 400)
        self.assertEqual(ann.post('/api/planned-routes', json={**body, 'client_id': str(uuid.uuid4()), 'waypoints': [[91, 0], [0, 0], [1, 1]]}).status_code, 400)
        far = {'mode': 'path', 'line': route_geo.encode([north(5000), north(6000)])}
        self.assertEqual(ann.post('/api/planned-routes', json={**body, 'client_id': str(uuid.uuid4()), 'legs': [far, legs[1]]}).status_code, 400, 'a line must reach its points')
        bad_manual = {'mode': 'manual', 'line': route_geo.encode([way[0], north(200, 300)])}
        self.assertEqual(ann.post('/api/planned-routes', json={**body, 'client_id': str(uuid.uuid4()), 'legs': [bad_manual, legs[1]]}).status_code, 400)
        manual = {'mode': 'manual', 'line': route_geo.encode([way[0], way[1]])}
        m = ann.post('/api/planned-routes', json={**body, 'client_id': str(uuid.uuid4()), 'name': 'With a straight bit', 'legs': [manual, legs[1]]}).json()
        self.assertEqual(m['warnings'][0]['code'], 'manual', 'straight sections are marked on the saved route')
        # edit = new version; a stale edit gets 409 instead of overwriting
        v2 = ann.put(f"/api/planned-routes/{route['id']}", json={**body, 'base_version': 1, 'name': 'Park loop 2'}).json()
        self.assertEqual(v2['version'], 2)
        stale = ann.put(f"/api/planned-routes/{route['id']}", json={**body, 'base_version': 1})
        self.assertEqual((stale.status_code, stale.json()['detail']['code']), (409, 'route_changed'))
        self.assertEqual(ann.get(f"/api/planned-routes/{route['id']}?version=1").json()['name'], 'Park loop 2', 'name is current; geometry of v1 kept')
        self.assertEqual(ann.get(f"/api/planned-routes/{route['id']}?version=1").json()['loaded_version'], 1)
        copy = ann.post(f"/api/planned-routes/{route['id']}/duplicate", json={'client_id': str(uuid.uuid4())}).json()
        self.assertNotEqual(copy['id'], route['id'])
        ann.patch(f"/api/planned-routes/{copy['id']}", json={'name': 'Only the copy'})
        self.assertEqual(ann.get(f"/api/planned-routes/{route['id']}").json()['name'], 'Park loop 2', 'copies are independent')
        # someone else can't read, edit, copy, export or delete it
        for call in (lambda: bo.get(f"/api/planned-routes/{route['id']}"), lambda: bo.put(f"/api/planned-routes/{route['id']}", json=body),
                     lambda: bo.post(f"/api/planned-routes/{route['id']}/duplicate", json={'client_id': str(uuid.uuid4())}),
                     lambda: bo.get(f"/api/planned-routes/{route['id']}/gpx"), lambda: bo.delete(f"/api/planned-routes/{route['id']}")):
            self.assertEqual(call().status_code, 404)
        self.assertNotIn(route['id'], [r['id'] for r in bo.get('/api/planned-routes').json()])
        self.assertEqual([r['name'] for r in ann.get('/api/planned-routes?q=only').json()], ['Only the copy'])
        # planning adds no activity, totals or segment
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM activities WHERE user_id = %s', (self.ids['ann'],)).fetchone()['n'], 0)
        gpx = ann.get(f"/api/planned-routes/{route['id']}/gpx").text
        self.assertIn('<trkpt', gpx); self.assertNotIn('<time', gpx); self.assertNotIn('zz_test', gpx)
        self.assertEqual(ann.delete(f"/api/planned-routes/{route['id']}").status_code, 200)
        self.assertEqual(ann.get(f"/api/planned-routes/{route['id']}").status_code, 404)

    def test_paths_failures_and_drafts(self):
        ann, bo = self.c['ann'], self.c['bo']
        r = ann.post('/api/plan/path', json={'sport': 'ride', 'points': [north(0), [85.0, 10.0], north(500)]}).json()
        self.assertEqual([l['ok'] for l in r['legs']], [False, False], 'no path: reported per connection, nothing invented')
        with patch.object(route_providers, '_post', side_effect=route_providers.Unavailable('Map services are busy. Your route is kept; try again.')):
            route_providers._cache.clear()
            r = ann.post('/api/plan/path', json={'sport': 'run', 'points': [north(10), north(20)]})
            self.assertEqual((r.status_code, r.json()['detail']['code']), (503, 'provider_unavailable'))
        self.assertEqual(ann.put('/api/route-drafts/new', json={'data': {'waypoints': [north(0)]}}).status_code, 200)
        self.assertEqual(ann.get('/api/route-drafts/new').json()['data']['waypoints'], [north(0)])
        self.assertIsNone(bo.get('/api/route-drafts/new').json()['data'], 'drafts are per person')
        self.assertEqual(ann.put('/api/route-drafts/BAD%20KEY', json={'data': {}}).status_code, 422)

    def test_gpx_import_and_activity(self):
        ann, bo = self.c['ann'], self.c['bo']
        trk = ''.join(f'<trkpt lat="{p[0]}" lon="{p[1]}"><time>2026-10-01T08:00:{i:02d}Z</time></trkpt>' for i, p in enumerate([north(i * 50) for i in range(40)]))
        two = f'<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>A</name><trkseg>{trk}</trkseg><trkseg>{trk}</trkseg></trk></gpx>'
        r = ann.post('/api/planned-routes/import', json={'gpx': two}).json()
        self.assertEqual(len(r['tracks']), 2, 'separate track sections stay separate')
        t = r['tracks'][0]; self.assertAlmostEqual(t['distance_m'], 1950, delta=25); self.assertNotIn('time', str(t))
        for bad in (b'not xml', b'<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>', b'<gpx><trk><trkseg><trkpt lat="99" lon="0"/><trkpt lat="1" lon="1"/></trkseg></trk></gpx>', b'<gpx></gpx>'):
            self.assertEqual(ann.post('/api/planned-routes/import', json={'gpx': bad.decode()}).status_code, 400, bad)
        self.assertEqual(ann.post('/api/planned-routes/import', json={'gpx': 'x' * (5 * 1024 * 1024 + 10)}).status_code, 422, 'over 5 MB')
        aid = self.run_activity('ann', 3.0, gap_at=800)
        secs = ann.get(f'/api/activities/{aid}/sections').json()['sections']
        self.assertEqual(len(secs), 2, 'a recording gap splits sections; they are never joined')
        d = ann.post('/api/planned-routes/from-activity', json={'activity_id': aid, 'section': 0, 'start_m': 100, 'end_m': 500}).json()
        self.assertAlmostEqual(d['distance_m'], 400, delta=5)
        self.assertEqual(bo.get(f'/api/activities/{aid}/sections').status_code, 404)
        self.assertEqual(bo.post('/api/planned-routes/from-activity', json={'activity_id': aid, 'section': 0, 'start_m': 100, 'end_m': 500}).status_code, 404)


class Matching(unittest.TestCase):
    """The matcher on its own, with fictional recordings along a 1 km course heading north."""
    seg = [north(0), north(1000)]

    def rec(self, speed=4.0, hz=1.0, east=0.0, path=None, gap=None):
        path = path or [(m, east) for m in [-100 + i * speed / hz for i in range(int(1200 / speed * hz) + 1)]]
        t = [i / hz + (120 if gap and m > gap else 0) for i, (m, _) in enumerate(path)]
        pts = [north(m, e) for m, e in path]
        return t, [p[0] for p in pts], [p[1] for p in pts]

    def test_complete_pass_interpolates_the_crossings(self):
        p, why = segments.match(self.seg, 'run', *self.rec(4.0))
        self.assertEqual(len(p), 1, why); self.assertAlmostEqual(p[0]['elapsed_raw'], 250, delta=0.6); self.assertEqual(p[0]['elapsed_s'], 250)
        p, _ = segments.match(self.seg, 'run', *self.rec(4.0, hz=0.25))      # a fix every 4 s: still the right time
        self.assertAlmostEqual(p[0]['elapsed_raw'], 250, delta=1.0)

    def test_rejections(self):
        rev = [(1100 - i * 4, 0) for i in range(301)]
        self.assertEqual(segments.match(self.seg, 'run', *self.rec(path=rev))[0], [], 'reverse direction')
        self.assertEqual(segments.match(self.seg, 'run', *self.rec(east=60))[0], [], 'a parallel road 60 m away')
        short = [(m, 0) for m in range(-100, 400, 4)] + [(400 + i * 4, min(70, i * 8)) for i in range(50)] + [(m, 0) for m in range(600, 1101, 4)]
        p, why = segments.match(self.seg, 'run', *self.rec(path=short))
        self.assertEqual((p, why), ([], 'left_course'), 'a shortcut off the course')
        p, why = segments.match(self.seg, 'run', *self.rec(gap=500))
        self.assertEqual((p, why), ([], 'gap'))
        p, why = segments.match(self.seg, 'run', *self.rec(4.0, hz=1 / 30))
        self.assertEqual(p, [], 'too sparse to be sure')
        stop = [(m, 0) for m in range(-100, 1101, 4)]
        p, _ = segments.match(self.seg, 'run', *self.rec(path=stop[:150] + [stop[150]] * 200 + stop[150:]))
        self.assertGreaterEqual(p[0]['elapsed_s'], 449, 'elapsed time: stopping never helps')

    def test_switchback_and_repeats(self):
        # a zig-zag course: legs 25 m apart. Cutting straight up the middle is not a pass.
        zig = [north(0, 0)]
        for k in range(1, 7): zig.append(north(k * 25, 200 if k % 2 else 0))
        walk = []
        for a, b in zip(zig, zig[1:]):
            n = 25
            for i in range(n): walk.append([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n])
        lead = [north(-30 + i * 3, 0) for i in range(10)]
        tail = [[zig[-1][0] + 3 * i * M_LAT, zig[-1][1]] for i in range(1, 12)]
        full = lead + walk + tail
        t = [i * 3.0 for i in range(len(full))]
        p, why = segments.match(zig, 'hike', t, [q[0] for q in full], [q[1] for q in full])
        self.assertEqual(len(p), 1, why)
        cut = lead + [north(i * 3, 0) for i in range(60)] + tail
        p, why = segments.match(zig, 'hike', [i * 3.0 for i in range(len(cut))], [q[0] for q in cut], [q[1] for q in cut])
        self.assertEqual(p, [], 'straight up the middle of a switchback')
        laps = [(m, 0) for m in range(-100, 1101, 4)] + [(1100 - i * 4, 30) for i in range(301)] + [(m, 0) for m in range(-100, 1101, 4)]
        p, _ = segments.match(self.seg, 'run', *self.rec(path=laps))
        self.assertEqual(len(p), 2, 'two genuine passes, never overlapping'); self.assertLess(p[0]['end_i'], p[1]['start_i'])

    def test_checks(self):
        self.assertEqual(segments.sport_fit('run', 'walk'), 'wrong_sport')
        self.assertEqual(segments.sport_fit('ride', 'ride', 'E-Bike Ride'), 'assisted')
        self.assertIsNone(segments.sport_fit('ride', 'ride', 'Road'))
        t, la, lo = self.rec(4.0); la[150] += 300 * M_LAT
        p, _ = segments.match(self.seg, 'run', t, la, lo)
        self.assertTrue(not p or p[0]['state'] == 'held', 'a vehicle-speed jump is held, never published')
        p, _ = segments.match(self.seg, 'run', *self.rec(9.5))
        self.assertEqual((p[0]['state'], p[0]['reason']), ('held', 'fast'), 'faster than plausible: held for review')
        self.assertEqual(segments.check_path([north(0), north(50)]), ['Segments must be at least 100 m long.'])
        self.assertTrue(segments.check_path([north(0), north(300), north(0, 20)]), 'out-and-back over itself')
        self.assertEqual(segments.check_path([north(0), north(400)]), [])


class Segments(Base):
    def test_create_is_frozen_everywhere(self):
        s = self.segment(name='Frozen hill')
        self.assertEqual(self.c['ann'].post('/api/segments', json={'client_id': str(uuid.uuid4()), 'name': 'x', 'sport': 'run', 'audience': 'me',
                                                                   'line': route_geo.encode([north(0), north(50)])}).status_code, 422, 'must acknowledge')
        with db.connect() as c:
            for sql in ("UPDATE segments SET name = 'Shorter hill' WHERE id = %s", "UPDATE segments SET description = 'x' WHERE id = %s",
                        "UPDATE segments SET sport = 'ride' WHERE id = %s", "UPDATE segments SET geom = ST_Reverse(geom) WHERE id = %s",
                        "UPDATE segments SET distance_m = 1 WHERE id = %s", "UPDATE segments SET audience = 'me' WHERE id = %s",
                        "UPDATE segments SET creator_id = %s WHERE id = %%s" % self.ids['bo'], "DELETE FROM segments WHERE id = %s"):
                with self.assertRaises(errors.CheckViolation, msg=sql):
                    with c.transaction(): c.execute(sql, (s['id'],))
        # no endpoint edits it either (none exists); a different course is a new ID with no times
        self.assertEqual(self.c['ann'].patch(f"/api/segments/{s['id']}", json={'name': 'x'}).status_code, 405)
        # private -> everyone is one way; retired is never reopened
        p = self.segment(name='Private hill', audience='me')
        self.assertEqual(self.c['bo'].get(f"/api/segments/{p['id']}").status_code, 404, 'private segments are private')
        self.assertEqual(self.c['ann'].post(f"/api/segments/{p['id']}/publish", json={'understood_public': True}).json()['audience'], 'everyone')
        self.assertEqual(self.c['bo'].get(f"/api/segments/{p['id']}").status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE segments SET status = 'retired', status_reason = 'Fictional duplicate' WHERE id = %s", (p['id'],))
            with self.assertRaises(errors.CheckViolation):
                with c.transaction(): c.execute("UPDATE segments SET status = 'active' WHERE id = %s", (p['id'],))
            api_segments.take_down(c, [p['id']], 'Fictional takedown')
            r = c.execute('SELECT name, geom, creator_id, status FROM segments WHERE id = %s', (p['id'],)).fetchone()
            self.assertEqual((r['name'], r['geom'], r['creator_id'], r['status']), (None, None, None, 'removed'), 'a tombstone only')
            with self.assertRaises(errors.CheckViolation):
                with c.transaction(): c.execute("UPDATE segments SET status = 'active' WHERE id = %s", (p['id'],))
        self.assertEqual(self.c['ann'].get(f"/api/segments/{p['id']}").status_code, 410)

    def test_from_activity_respects_hidden_ends(self):
        aid = self.run_activity('ann', 4.0)
        near = self.c['ann'].post('/api/segments/check', json={'sport': 'run', 'activity': {'activity_id': aid, 'section': 0, 'start_m': 100, 'end_m': 700}})
        self.assertEqual((near.status_code, near.json()['detail']['code']), (400, 'hidden_area'))
        ok = self.c['ann'].post('/api/segments/check', json={'sport': 'run', 'activity': {'activity_id': aid, 'section': 0, 'start_m': 600, 'end_m': 1000}}).json()
        self.assertAlmostEqual(ok['distance_m'], 400, delta=3); self.assertEqual(ok['problems'], [])
        self.assertEqual(self.c['bo'].post('/api/segments/check', json={'sport': 'run', 'activity': {'activity_id': aid, 'section': 0, 'start_m': 600, 'end_m': 1000}}).status_code, 404)

    def test_leaderboard_ties_withdrawal_and_privacy(self):
        E = 2000.0          # its own hill, away from the other tests' recordings
        s = self.segment(name='Tie hill', east=E)
        a1 = self.run_activity('ann', 400 / 80, east=E); self.run_activity('bo', 400 / 80, east=E); self.run_activity('cy', 400 / 83, east=E)
        priv = self.run_activity('dee', 400 / 60, east=E)              # dee hasn't joined: never public
        self.jobs()
        board = self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()
        self.assertEqual([(r['rank'], r['elapsed_s']) for r in board['rows']], [(1, 80), (1, 80), (3, 83)], 'competition ranking')
        self.assertTrue(all(r['leader'] for r in board['rows'][:2]), 'joint leaders')
        self.assertNotIn('zz_test_rs_dee', [r['login'] for r in board['rows']])
        dee = self.c['dee'].get(f"/api/segments/{s['id']}/leaderboard").json()['me']
        self.assertEqual((dee['private_best'], dee['rank'], dee['why_not']), (60, None, 'not_joined'), 'private best, honest reason')
        self.assertNotIn('heart', str(board).lower()); self.assertNotIn('start_time', str(board))
        # ann improves: still one row
        self.run_activity('ann', 400 / 78, start=dt.datetime(2026, 10, 2, 8, tzinfo=dt.timezone.utc), east=E); self.jobs()
        rows = self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']
        self.assertEqual([(r['login'][11:], r['rank'], r['elapsed_s']) for r in rows], [('ann', 1, 78), ('bo', 2, 80), ('cy', 3, 83)])
        # making the 78 private withdraws it at once; the 80 takes over
        with db.connect() as c:
            best = c.execute("SELECT activity_id FROM segment_efforts WHERE segment_id = %s AND user_id = %s AND elapsed_s = 78", (s['id'], self.ids['ann'])).fetchone()['activity_id']
            c.execute("UPDATE activities SET visibility = 'friends' WHERE id = %s", (best,))
        rows = self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']
        self.assertEqual(sorted((r['login'][11:], r['rank'], r['elapsed_s']) for r in rows), [('ann', 1, 80), ('bo', 1, 80), ('cy', 3, 83)], 'tie order is neutral')
        # per-activity exclusion, leaving, blocking, unconfirmed and a moderator hold all withdraw immediately
        self.c['ann'].put(f'/api/activities/{a1}/leaderboards', json={'excluded': True})
        self.assertNotIn('zz_test_rs_ann', [r['login'] for r in self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']])
        self.c['ann'].put(f'/api/activities/{a1}/leaderboards', json={'excluded': False})
        self.c['bo'].put('/api/segment-settings', json={'joined': False})
        self.assertNotIn('zz_test_rs_bo', [r['login'] for r in self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']])
        self.c['bo'].put('/api/segment-settings', json={'joined': True})
        self.c['cy'].post('/api/people/zz_test_rs_ann/block')
        r = self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()
        self.assertEqual([(x['login'][11:], x['rank']) for x in r['rows']], [('bo', 1), ('cy', 2)], 'ranks recomputed over what you can see')
        self.assertTrue(r['scope'])
        self.assertEqual(self.c['ann'].get(f"/api/segments/{s['id']}/leaderboard").json()['count'], 2, 'blocks work both ways')
        self.c['cy'].delete('/api/people/zz_test_rs_ann/block')
        # garmin-sourced and hidden-area passes stay private
        g = self.run_activity('cy', 400 / 70, source='garmin_connect', east=E); h = self.run_activity('cy', 400 / 65, begin=300, lead=300, east=E); self.jobs()   # h starts 300 m before the segment: inside the hidden 400 m
        mine = self.c['cy'].get(f"/api/segments/{s['id']}/efforts").json()['efforts']
        why = {e['activity_id']: e['why_not'] for e in mine}
        self.assertEqual((why[g], why[h]), ('source', 'hidden_area'))
        self.assertEqual(self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()['me']['public_best'], 83)
        # tie-aware pages: same seconds across a page boundary keep their rank and nobody repeats
        with patch.object(api_segments, 'PAGE', 1):
            seen, after = [], None
            while True:
                r = self.c['dee'].get(f"/api/segments/{s['id']}/leaderboard" + (f'?after={after}' if after else '')).json()
                seen += [(x['login'], x['rank']) for x in r['rows']]
                if not r['next']: break
                after = r['next']
        self.assertEqual(sorted(x[1] for x in seen), [1, 1, 3]); self.assertEqual(len(set(seen)), 3)
        # the kill switch hides every board, personal times stay
        with db.connect() as c: c.execute("INSERT INTO feature_switches (name, enabled) VALUES ('leaderboards', false) ON CONFLICT (name) DO UPDATE SET enabled = false")
        r = self.c['cy'].get(f"/api/segments/{s['id']}/leaderboard").json()
        self.assertEqual((r['paused'], r['rows']), (True, []))
        self.assertTrue(self.c['cy'].get(f"/api/segments/{s['id']}/efforts").json()['efforts'])
        with db.connect() as c: c.execute("DELETE FROM feature_switches WHERE name = 'leaderboards'")

    def test_phone_and_watch_copies_count_once(self):
        E = 4000.0
        s = self.segment(name='Copy hill', east=E)
        day = dt.datetime(2026, 10, 3, 8, tzinfo=dt.timezone.utc)
        a = self.run_activity('bo', 400 / 90, start=day, east=E)
        b = self.run_activity('bo', 400 / 90, start=day + dt.timedelta(seconds=4), source='healthkit', east=E)    # the watch's copy
        c2 = self.run_activity('bo', 400 / 95, start=day + dt.timedelta(minutes=1), east=E)                      # a genuinely separate run
        self.jobs()
        mine = {e['activity_id']: (e['state'], e['reason']) for e in self.c['bo'].get(f"/api/segments/{s['id']}/efforts").json()['efforts']}
        self.assertEqual(mine[b], ('excluded', 'duplicate'), 'the later copy is a duplicate')
        self.assertEqual((mine[a][0], mine[c2][0]), ('ok', 'ok'), 'separate runs both count')
        rows = self.c['ann'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']
        self.assertEqual([(r['login'][11:], r['elapsed_s']) for r in rows], [('bo', 90)], 'one row, best time')

    def test_other_sports_and_reports(self):
        s = self.segment(name='Ride hill', sport='ride')
        self.run_activity('ann', 400 / 40, sport='ride', label='E-Bike Ride'); self.run_activity('bo', 400 / 40, sport='run'); self.run_activity('cy', 400 / 45, sport='ride')
        self.jobs()
        rows = self.c['ann'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']
        self.assertEqual([r['login'][11:] for r in rows], ['cy'], 'assisted and other sports never rank')
        r = self.c['ann'].post(f"/api/segments/{s['id']}/report", json={'reason': 'gps', 'login': 'zz_test_rs_cy', 'note': 'Fictional'})
        self.assertEqual(r.status_code, 200); self.assertTrue(self.c['ann'].post(f"/api/segments/{s['id']}/report", json={'reason': 'gps', 'login': 'zz_test_rs_cy'}).json().get('already'))
        self.assertEqual(self.c['ann'].post(f"/api/segments/{s['id']}/report", json={'reason': 'gps', 'login': 'zz_test_rs_dee'}).status_code, 404, 'only a visible row')
        self.assertEqual([x['login'][11:] for x in self.c['bo'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']], ['cy'], 'a report removes nothing')
        self.assertEqual(self.c['bo'].post(f"/api/segments/{s['id']}/report", json={'reason': 'creator_request'}).status_code, 400, 'only the creator asks to retire')
        with db.connect() as c:
            e = c.execute('SELECT id, rev FROM segment_efforts WHERE segment_id = %s AND user_id = %s', (s['id'], self.ids['cy'])).fetchone()
            rep = c.execute('SELECT id, reporter FROM segment_reports WHERE segment_id = %s', (s['id'],)).fetchone()
        decide = api_segments.decide
        admin = {'id': self.ids['admin']}
        decide(e['id'], api_segments.DecideIn(action='exclude', reason='Fictional GPS error', rev=e['rev'], report_id=rep['id']), user=admin)
        self.assertEqual(self.c['ann'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows'], [], 'excluded with a reason')
        with self.assertRaises(Exception) as stale:
            decide(e['id'], api_segments.DecideIn(action='restore', reason='Old view', rev=e['rev']), user=admin)
        self.assertEqual(getattr(stale.exception, 'status_code', None), 409, 'a stale decision cannot overwrite a newer one')
        mine = self.c['cy'].get(f"/api/segments/{s['id']}/efforts").json()['efforts'][0]
        self.assertEqual((mine['why_not'], mine['reason']), ('excluded', 'Fictional GPS error'))
        self.assertNotIn('zz_test_rs_ann', str(self.c['cy'].get(f"/api/segments/{s['id']}/efforts").json()), 'the reporter stays anonymous')
        self.assertEqual(self.c['cy'].post(f"/api/segment-efforts/{mine['id']}/appeal", json={'note': 'Fictional tunnel'}).status_code, 200)
        self.assertEqual(self.c['cy'].post(f"/api/segment-efforts/{mine['id']}/appeal", json={'note': 'Again'}).status_code, 409)
        self.assertEqual(self.c['ann'].post(f"/api/segment-efforts/{mine['id']}/appeal", json={'note': 'Not mine'}).status_code, 404)
        decide(e['id'], api_segments.DecideIn(action='restore', reason='Checked: fine', rev=mine['rev']), user=admin)
        self.assertEqual([x['login'][11:] for x in self.c['ann'].get(f"/api/segments/{s['id']}/leaderboard").json()['rows']], ['cy'])

    def test_deleting_accounts_and_activities(self):
        s = self.segment('dee', name='Dee hill')
        aid = self.run_activity('ann', 400 / 80); self.jobs()
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM segment_efforts WHERE segment_id = %s', (s['id'],)).fetchone()['n'], 1)
            from app.api_account import erase
            erase(c, {'id': self.ids['dee'], 'sql_role': None})
            r = c.execute('SELECT name, geom, status FROM segments WHERE id = %s', (s['id'],)).fetchone()
            self.assertEqual((r['name'], r['geom'], r['status']), (None, None, 'removed'), 'the creator leaving takes the public course down')
            self.assertTrue(c.execute('SELECT 1 FROM activities WHERE id = %s', (aid,)).fetchone(), 'other people keep their workouts')
            self.assertEqual(c.execute('SELECT count(*) AS n FROM segment_efforts WHERE segment_id = %s', (s['id'],)).fetchone()['n'], 0)
        with db.connect() as c:
            uid = c.execute("INSERT INTO users (login, name, pw_hash) VALUES ('zz_test_rs_dee', 'Dee', %s) RETURNING id", (auth.hash_pw(PW),)).fetchone()['id']
            c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,)); self.ids['dee'] = uid; self.c['dee'] = client(auth.new_session(c, uid, 'test'))
        s2 = self.segment(name='Ann hill 2'); self.jobs()
        self.assertEqual(self.c['ann'].delete(f'/api/activities/{aid}').status_code, 200)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM segment_efforts WHERE activity_id = %s', (aid,)).fetchone()['n'], 0, 'deleting an activity removes its times')
        exp = self.c['ann'].get('/api/account/export')
        self.assertEqual(exp.status_code, 200)

    def test_admin_cases_scope_stale_actions_and_receipts(self):
        from app import admin_auth
        admin = client()
        with db.connect() as c: token = admin_auth.issue_session(c, self.ids['admin'])
        admin.cookies.set(admin_auth.COOKIE, token, path='/api')
        admin.headers['X-Admin-CSRF'] = admin_auth.csrf(token)
        s = self.segment(name='Admin case hill', east=6000)
        self.run_activity('bo', 4, east=6000); self.jobs()
        with db.connect() as c:
            e = c.execute('SELECT id, rev FROM segment_efforts WHERE segment_id = %s AND user_id = %s', (s['id'], self.ids['bo'])).fetchone()
        ep = f"/api/admin/segment-efforts/{e['id']}"
        self.assertEqual(self.c['admin'].get('/api/admin/segments').status_code, 403, 'ordinary admin app login never elevates')
        self.assertEqual(self.c['bo'].get('/api/admin/segments').status_code, 403)
        self.assertEqual(admin.get(ep).status_code, 404, 'no open case: no private history by ID')
        report = self.c['ann'].post(f"/api/segments/{s['id']}/report", json={'reason': 'gps', 'login': 'zz_test_rs_bo', 'note': 'Fictional GPS case'}).json()['id']
        course_report = self.c['cy'].post(f"/api/segments/{s['id']}/report", json={'reason': 'unsafe', 'note': 'Fictional access case'}).json()['id']
        evidence = admin.get(ep).json()
        self.assertIn('fixes', evidence)
        for key in ('lat', 'lon', 'heart_rate', 'streams', 'geom'): self.assertNotIn(key, evidence)
        body = {'action': 'exclude', 'reason': 'Reviewed fictional GPS error', 'rev': e['rev'], 'report_id': course_report}
        self.assertEqual(admin.post(ep+'/decide', json=body).status_code, 409, 'cannot close a different case')
        body['report_id'] = report
        self.assertEqual(admin.post(ep+'/decide', json=body).status_code, 200)
        self.assertEqual(admin.post(ep+'/decide', json=body).status_code, 409, 'lost response retry cannot act again')
        self.c['bo'].post(f"/api/segment-efforts/{e['id']}/appeal", json={'note': 'Fictional review request'})
        cases = admin.get('/api/admin/segments').json(); appeal = next(a for a in cases['appeals'] if a['effort_id'] == e['id'])
        evidence = admin.get(ep).json()
        uphold = f"/api/admin/segment-appeals/{appeal['id']}/uphold"
        self.assertEqual(admin.post(uphold, json={'outcome': 'Old fictional review', 'rev': e['rev']}).status_code, 409)
        self.assertEqual(self.c['bo'].post(f"/api/segment-efforts/{e['id']}/appeal", json={'note': '   '}).status_code, 400)
        self.assertEqual(admin.post(uphold, json={'outcome': 'Reviewed current fictional decision', 'rev': evidence['rev']}).status_code, 200)
        self.assertEqual(admin.post(uphold, json={'outcome': 'Repeated fictional closure', 'rev': evidence['rev']}).status_code, 409)
        self.c['bo'].post(f"/api/segment-efforts/{e['id']}/appeal", json={'note': 'Additional fictional evidence'})
        cases = admin.get('/api/admin/segments').json(); appeal = next(a for a in cases['appeals'] if a['effort_id'] == e['id'])
        uphold = f"/api/admin/segment-appeals/{appeal['id']}/uphold"
        body = {'action': 'restore', 'reason': 'Reviewed valid fictional recording', 'rev': evidence['rev'], 'appeal_id': appeal['id']}
        self.assertEqual(admin.post(ep+'/decide', json=body).status_code, 200)
        self.assertEqual(admin.post(uphold, json={'outcome': 'Stale fictional review', 'rev': evidence['rev']}).status_code, 409)
        self.assertEqual(admin.get(ep).status_code, 404, 'closed case no longer browsable')
        switch = '/api/admin/segments/leaderboards'
        self.assertEqual(admin.put(switch, json={'enabled': False, 'expected': True}).status_code, 200)
        self.assertEqual(admin.put(switch, json={'enabled': False, 'expected': True}).status_code, 409)
        self.assertEqual(admin.put(switch, json={'enabled': True, 'expected': False}).status_code, 200)
        retire = {'kind': 'retire', 'reason': 'Fictional restricted access', 'expected_status': 'active', 'report_id': course_report}
        self.assertEqual(admin.post(f"/api/admin/segments/{s['id']}/retire", json=retire).status_code, 200)
        public = self.c['ann'].get(f"/api/segments/{s['id']}").json()
        self.assertNotIn(retire['reason'], str(public), 'private moderator case details stay off public course status')
        self.assertEqual(admin.post(f"/api/admin/segments/{s['id']}/retire", json=retire).status_code, 409)
        with db.connect() as c:
            receipts = c.execute('SELECT action, reason, reviewed_rev FROM segment_decisions WHERE target_kind = %s AND target_id = %s ORDER BY id', ('effort', e['id'])).fetchall()
            self.assertEqual([r['action'] for r in receipts], ['exclude', 'restore'])
            self.assertTrue(all(r['reason'] and r['reviewed_rev'] for r in receipts))
            c.execute("DELETE FROM feature_switches WHERE name = 'leaderboards'")

    def test_rls_and_grants(self):
        with db.connect() as c:
            for t in ('planned_routes', 'planned_route_versions', 'route_drafts', 'segments', 'segment_drafts', 'segment_bookmarks', 'segment_efforts', 'segment_scans', 'segment_appeals'):
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname = %s', (t,)).fetchone()['relrowsecurity'], t)
                self.assertTrue(c.execute("SELECT 1 FROM pg_policies WHERE tablename = %s AND policyname = 'own_rows'", (t,)).fetchone(), t)
            for t in ('segment_reports', 'segment_jobs', 'segment_decisions', 'feature_switches'):
                self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers', %s, 'SELECT') AS p", (t,)).fetchone()['p'], t)
        from app.api_mydata import TABLES
        for t in ('planned_routes', 'planned_route_versions', 'segment_efforts', 'segments_created', 'segment_bookmarks'): self.assertIn(t, TABLES)


if __name__ == '__main__':
    unittest.main(argv=['x', '-v'], exit=True)
