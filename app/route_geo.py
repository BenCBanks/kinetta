"""Plain geometry for planned routes and segments (2026-10-26, #276/#278). Points are [lat, lon] lists everywhere here;
lines travel as Google encoded polylines (precision 5, ~1 m). Nothing here touches the database or the network."""
import math

R = 6371008.8
MAX_WAYPOINTS = 100            # #275 proposed limits: 100 waypoints, 500 km, 20,000 stored points
MAX_DISTANCE_M = 500_000
MAX_POINTS = 20_000


def encode(points):
    out, plat, plon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return ''.join(out)


def decode(s, precision=5):
    """[[lat, lon], ...] from an encoded polyline; ValueError if it is malformed."""
    pts, i, lat, lon, f = [], 0, 0, 0, 10 ** precision
    if not isinstance(s, str) or len(s) > 400_000: raise ValueError('bad line')
    while i < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                if i >= len(s): raise ValueError('bad line')
                b = ord(s[i]) - 63; i += 1
                if b < 0 or b > 63: raise ValueError('bad line')
                res |= (b & 0x1f) << shift; shift += 5
                if b < 0x20: break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]; lon += vals[1]
        pts.append([lat / f, lon / f])
    return pts


def valid(p):
    return (isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)
            and -90 <= p[0] <= 90 and -180 <= p[1] <= 180)


def dist(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, max(0.0, x))))


def length(points):
    return sum(dist(a, b) for a, b in zip(points, points[1:]))


def cumulative(points):
    out, d = [0.0], 0.0
    for a, b in zip(points, points[1:]):
        d += dist(a, b); out.append(d)
    return out


def at(points, cum, m):
    """The point m metres along the line."""
    if m <= 0: return list(points[0])
    for i in range(1, len(points)):
        if cum[i] >= m:
            span = cum[i] - cum[i - 1]; t = (m - cum[i - 1]) / span if span else 0
            a, b = points[i - 1], points[i]
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    return list(points[-1])


def resample(points, n):
    """n points evenly spaced along the line (for elevation lookups)."""
    if len(points) < 2: return [list(p) for p in points]
    cum = cumulative(points); total = cum[-1]
    if total <= 0: return [list(points[0])]
    return [at(points, cum, total * i / (n - 1)) for i in range(n)]


def slice_line(points, start_m, end_m):
    """The part of the line between two distances along it, with exact ends."""
    cum = cumulative(points)
    start_m, end_m = max(0.0, start_m), min(cum[-1], end_m)
    out = [at(points, cum, start_m)]
    out += [list(p) for p, c in zip(points, cum) if start_m < c < end_m]
    out.append(at(points, cum, end_m))
    return out


def climb(heights, threshold=3.0):
    """Ascent and descent from evenly spaced heights, ignoring wiggles under `threshold` metres (provider noise)."""
    vals = [h for h in heights if h is not None]
    if len(vals) < 2: return None, None
    up = down = 0.0; ref = vals[0]
    for h in vals[1:]:
        if h - ref >= threshold: up += h - ref; ref = h
        elif ref - h >= threshold: down += ref - h; ref = h
    return round(up, 1), round(down, 1)


def _xy(lat0):
    k = math.cos(math.radians(lat0))
    return lambda p: (p[1] * 111_320 * k, p[0] * 110_540)


def simplify(points, tol_m):
    """Douglas-Peucker in metres; keeps the first and last point."""
    if len(points) < 3: return [list(p) for p in points]
    xy = _xy(points[0][0]); P = [xy(p) for p in points]
    keep = [False] * len(points); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = P[i], P[j]
        dx, dy = x2 - x1, y2 - y1; L2 = dx * dx + dy * dy
        best, at_k = -1.0, None
        for k in range(i + 1, j):
            x, y = P[k]
            t = 0 if L2 == 0 else max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L2))
            d = math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
            if d > best: best, at_k = d, k
        if at_k is not None and best > tol_m:
            keep[at_k] = True; stack += [(i, at_k), (at_k, j)]
    return [list(p) for p, k in zip(points, keep) if k]


def to_draft(points, max_waypoints=40):
    """An imported line (GPX or an activity section) as editor waypoints + 'track' legs that keep its exact shape.
    The waypoints are the line's main corners, so a person can drag one and only that stretch is re-planned."""
    pts = [list(p) for p in points]
    tol = 15.0
    way = simplify(pts, tol)
    while len(way) > max_waypoints and tol < 5000:
        tol *= 1.6; way = simplify(pts, tol)
    idx, j = [], 0
    for w in way:   # positions of the kept corners in the original line (simplify keeps originals, in order)
        while pts[j] != w: j += 1
        idx.append(j)
    legs = [{'mode': 'track', 'line': encode(pts[a:b + 1])} for a, b in zip(idx, idx[1:])]
    return {'waypoints': [pts[i] for i in idx], 'legs': legs}


def split_gaps(lat, lon, t=None, max_gap_s=30, max_jump_m=200):
    """Recorded points as separate sections wherever the recording had a gap. Genuine gaps stay gaps (#276 item 8)."""
    out, cur, prev = [], [], None
    for i, (la, lo) in enumerate(zip(lat or [], lon or [])):
        if la is None or lo is None or not valid([la, lo]) or (la == 0 and lo == 0): continue
        p = [la, lo]
        if prev is not None:
            gap = t is not None and t[i] is not None and t[prev[1]] is not None and t[i] - t[prev[1]] > max_gap_s
            if gap or dist(prev[0], p) > max_jump_m:
                if len(cur) > 1: out.append(cur)
                cur = []
        cur.append(p); prev = (p, i)
    if len(cur) > 1: out.append(cur)
    return out
