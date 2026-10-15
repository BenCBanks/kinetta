"""Turn raw streams into numbers: moving time, splits, grade-adjusted pace, best efforts, power curve, HR zones,
effort (TRIMP), aerobic decoupling, effective VO2max and race predictions.  All distances in metres, times in seconds.

Models (documented so the numbers can be trusted and changed):
 - GAP: relative running cost by grade g (%): 1 + 0.026 g + 0.0011 g^2 (clamped to -30..30 %). Same shape as Strava's
   published data-driven curve: uphill costs more, gentle downhill (-10 %) helps most, steep downhill helps less.
 - Effort: Banister TRIMP with heart-rate reserve (k = 1.92 men, 1.67 women).
 - VO2max: Daniels' oxygen-cost of running speed divided by the %VO2max implied by %HRmax ((HR% - 0.37) / 0.64),
   the method Runalyze uses; race times from Daniels' %VO2max-vs-duration curve.
"""
import math
import numpy as np

MILE = 1609.344
RUN_EFFORTS = [(400, '400 m'), (804.672, '½ mile'), (1000, '1 km'), (MILE, '1 mile'), (2 * MILE, '2 miles'), (5000, '5K'),
               (10000, '10K'), (15000, '15K'), (10 * MILE, '10 miles'), (20000, '20K'), (21097.5, 'Half marathon'),
               (30000, '30K'), (42195, 'Marathon')]
RIDE_EFFORTS = [(5000, '5 km'), (10000, '10 km'), (20000, '20 km'), (40000, '40 km'), (50000, '50 km'), (80467, '50 miles'),
                (100000, '100 km'), (160934, '100 miles')]
WALK_EFFORTS = [(MILE, '1 mile'), (5000, '5K'), (10000, '10K')]
POWER_DURATIONS = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600]
MAX_SPEED = {'run': 12.0, 'walk': 4.0, 'hike': 4.0, 'ride': 30.0, 'swim': 4.0, 'row': 8.0, 'ski': 40.0, 'workout': 12.0, 'other': 30.0}   # m/s: faster = GPS glitch
MOVING_SPEED = {'run': 0.6, 'walk': 0.35, 'hike': 0.3, 'ride': 1.0, 'swim': 0.15, 'row': 0.5, 'ski': 1.0, 'workout': 0.3, 'other': 0.5}
FOOT = ('run', 'walk', 'hike')


def efforts_for(sport):
    return RUN_EFFORTS if sport == 'run' else RIDE_EFFORTS if sport == 'ride' else WALK_EFFORTS if sport in ('walk', 'hike') else []


def _arr(xs):
    return np.array([np.nan if x is None else float(x) for x in xs], dtype=float)


def _fill(a):
    """Fill gaps by linear interpolation; ends take the nearest value. All-NaN stays NaN."""
    ok = ~np.isnan(a)
    if not ok.any(): return a
    idx = np.arange(len(a))
    return np.interp(idx, idx[ok], a[ok])


def haversine(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def gap_factor(grade_pct):
    g = np.clip(grade_pct, -30, 30)
    return 1 + 0.026 * g + 0.0011 * g * g


def prepare(streams, sport):
    """Clean arrays: t, dist (monotonic, glitches removed), alt (smoothed), hr, ..., moving mask, grade."""
    t = _arr(streams['t'])
    n = len(t)
    S = {'t': t, 'n': n}
    for k in ('lat', 'lon', 'alt', 'hr', 'cad', 'power', 'speed', 'temp', 'vo', 'gct', 'stride'):
        S[k] = _arr(streams[k]) if streams.get(k) else None
    if n < 2:
        S.update(dist=np.zeros(n), moving=np.zeros(max(n - 1, 0), bool), dt=np.zeros(max(n - 1, 0)), alt_s=None, grade=None)
        return S
    dt = np.diff(t)
    vmax = MAX_SPEED.get(sport, 30.0)
    dd = None
    if streams.get('dist') and np.mean(~np.isnan(_arr(streams['dist']))) > 0.8:
        d = _fill(_arr(streams['dist']))
        dd = np.diff(d)
    elif S['lat'] is not None and S['lon'] is not None:
        lat, lon = S['lat'], S['lon']
        ok = ~(np.isnan(lat) | np.isnan(lon))
        if ok.sum() >= 2:
            lat, lon = _fill(lat), _fill(lon)
            dd = haversine(lat[:-1], lon[:-1], lat[1:], lon[1:])
    if dd is None:
        dd = np.zeros(n - 1)
    dd = np.where(np.isnan(dd) | (dd < 0), 0, dd)
    with np.errstate(divide='ignore', invalid='ignore'):
        v = np.where(dt > 0, dd / dt, 0)
    dd = np.where(v > vmax, 0, dd)           # GPS jumps never count as distance
    S['dt'] = dt
    S['dist'] = np.concatenate([[0.0], np.cumsum(dd)])
    with np.errstate(divide='ignore', invalid='ignore'):
        v = np.where(dt > 0, dd / dt, 0)
    S['seg_speed'] = v
    S['moving'] = (dt > 0) & (dt <= 30) & (v >= MOVING_SPEED.get(sport, 0.5))
    if S['dist'][-1] < 1:     # indoor / no GPS (treadmill without footpod, spin bike, strength): any recorded time counts
        S['moving'] = (dt > 0) & (dt <= 30)
    # elevation: fill, smooth over ~30 s, grade over 60 m of distance
    if S['alt'] is not None and (~np.isnan(S['alt'])).sum() >= 2:
        a = _fill(S['alt'])
        w = max(1, int(round(30 / max(np.median(dt[dt > 0]) if (dt > 0).any() else 1, 0.5))))
        if w > 1 and n > w:
            k = np.ones(w) / w
            pad = np.pad(a, (w // 2, w - 1 - w // 2), mode='edge')
            a = np.convolve(pad, k, mode='valid')
        S['alt_s'] = a
        dist = S['dist']
        if dist[-1] > 100:
            grid = np.arange(0, dist[-1] + 10, 10.0)
            ag = np.interp(grid, dist, a)
            gw = 6   # 60 m
            gg = np.zeros_like(grid)
            if len(grid) > 2 * gw:
                gg[gw:-gw] = (ag[2 * gw:] - ag[:-2 * gw]) / (2 * gw * 10.0) * 100
                gg[:gw], gg[-gw:] = gg[gw], gg[-gw - 1]
            S['grade'] = np.interp(dist, grid, gg)
        else:
            S['grade'] = np.zeros(n)
    else:
        S['alt_s'], S['grade'] = None, None
    return S


def ascent_descent(S, threshold=3.0):
    """Climb/descent with hysteresis (ignores GPS/barometer wobble smaller than `threshold` metres)."""
    a = S.get('alt_s')
    if a is None or len(a) < 2: return None, None
    up = down = 0.0
    ref = a[0]
    for x in a[1:]:
        if x - ref >= threshold: up += x - ref; ref = x
        elif ref - x >= threshold: down += ref - x; ref = x
    return up, down


def _wmean(vals, w):
    if vals is None or w is None or len(vals) != len(w): return None
    ok = ~np.isnan(vals) & (w > 0)
    if not ok.any() or w[ok].sum() == 0: return None
    return float(np.sum(vals[ok] * w[ok]) / np.sum(w[ok]))



def heart_intervals(S):
    """Observed HR intervals, independent of GPS/movement sampling.

    Health sources can provide one reading every two minutes. Bridge at most five minutes between valid readings,
    use their midpoint over the elapsed interval, and never extrapolate before/after observations or across outages.
    """
    if S['hr'] is None or S['n'] < 2: return np.array([]), np.array([])
    valid = np.isfinite(S['t']) & np.isfinite(S['hr']) & (S['hr'] > 0)
    times, beats = S['t'][valid], S['hr'][valid]
    gaps = np.diff(times)
    keep = (gaps > 0) & (gaps <= 300)
    return ((beats[:-1] + beats[1:]) / 2)[keep], gaps[keep]


def summary(S, sport, session, profile):
    n, dt, mv = S['n'], S['dt'], S['moving']
    out = {}
    out['elapsed_s'] = float(S['t'][-1] - S['t'][0]) if n > 1 else session.get('elapsed_s')
    out['moving_s'] = float(dt[mv].sum()) if n > 1 else session.get('moving_s')
    # the device's own total (watch/bike computer, often footpod- or wheel-calibrated) wins over distance rebuilt from GPS
    out['distance_m'] = session.get('distance_m') or (float(S['dist'][-1]) if n > 1 and S['dist'][-1] > 0 else None)
    up, down = ascent_descent(S)
    out['ascent_m'] = session.get('ascent_m') if session.get('ascent_m') is not None else up
    out['descent_m'] = session.get('descent_m') if session.get('descent_m') is not None else down
    w = np.where(mv, dt, 0) if n > 1 else None
    seg = lambda a: None if a is None else (a[:-1] + a[1:]) / 2   # value over each interval
    out['avg_hr'] = _wmean(*heart_intervals(S)) if n > 1 else session.get('avg_hr')
    out['max_hr'] = float(np.nanmax(S['hr'])) if S['hr'] is not None and not np.isnan(S['hr']).all() else session.get('max_hr')
    out['avg_cad'] = _wmean(seg(S['cad']), w) if n > 1 else None
    out['avg_power'] = _wmean(seg(S['power']), w) if n > 1 else session.get('avg_power')
    out['max_power'] = float(np.nanmax(S['power'])) if S['power'] is not None and not np.isnan(S['power']).all() else None
    out['avg_temp'] = _wmean(seg(S['temp']), np.where(dt > 0, dt, 0)) if n > 1 and S['temp'] is not None else None
    out['calories'] = session.get('calories')
    out['max_speed'] = None
    if n > 1 and mv.any():
        sp = S['seg_speed'][mv]
        if len(sp) >= 5:   # max over a 5-sample rolling mean, so one GPS spike doesn't count
            out['max_speed'] = float(np.max(np.convolve(sp, np.ones(5) / 5, mode='valid')))
    # running dynamics
    for k, name in (('vo', 'avg_vo'), ('gct', 'avg_gct'), ('stride', 'avg_stride')):
        out[name] = _wmean(seg(S[k]), w) if n > 1 and S[k] is not None else None
    # grade-adjusted pace (foot sports)
    out['gap_s_per_km'] = None
    if sport in FOOT and n > 1 and S.get('grade') is not None and out['moving_s'] and mv.any():
        g = seg(S['grade'])
        eq = float(np.sum(np.diff(S['dist'])[mv] * gap_factor(g[mv])))
        if eq > 0: out['gap_s_per_km'] = out['moving_s'] / eq * 1000
    # heart-rate based numbers
    hrmax, hrrest = profile.get('max_hr') or 190, profile.get('rest_hr') or 60
    out['zones'] = hr_zones(S, hrmax)
    out['effort'] = trimp(S, hrmax, hrrest, profile.get('sex'))
    out['decoupling'] = decoupling(S, sport)
    out['vo2max'] = vo2max(out, sport, hrmax)
    extras(S, sport, session, out)
    return out


def extras(S, sport, session, out):
    """Sport-specific numbers: altitude range, climbing rate, normalized power, steps, swim lengths/SWOLF."""
    a = S.get('alt_s')
    if a is not None and len(a):
        out['max_alt'], out['min_alt'] = float(np.max(a)), float(np.min(a))
    if sport in ('hike', 'ride', 'ski', 'walk', 'run') and out.get('ascent_m') and out.get('moving_s'):
        out['vam'] = out['ascent_m'] / (out['moving_s'] / 3600)          # metres climbed per hour of moving
    p = S.get('power')
    if p is not None and S['n'] > 30 and not np.isnan(p).all():         # normalized power: 30 s rolling mean, 4th-power average
        t = S['t']; grid = np.arange(t[0], t[-1] + 1, 1.0); pg = np.interp(grid, t, np.nan_to_num(p))
        if len(pg) > 30:
            r = np.convolve(pg, np.ones(30) / 30, mode='valid')
            out['norm_power'] = float(np.mean(r ** 4) ** 0.25)
    if sport in ('run', 'walk', 'hike') and out.get('avg_cad') and out.get('moving_s'):
        out['steps'] = out['avg_cad'] * out['moving_s'] / 60
    if sport == 'swim':
        L = [x for x in (session.get('_lengths') or []) if x.get('s')]
        out['pool_length_m'] = session.get('pool_length_m')
        out['strokes'] = session.get('strokes')
        if L:
            out['lengths'] = len(L)
            st = [x['strokes'] for x in L if x.get('strokes')]
            if st: out['swolf'] = float(np.mean([x['s'] + (x['strokes'] or 0) for x in L if x.get('strokes')]))
            if not out.get('strokes') and st: out['strokes'] = float(sum(st))
            if out.get('pool_length_m') and not out.get('distance_m'): out['distance_m'] = len(L) * out['pool_length_m']
    return out


def hr_zones(S, hrmax):
    if S['hr'] is None or S['n'] < 2: return None
    h, w = heart_intervals(S)
    bounds = [0, .6, .7, .8, .9, 9]
    z = [float(np.sum(w[(h >= hrmax * bounds[i]) & (h < hrmax * bounds[i + 1])])) for i in range(5)]
    return z if sum(z) > 0 else None


def trimp(S, hrmax, hrrest, sex):
    if S['hr'] is None or S['n'] < 2 or hrmax <= hrrest: return None
    h, w = heart_intervals(S)
    w = w / 60
    r = np.clip((np.nan_to_num(h) - hrrest) / (hrmax - hrrest), 0, 1.1)
    k = 1.67 if (sex or '').lower().startswith('f') else 1.92
    v = float(np.sum(w * r * 0.64 * np.exp(k * r)))
    return round(v, 1) if v > 0 else None


def decoupling(S, sport):
    """% drop in efficiency (speed per heartbeat, hills adjusted) from first to second half. <5 % = good aerobic fitness."""
    if S['hr'] is None or S['n'] < 10 or not S['moving'].any(): return None
    mv, dt = S['moving'], S['dt']
    if dt[mv].sum() < 20 * 60: return None
    h = (S['hr'][:-1] + S['hr'][1:]) / 2
    dd = np.diff(S['dist'])
    if sport in FOOT and S.get('grade') is not None:
        dd = dd * gap_factor((S['grade'][:-1] + S['grade'][1:]) / 2)
    cum = np.cumsum(np.where(mv, dt, 0)); half = cum[-1] / 2
    res = []
    for sel in (mv & (cum <= half), mv & (cum > half)):
        hs = h[sel]; okh = ~np.isnan(hs)
        if sel.sum() < 5 or not okh.any(): return None
        speed = dd[sel].sum() / dt[sel].sum()
        res.append(speed / np.average(hs[okh], weights=dt[sel][okh]))
    return round((res[0] - res[1]) / res[0] * 100, 1)


def _vo2_of_speed(v_m_min):
    return -4.60 + 0.182258 * v_m_min + 0.000104 * v_m_min ** 2


def _pct_of_duration(t_min):
    return 0.8 + 0.1894393 * math.exp(-0.012778 * t_min) + 0.2989558 * math.exp(-0.1932605 * t_min)


def vo2max(o, sport, hrmax):
    if sport != 'run' or not o.get('avg_hr') or not o.get('moving_s') or o['moving_s'] < 600 or not o.get('distance_m'): return None
    pace = o.get('gap_s_per_km') or o['moving_s'] / o['distance_m'] * 1000
    v = 1000 / pace * 60            # m/min
    hr_pct = o['avg_hr'] / hrmax
    if not 0.6 <= hr_pct <= 1.0: return None
    pct = (hr_pct - 0.37) / 0.64
    est = _vo2_of_speed(v) / pct
    return round(est, 1) if 20 <= est <= 90 else None


def vdot(meters, seconds):
    """Daniels VDOT shown by an actual effort: oxygen cost of its speed / the %VO2max sustainable for its duration."""
    t = seconds / 60
    return _vo2_of_speed(meters / t) / _pct_of_duration(t)


def race_time(vdot, meters):
    """Daniels: time (s) to race `meters` at fitness `vdot`."""
    lo, hi = 1.0, 2000.0       # minutes
    for _ in range(60):
        mid = (lo + hi) / 2
        need = _vo2_of_speed(meters / mid) / _pct_of_duration(mid)
        lo, hi = (mid, hi) if need > vdot else (lo, mid)
    return round(hi * 60)


def endurance_k(weekly_km):
    """Riegel exponent for stretching a time to a longer race: 1.06 for runners on about 70 km a week, rising to 1.10 on
    little mileage. Daniels' tables (and plain Riegel) assume you've trained for the distance; runners on low mileage
    slow down more in long races than they predict (Vickers & Vertosick 2016, 2,300 recreational runners)."""
    return 1.06 + 0.04 * min(1.0, max(0.0, (70 - weekly_km) / 55))


def predict(meters, seconds, target_m, weekly_km):
    """Race time (s) for target_m from one effort: Daniels for the same or a shorter race; for a longer one, whichever
    is slower of Daniels and Riegel with the mileage-based exponent, so a fast mile doesn't promise a fast marathon."""
    t = race_time(vdot(meters, seconds), target_m)
    if target_m > meters: t = max(t, seconds * (target_m / meters) ** endurance_k(weekly_km))
    return round(t)


def predictions(efforts, weekly_km, targets):
    """For each (meters, label) target: the best prediction over the efforts (dicts with distance_m and elapsed_s), and
    the effort it came from. Longer efforts win the longer races, because stretching a short one costs more."""
    out = []
    for m, label in targets:
        best = min(efforts, key=lambda e: predict(e['distance_m'], e['elapsed_s'], m, weekly_km), default=None)
        if best: out.append({'label': label, 'distance_m': m, 'seconds': predict(best['distance_m'], best['elapsed_s'], m, weekly_km), 'from': best})
    return out


def splits(S, sport, unit):
    """Per mile/km: moving time, pace, GAP pace, avg HR, elevation change. Last partial split included."""
    if S['n'] < 2 or S['dist'][-1] < unit * 0.25: return []
    dist = S['dist']; dt = S['dt']; mv = S['moving']
    mt = np.concatenate([[0.0], np.cumsum(np.where(mv, dt, 0))])
    eq = None
    if sport in FOOT and S.get('grade') is not None:
        f = gap_factor((S['grade'][:-1] + S['grade'][1:]) / 2)
        eq = np.concatenate([[0.0], np.cumsum(np.where(mv, np.diff(dist) * f, 0))])
    alt = S.get('alt_s')
    hr = S['hr']
    marks = list(np.arange(unit, dist[-1], unit)) + [dist[-1]]
    out, prev = [], 0.0
    for m in marks:
        d = m - prev
        if d < 30: break
        t0, t1 = np.interp(prev, dist, mt), np.interp(m, dist, mt)
        sec = t1 - t0
        row = {'n': len(out) + 1, 'distance_m': round(float(d), 1), 'moving_s': round(float(sec), 1),
               'pace_s_per_km': round(float(sec / d * 1000), 1) if d > 0 and sec > 0 else None}
        if eq is not None:
            e = np.interp(m, dist, eq) - np.interp(prev, dist, eq)
            row['gap_s_per_km'] = round(float(sec / e * 1000), 1) if e > 0 and sec > 0 else None
        if alt is not None:
            row['elev_m'] = round(float(np.interp(m, dist, alt) - np.interp(prev, dist, alt)), 1)
        if hr is not None:
            i0, i1 = np.searchsorted(dist, prev), np.searchsorted(dist, m)
            hs = hr[i0:max(i1, i0 + 1)]
            row['avg_hr'] = round(float(np.nanmean(hs))) if len(hs) and not np.isnan(hs).all() else None
        out.append(row); prev = m
    return out


def best_efforts(S, sport):
    """Fastest time over each standard distance inside this activity (elapsed time, like Strava)."""
    if S['n'] < 2: return []
    dist, t = S['dist'], S['t']
    out = []
    for meters, label in efforts_for(sport):
        if dist[-1] < meters: break
        ok = dist + meters <= dist[-1]
        if not ok.any(): continue
        t_end = np.interp(dist[ok] + meters, dist, t)
        dur = t_end - t[ok]
        i = int(np.argmin(dur))
        sec = float(dur[i])
        if sec <= 0 or meters / sec > MAX_SPEED.get(sport, 30): continue
        out.append({'distance_m': meters, 'label': label, 'elapsed_s': round(sec, 1), 'start_s': float(t[ok][i])})
    return out


def power_curve(S):
    """Best average power for standard durations (needs a power meter)."""
    p = S.get('power')
    if p is None or S['n'] < 2 or np.isnan(p).all(): return []
    t = S['t']
    grid = np.arange(t[0], t[-1] + 1, 1.0)
    pg = np.interp(grid, t, np.nan_to_num(p))
    gaps = np.interp(grid, t[1:], np.where(np.diff(t) > 10, 1, 0)) > 0.5   # pauses count as zero watts
    pg[gaps] = 0
    cs = np.concatenate([[0.0], np.cumsum(pg)])
    out = []
    for d in POWER_DURATIONS:
        if len(pg) < d: break
        m = (cs[d:] - cs[:-d]) / d
        out.append({'seconds': d, 'watts': round(float(m.max()))})
    return out


def chart_series(S, sport, points=600):
    """Down-sampled series for the activity charts (by distance), so phones get small payloads."""
    n = S['n']
    if n < 2: return None
    idx = np.unique(np.linspace(0, n - 1, min(points, n)).astype(int))
    dist = S['dist']
    seg_v = np.concatenate([[np.nan], S['seg_speed']])
    # smooth speed over ~20 s for a readable pace line
    w = max(1, int(round(20 / max(float(np.median(S['dt'][S['dt'] > 0])) if (S['dt'] > 0).any() else 1, 0.5))))
    sv = np.convolve(np.nan_to_num(seg_v), np.ones(w) / w, mode='same') if w > 1 else np.nan_to_num(seg_v)
    out = {'d': [round(float(x), 1) for x in dist[idx]], 't': [round(float(x)) for x in S['t'][idx]],
           'speed': [round(float(x), 3) for x in sv[idx]]}
    if sport in FOOT and S.get('grade') is not None:
        out['gap_speed'] = [round(float(x), 3) for x in (sv * gap_factor(S['grade']))[idx]]
    for k, key in (('alt_s', 'alt'), ('hr', 'hr'), ('cad', 'cad'), ('power', 'power'), ('grade', 'grade'), ('temp', 'temp')):
        a = S.get(k)
        if a is not None and not np.isnan(a).all():
            out[key] = [None if np.isnan(x) else round(float(x), 1) for x in a[idx]]
    return out
