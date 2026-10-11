"""Synthetic GPX activities for the Kinetta demo screenshots (no real data). Usage: gen_gpx.py <outdir> <days>"""
import datetime as dt, math, os, random, sys

out, days = sys.argv[1], int(sys.argv[2])
os.makedirs(out, exist_ok=True)
random.seed(7)
LAT0, LON0 = 35.1935, -80.8420          # Freedom Park, Charlotte (public park; demo screenshots, not anyone's home)
M_LAT = 111_320.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))

def loop(radius_m, n=400):               # closed loop route
    return [(LAT0 + radius_m * math.sin(2 * math.pi * i / n) / M_LAT,
             LON0 + radius_m * (1 - math.cos(2 * math.pi * i / n)) / M_LON) for i in range(n + 1)]

def outback(length_m, bearing, n=300):   # out-and-back
    pts = [(LAT0 + length_m * i / n * math.cos(bearing) / M_LAT + 15 * math.sin(i / 9) / M_LAT,
            LON0 + length_m * i / n * math.sin(bearing) / M_LON) for i in range(n + 1)]
    return pts + pts[::-1]

import json
def densify(line, step=8.0):             # the router gives corners only; a watch records every few metres
    out = [line[0]]
    for p, q in zip(line, line[1:]):
        n = max(1, int(math.hypot((q[0] - p[0]) * M_LAT, (q[1] - p[1]) * M_LON) // step))
        out += [(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n) for i in range(1, n + 1)]
    return out
# real streets and paths around Freedom Park, Charlotte (OpenStreetMap routing; route shapes (c) OpenStreetMap contributors, ODbL)
ROUTES = {k: densify(v) for k, v in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'routes.json'))).items()}

def dist(a, b): return math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON)

def write(name, sport, start, route, laps, speed_mps, hr_base, cad):
    pts = ROUTES[route] * laps
    t, rows, prev = 0.0, [], pts[0]
    for i, p in enumerate(pts):
        d = dist(prev, p); prev = p
        v = speed_mps * (1 + 0.04 * math.sin(i / 37)) * random.uniform(0.97, 1.03)
        t += d / v if v else 0
        ele = 95 + 18 * math.sin(i / 60) + 6 * math.sin(i / 13)
        hr = hr_base + 12 * (i / len(pts)) + 4 * math.sin(i / 25) + random.uniform(-2, 2)
        rows.append((p, ele, start + dt.timedelta(seconds=t), hr))
    seg = '\n'.join(f'<trkpt lat="{p[0]:.6f}" lon="{p[1]:.6f}"><ele>{e:.1f}</ele><time>{ts.strftime("%Y-%m-%dT%H:%M:%SZ")}</time>'
                    f'<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{hr:.0f}</gpxtpx:hr><gpxtpx:cad>{cad}</gpxtpx:cad>'
                    f'</gpxtpx:TrackPointExtension></extensions></trkpt>' for p, e, ts, hr in rows)
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Demo data" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>{name}</name><type>{sport}</type><trkseg>
{seg}
</trkseg></trk></gpx>'''
    fn = os.path.join(out, f'{start:%Y%m%d-%H%M}-{sport}.gpx')
    open(fn, 'w').write(xml)

today = dt.datetime.now(dt.timezone.utc).replace(hour=11, minute=0, second=0, microsecond=0)
n = 0
for k in range(days, 0, -1):
    day = today - dt.timedelta(days=k)
    fit = (days - k) / days                      # 0 -> 1 over the period: getting fitter
    wd = day.weekday()
    if wd in (0, 2, 4):                          # easy runs
        route, laps = ('park loop', 1) if wd != 2 else ('greenway', 1)
        write('Morning Run', 'running', day, route, laps, 2.9 + 0.35 * fit, 150 - 8 * fit, 84); n += 1
    if wd == 5:                                  # long run
        write('Long Run', 'running', day, 'long river', 1, 2.8 + 0.3 * fit, 148 - 6 * fit, 82); n += 1
    if wd == 1 and k % 14 < 7:                   # tempo
        write('Tempo', 'running', day + dt.timedelta(hours=10), 'greenway', 1, 3.6 + 0.3 * fit, 165 - 5 * fit, 88); n += 1
    if wd == 6:
        write('Sunday Ride', 'cycling', day + dt.timedelta(hours=2), 'bike loop', 1, 7.5 + 1.0 * fit, 132, 85); n += 1
    if wd in (1, 3):
        write('Evening Walk', 'walking', day + dt.timedelta(hours=11), 'neighborhood walk', 1, 1.45, 100, 55); n += 1
print(n, 'files')
