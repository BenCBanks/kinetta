"""Read FIT / GPX / TCX files (optionally .gz) into one common shape:

    {'sport': 'run'|'ride'|'walk'|'hike'|'swim'|'other', 'sub_sport': str|None, 'start': datetime (UTC),
     'device': str|None, 'session': {...totals reported by the device...}, 'laps': [{...}],
     'streams': {'t': [s from start], 'lat', 'lon', 'alt', 'dist', 'hr', 'cad', 'power', 'speed', 'temp',
                 'vo', 'gct', 'stride'}}   (lists the same length as 't'; None where a sample has no value)

Run cadence is stored as steps per minute (FIT records one leg, so it is doubled).
"""
import datetime as dt
import gzip
import io
import xml.etree.ElementTree as ET

import fitdecode

STREAMS = ('lat', 'lon', 'alt', 'dist', 'hr', 'cad', 'power', 'speed', 'temp', 'vo', 'gct', 'stride')
UTC = dt.timezone.utc


class ParseError(Exception):
    pass


SPORTS = ('run', 'ride', 'walk', 'hike', 'swim', 'row', 'ski', 'workout', 'other')


def sport_of(name, sub=None):
    """Map the many sport names (FIT, TCX, GPX, Strava) onto our families. The original name is kept as sport_label."""
    n = f'{name or ""} {sub or ""}'.lower().replace('_', ' ')
    if 'swim' in n: return 'swim'
    if any(k in n for k in ('row', 'kayak', 'canoe', 'paddl')): return 'row'
    if any(k in n for k in ('ski', 'snowboard')): return 'ski'
    if any(k in n for k in ('trail run', 'treadmill', 'track', 'run', 'jog')): return 'run'
    if any(k in n for k in ('ride', 'cycl', 'bik', 'spin')): return 'ride'
    if 'hik' in n or 'mountaineer' in n: return 'hike'
    if 'walk' in n: return 'walk'
    if any(k in n for k in ('strength', 'weight', 'workout', 'training', 'hiit', 'crossfit', 'yoga', 'pilates',
                            'elliptical', 'stair', 'cardio', 'fitness equipment', 'climb')): return 'workout'
    return 'other'


MAX_FILE = 256 * 1024 ** 2      # one workout file, unpacked: real ones are a few MB (2026-10-12 review: a tiny .gz could unpack to GBs)


def gunzip_capped(data, cap=MAX_FILE):
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as g:
        out = g.read(cap + 1)
    if len(out) > cap: raise ParseError('the file unpacks to more than 256 MB - not a workout file')
    return out


def read(name, data):
    """Parse one file by its name (extension) and bytes."""
    low = name.lower()
    if low.endswith('.gz'):
        try: data = gunzip_capped(data)
        except OSError as e: raise ParseError(f'not a valid .gz file: {e}')
        low = low[:-3]
    if low.endswith('.fit'): out = read_fit(data)
    elif low.endswith('.gpx'): out = read_gpx(data)
    elif low.endswith('.tcx'): out = read_tcx(data)
    else: raise ParseError('unsupported file type (use .fit, .gpx or .tcx)')
    if not out['streams']['t'] and not out['session'].get('elapsed_s'):
        raise ParseError('no recorded data in the file')
    return out


def _empty():
    return {k: [] for k in ('t',) + STREAMS}


def _finish(start, rows, sport, sub, device, session, laps):
    """rows: list of (datetime, {stream: value}) in time order -> common shape."""
    rows = [r for r in rows if r[0] is not None]
    rows.sort(key=lambda r: r[0])
    s = _empty()
    if rows and start is None: start = rows[0][0]
    last_t = None
    for t, v in rows:
        sec = (t - start).total_seconds()
        if last_t is not None and sec <= last_t:  # drop duplicate timestamps
            continue
        last_t = sec
        s['t'].append(sec)
        for k in STREAMS: s[k].append(v.get(k))
    for k in STREAMS:  # drop streams that never had a value
        if all(x is None for x in s[k]): s[k] = []
    return {'sport': sport, 'sub_sport': sub, 'start': start, 'device': device, 'session': session, 'laps': laps, 'streams': s}


# ---------- FIT ----------
SEMI = 180.0 / 2 ** 31


def _f(frame, *names):
    for n in names:
        if frame.has_field(n):
            v = frame.get_value(n, fallback=None)
            if v is not None: return v
    return None


def _utc(t):
    if t is None: return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def read_fit(data):
    rows, laps, session, sport, sub, device, start = [], [], {}, None, None, None, None
    try:
        with fitdecode.FitReader(io.BytesIO(data), check_crc=fitdecode.CrcCheck.WARN,
                                 error_handling=fitdecode.ErrorHandling.WARN) as fr:
            for fm in fr:
                if not isinstance(fm, fitdecode.FitDataMessage): continue
                if fm.name == 'record':
                    t = _utc(_f(fm, 'timestamp'))
                    lat, lon = _f(fm, 'position_lat'), _f(fm, 'position_long')
                    cad = _f(fm, 'cadence')
                    frac = _f(fm, 'fractional_cadence')
                    if cad is not None and frac: cad = cad + frac
                    rows.append((t, {
                        'lat': lat * SEMI if isinstance(lat, int) else None, 'lon': lon * SEMI if isinstance(lon, int) else None,
                        'alt': _f(fm, 'enhanced_altitude', 'altitude'), 'dist': _f(fm, 'distance'), 'hr': _f(fm, 'heart_rate'),
                        'cad': cad, 'power': _f(fm, 'power'), 'speed': _f(fm, 'enhanced_speed', 'speed'),
                        'temp': _f(fm, 'temperature'), 'vo': _f(fm, 'vertical_oscillation'),
                        'gct': _f(fm, 'stance_time'), 'stride': _f(fm, 'step_length')}))
                elif fm.name == 'lap':
                    laps.append({'start': _utc(_f(fm, 'start_time')), 'elapsed_s': _f(fm, 'total_elapsed_time'),
                                 'moving_s': _f(fm, 'total_timer_time'), 'distance_m': _f(fm, 'total_distance'),
                                 'avg_hr': _f(fm, 'avg_heart_rate'), 'max_hr': _f(fm, 'max_heart_rate'),
                                 'ascent_m': _f(fm, 'total_ascent'), 'avg_power': _f(fm, 'avg_power'),
                                 'avg_cad': _f(fm, 'avg_running_cadence', 'avg_cadence'), 'trigger': str(_f(fm, 'lap_trigger') or '')})
                elif fm.name == 'length':   # pool swims: one message per length
                    if str(_f(fm, 'length_type') or 'active') == 'active':
                        session.setdefault('_lengths', []).append({'s': _f(fm, 'total_elapsed_time'), 'strokes': _f(fm, 'total_strokes'),
                                                                   'stroke': str(_f(fm, 'swim_stroke') or '')})
                elif fm.name == 'session':
                    sport = str(_f(fm, 'sport') or ''); sub = str(_f(fm, 'sub_sport') or '') or None
                    start = _utc(_f(fm, 'start_time'))
                    lengths = session.get('_lengths')
                    session = {'_lengths': lengths, 'pool_length_m': _f(fm, 'pool_length'), 'strokes': _f(fm, 'total_strokes', 'total_cycles'),
                               'elapsed_s': _f(fm, 'total_elapsed_time'), 'moving_s': _f(fm, 'total_timer_time'),
                               'distance_m': _f(fm, 'total_distance'), 'ascent_m': _f(fm, 'total_ascent'),
                               'descent_m': _f(fm, 'total_descent'), 'calories': _f(fm, 'total_calories'),
                               'avg_hr': _f(fm, 'avg_heart_rate'), 'max_hr': _f(fm, 'max_heart_rate'),
                               'avg_power': _f(fm, 'avg_power'), 'training_effect': _f(fm, 'total_training_effect')}
                elif fm.name == 'sport' and sport is None:
                    sport = str(_f(fm, 'sport') or '') or None; sub = str(_f(fm, 'sub_sport') or '') or None
                elif fm.name == 'device_info' and device is None:
                    if _f(fm, 'device_index') in (0, 'creator', None):
                        prod = _f(fm, 'garmin_product', 'product_name', 'product'); man = _f(fm, 'manufacturer')
                        if prod or man: device = ' '.join(str(x) for x in (man, prod) if x).replace('_', ' ').strip() or None
                elif fm.name == 'file_id' and start is None:
                    start = _utc(_f(fm, 'time_created'))
    except fitdecode.FitError as e:
        if not rows: raise ParseError(f'unreadable FIT file: {e}')
    kind = sport_of(sport, sub)
    out = _finish(start if rows and start and start <= rows[0][0] else None, rows, kind, sub, device, session, laps)
    if kind == 'run' and out['streams']['cad']:
        out['streams']['cad'] = [c * 2 if c is not None else None for c in out['streams']['cad']]
        for l in laps:
            if l.get('avg_cad'): l['avg_cad'] = l['avg_cad'] * 2
    for l in laps:
        l['start_s'] = (l.pop('start') - out['start']).total_seconds() if l.get('start') and out['start'] else None
    return out


# ---------- GPX / TCX (XML) ----------
def _local(tag): return tag.rsplit('}', 1)[-1]


def _time(s):
    if not s: return None
    s = s.strip().replace('Z', '+00:00')
    try: t = dt.datetime.fromisoformat(s)
    except ValueError: return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def _num(s):
    try: return float(s)
    except (TypeError, ValueError): return None


def _xml(data):
    try: return ET.fromstring(data.lstrip(b'\xef\xbb\xbf \r\n\t'))
    except ET.ParseError as e: raise ParseError(f'unreadable XML: {e}')


def read_gpx(data):
    root = _xml(data)
    rows, typ, device = [], None, root.get('creator')
    for trk in root.iter():
        if _local(trk.tag) == 'type' and trk.text and typ is None: typ = trk.text
    for pt in root.iter():
        if _local(pt.tag) not in ('trkpt', 'rtept'): continue
        v = {'lat': _num(pt.get('lat')), 'lon': _num(pt.get('lon'))}
        t = None
        for c in pt.iter():
            n = _local(c.tag)
            if n == 'ele': v['alt'] = _num(c.text)
            elif n == 'time': t = _time(c.text)
            elif n in ('hr', 'heartrate'): v['hr'] = _num(c.text)
            elif n in ('cad', 'cadence'): v['cad'] = _num(c.text)
            elif n in ('power', 'watts', 'PowerInWatts'): v['power'] = _num(c.text)
            elif n in ('atemp', 'temp'): v['temp'] = _num(c.text)
            elif n == 'speed': v['speed'] = _num(c.text)
        rows.append((t, v))
    if rows and all(r[0] is None for r in rows): raise ParseError('GPX has no timestamps (a planned route, not a recording)')
    kind = sport_of(typ)
    out = _finish(None, rows, kind, None, device, {}, [])
    if kind == 'run' and out['streams']['cad'] and max(c or 0 for c in out['streams']['cad']) < 120:
        out['streams']['cad'] = [c * 2 if c is not None else None for c in out['streams']['cad']]   # one-leg cadence
    return out


def read_tcx(data):
    root = _xml(data)
    rows, laps, sport, device, start = [], [], None, None, None
    for act in root.iter():
        if _local(act.tag) != 'Activity': continue
        sport = act.get('Sport')
        for el in act:
            n = _local(el.tag)
            if n == 'Id': start = _time(el.text)
            elif n == 'Creator':
                for c in el:
                    if _local(c.tag) == 'Name' and c.text: device = c.text
            elif n == 'Lap':
                lap = {'start_s': None, '_start': _time(el.get('StartTime'))}
                for c in el:
                    cn = _local(c.tag)
                    if cn == 'TotalTimeSeconds': lap['moving_s'] = lap['elapsed_s'] = _num(c.text)
                    elif cn == 'DistanceMeters': lap['distance_m'] = _num(c.text)
                    elif cn == 'AverageHeartRateBpm': lap['avg_hr'] = _num(next((x.text for x in c), None))
                    elif cn == 'MaximumHeartRateBpm': lap['max_hr'] = _num(next((x.text for x in c), None))
                    elif cn == 'Track':
                        for tp in c:
                            v, t = {}, None
                            for d in tp.iter():
                                dn = _local(d.tag)
                                if dn == 'Time': t = _time(d.text)
                                elif dn == 'LatitudeDegrees': v['lat'] = _num(d.text)
                                elif dn == 'LongitudeDegrees': v['lon'] = _num(d.text)
                                elif dn == 'AltitudeMeters': v['alt'] = _num(d.text)
                                elif dn == 'DistanceMeters': v['dist'] = _num(d.text)
                                elif dn == 'Value' and _local(tp.tag) == 'Trackpoint' and 'hr' not in v: v['hr'] = _num(d.text)
                                elif dn == 'Cadence': v['cad'] = _num(d.text)
                                elif dn == 'RunCadence': v['cad'] = _num(d.text)
                                elif dn == 'Watts': v['power'] = _num(d.text)
                                elif dn == 'Speed': v['speed'] = _num(d.text)
                            rows.append((t, v))
                laps.append(lap)
        break
    kind = sport_of(sport)
    out = _finish(start, rows, kind, None, device, {}, [])
    if kind == 'run' and out['streams']['cad'] and max(c or 0 for c in out['streams']['cad']) < 120:
        out['streams']['cad'] = [c * 2 if c is not None else None for c in out['streams']['cad']]
    for l in laps:
        s0 = l.pop('_start')
        l['start_s'] = (s0 - out['start']).total_seconds() if s0 and out['start'] else None
    out['laps'] = laps
    return out
