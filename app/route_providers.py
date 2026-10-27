"""Map services for the route planner (#275 decision, 2026-10-26; docs/routes.md has the comparison and rights notes).

- Paths that follow streets and trails: Valhalla (MIT engine, OpenStreetMap data, ODbL). Default server: the public
  FOSSGIS instance (fair use: about one request a second, no bulk use). KINETTA_ROUTING_URL points at your own Valhalla
  instead; "off" prevents creating or replanning routes until routing is configured.
- Heights: the same Valhalla server's /height (SRTM-derived). KINETTA_ELEVATION_URL overrides; "off" leaves climb unknown.
- Place search: Nominatim (OpenStreetMap). Searched only when someone presses Search, never while typing (its policy
  forbids autocomplete). KINETTA_GEOCODER_URL overrides; "off" hides search.

Every request goes from this server, never from the phone: providers see coordinates or the typed place name and
nothing else (no account, IP, times, health data or history). Requests are spaced out and cached so one busy planner
can't break a provider's fair-use limit, and each person has their own allowance.
"""
import json
import os
import threading
import time
from collections import OrderedDict, defaultdict, deque

import httpx

from . import route_geo

UA = 'Kinetta route planner (+https://kinetta.app; self-hosted fitness app)'
DEFAULT_ROUTING = 'https://valhalla1.openstreetmap.de'
DEFAULT_GEOCODER = 'https://nominatim.openstreetmap.org'
TIMEOUT = 8.0
WAIT_MAX = 6.0                 # longest a request queues for its turn before we say "busy, try again"
PER_PERSON = (90, 300)         # at most 90 provider calls per person per 5 minutes

# Run, Walk and Hike share Valhalla's walking costing with different trail tolerance (SAC scale): walks keep to easy
# paths, hikes may use mountain trails. Rides use bicycle costing, which respects one-way streets and bike access.
COSTING = {
    'run': ('pedestrian', {'max_hiking_difficulty': 2, 'use_tracks': 0.5}),
    'walk': ('pedestrian', {'max_hiking_difficulty': 1}),
    'hike': ('pedestrian', {'max_hiking_difficulty': 5, 'use_tracks': 1.0}),
    'ride': ('bicycle', {'bicycle_type': 'Hybrid', 'use_roads': 0.4}),
}


class Unavailable(Exception):
    """The provider is off, down, slow or busy. The message is safe to show."""


def _url(name, default):
    v = (os.environ.get(name) or default).strip().rstrip('/')
    return None if v.lower() in ('', 'off', 'none', 'false', '0') else v


def routing_url(): return _url('KINETTA_ROUTING_URL', DEFAULT_ROUTING)
def elevation_url(): return _url('KINETTA_ELEVATION_URL', routing_url() or 'off')
def geocoder_url(): return _url('KINETTA_GEOCODER_URL', DEFAULT_GEOCODER)


def status():
    return {'paths': bool(routing_url()), 'elevation': bool(elevation_url()), 'search': bool(geocoder_url())}


class _Gate:
    """One request at a time per provider, at least `gap` seconds apart."""
    def __init__(self, gap): self.gap, self.lock, self.last = gap, threading.Lock(), 0.0

    def __enter__(self):
        if not self.lock.acquire(timeout=WAIT_MAX): raise Unavailable('Map services are busy. Try again in a moment.')
        wait = self.last + self.gap - time.monotonic()
        if wait > 0: time.sleep(wait)
        return self

    def __exit__(self, *a):
        self.last = time.monotonic(); self.lock.release()


_gates = {'route': _Gate(float(os.environ.get('KINETTA_ROUTING_GAP', '1.0'))), 'geo': _Gate(1.0)}
_cache, _cache_lock = OrderedDict(), threading.Lock()
_people, _people_lock = defaultdict(deque), threading.Lock()


def _cached(key, make, size=3000):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key); return _cache[key]
    v = make()
    with _cache_lock:
        _cache[key] = v
        while len(_cache) > size: _cache.popitem(last=False)
    return v


def allow(uid):
    """Per-person allowance (only spent on cache misses)."""
    n, window = PER_PERSON
    with _people_lock:
        q, now = _people[uid], time.monotonic()
        while q and now - q[0] > window: q.popleft()
        if len(q) >= n: raise Unavailable('That was a lot of route changes at once. Wait a minute, then carry on.')
        q.append(now)


def _post(url, body):
    """The one place a provider is called (tests replace it)."""
    try:
        r = httpx.post(url, json=body, headers={'User-Agent': UA, 'X-Client-Id': 'kinetta.app'}, timeout=TIMEOUT)
    except httpx.HTTPError:
        raise Unavailable('Map services did not answer. Your route is kept; try again.')
    if r.status_code >= 500 or r.status_code == 429: raise Unavailable('Map services are busy. Your route is kept; try again.')
    try: return r.status_code, r.json()
    except ValueError: raise Unavailable('Map services sent an unreadable answer.')


def _get(url, params):
    try:
        r = httpx.get(url, params=params, headers={'User-Agent': UA, 'Accept-Language': 'en'}, timeout=TIMEOUT)
    except httpx.HTTPError:
        raise Unavailable('Place search did not answer. Try again.')
    if r.status_code != 200: raise Unavailable('Place search is busy. Try again in a moment.')
    try: return r.json()
    except ValueError: raise Unavailable('Place search sent an unreadable answer.')


def _route_once(sport, points):
    base = routing_url()
    if not base: raise Unavailable('Path routing is turned off on this server. Your draft is kept; configure routing before saving a new route.')
    costing, opts = COSTING[sport]
    body = {'locations': [{'lat': round(p[0], 6), 'lon': round(p[1], 6), 'type': 'break'} for p in points],
            'costing': costing, 'costing_options': {costing: opts}, 'shape_format': 'polyline6', 'units': 'kilometers',
            'directions_type': 'none'}
    with _gates['route']:
        code, data = _post(base + '/route', body)
    if code != 200 or 'trip' not in data:
        return None      # no path between these points (water, private land, wrong network for the sport)
    if len(data['trip'].get('legs',[])) != len(points)-1:
        raise Unavailable('Map services returned an incomplete path. Your draft is kept; try again.')
    legs = []
    for leg in data['trip']['legs']:
        line = route_geo.decode(leg['shape'], 6)
        legs.append({'ok': True, 'line': route_geo.encode(line), 'distance_m': round(route_geo.length(line), 1)})
    return legs


def route(uid, sport, points):
    """One leg per pair of consecutive points: {'ok', 'line', 'distance_m'} or {'ok': False, 'reason'}."""
    key = ('route', sport, tuple((round(a, 5), round(b, 5)) for a, b in points))
    with _cache_lock:
        if key in _cache: return _cache[key]
    allow(uid)
    legs = _route_once(sport, points)
    if legs is None:     # find out which connection has no path, so the others stay followed
        legs = []
        for a, b in zip(points, points[1:]):
            one = _route_once(sport, [a, b]) if len(points) > 2 else None
            legs.append(one[0] if one else {'ok': False, 'reason': 'no_path'})
    # A failed connection must be retried with the provider, rather than remembered forever as no path.
    if all(leg.get('ok') for leg in legs):
        with _cache_lock:
            _cache[key] = legs
    return legs


def heights(uid, points):
    """Heights for points along a line, None where the provider has no data."""
    base = elevation_url()
    if not base: raise Unavailable('Elevation is turned off on this server.')
    key = ('h', tuple((round(a, 5), round(b, 5)) for a, b in points))

    def make():
        allow(uid)
        with _gates['route']:
            code, data = _post(base + '/height', {'shape': [{'lat': p[0], 'lon': p[1]} for p in points]})
        if code != 200 or 'height' not in data: raise Unavailable('Elevation is unavailable for this area.')
        return [None if h is None or h <= -1000 else float(h) for h in data['height']]
    return _cached(key, make)


def elevation(uid, line, samples=200):
    """Profile [[metres along, height or None]], ascent and descent, and how much of the line has no height data."""
    total = route_geo.length(line)
    n = max(2, min(samples, int(total // 25) + 2))
    pts = route_geo.resample(line, n)
    hs = heights(uid, pts)
    step = total / (n - 1) if n > 1 else 0
    up, down = route_geo.climb(hs)
    unknown = sum(step for h in hs if h is None)
    return {'profile': [[round(i * step, 1), None if h is None else round(h, 1)] for i, h in enumerate(hs)],
            'ascent_m': up, 'descent_m': down, 'unknown_m': round(unknown), 'source': 'SRTM via Valhalla'}


def search(uid, q, near=None):
    base = geocoder_url()
    if not base: raise Unavailable('Place search is turned off on this server.')
    q = ' '.join(q.split())[:120]
    params = {'q': q, 'format': 'jsonv2', 'limit': 6}
    if near and route_geo.valid(near):   # prefer places near the map, without excluding the rest
        la, lo = near
        params['viewbox'] = f'{lo - .5:.3f},{la + .5:.3f},{lo + .5:.3f},{la - .5:.3f}'

    def make():
        allow(uid)
        with _gates['geo']:
            rows = _get(base + '/search', params)
        out = []
        for r in rows if isinstance(rows, list) else []:
            try: lat, lon = float(r['lat']), float(r['lon'])
            except (KeyError, TypeError, ValueError): continue
            name = r.get('name') or (r.get('display_name') or '').split(',')[0]
            bb = r.get('boundingbox')
            out.append({'name': name, 'detail': r.get('display_name', ''), 'lat': lat, 'lon': lon,
                        'bbox': [float(bb[0]), float(bb[2]), float(bb[1]), float(bb[3])] if bb and len(bb) == 4 else None})
        return out
    return _cached(('s', json.dumps(params, sort_keys=True)), make, 500)
