"""Import jobs: single FIT/GPX/TCX files, or a whole Strava bulk-export .zip.

A job runs in a background thread (one at a time) and records progress in the `imports` table, so the phone can show
"412 of 1,380 · 405 added · 7 duplicates". Big exports can also be imported on the server:

    docker exec -it services-fit-1 python -m app.importer <login> /data/inbox/<file-or-folder>

Strava export: activities.csv supplies name, type, description, private note, gear, commute and the Strava id for each
file in activities/; rows without a file (manual entries) become activities from the CSV numbers.
"""
import csv
import datetime as dt
import io
import json
import os
import sys
import threading
import traceback
import zipfile
from concurrent.futures import ThreadPoolExecutor

from . import activities, coach, db, parsers

DATA = os.environ.get('FIT_DATA', '/data')
EXTS = ('.fit', '.gpx', '.tcx', '.fit.gz', '.gpx.gz', '.tcx.gz')
_pool = ThreadPoolExecutor(max_workers=1)
_lock = threading.Lock()


def new_job(user_id, label):
    with db.connect() as c:
        return c.execute('INSERT INTO imports (user_id, label) VALUES (%s, %s) RETURNING id', (user_id, label[:200])).fetchone()['id']


def _update(job, **kw):
    msg = kw.pop('message', None)
    with db.connect() as c:
        if kw:
            c.execute('UPDATE imports SET ' + ', '.join(f'{k} = {k} + %s' if k in ('done', 'added', 'duplicates', 'failed') else f'{k} = %s' for k in kw)
                      + ' WHERE id = %s', (*kw.values(), job))
        if msg:   # keep the last 200 messages
            c.execute("""UPDATE imports SET messages = (SELECT coalesce(jsonb_agg(m), '[]') FROM
                         (SELECT m FROM jsonb_array_elements(messages || %s::jsonb) m OFFSET greatest(jsonb_array_length(messages) - 199, 0)) x)
                         WHERE id = %s""", (json.dumps([msg]), job))


def cancel(job, why):
    """An upload that never finished arriving: the job ends as failed, with the reason."""
    _update(job, status='failed', message=f'upload stopped: {why}', finished=dt.datetime.now(dt.timezone.utc))


def submit(job, user_id, paths):
    """paths: files already saved on disk (uploads); deleted after import unless they live in the inbox."""
    _pool.submit(_run, job, user_id, paths)


def _run(job, user_id, paths):
    with _lock:
        try:
            _update(job, status='running')
            items = []      # (name, loader, meta)
            for p in paths:
                if p.lower().endswith('.zip'): items += _zip_items(p, user_id)
                elif os.path.isdir(p): items += _dir_items(p)
                else: items.append((os.path.basename(p), (lambda p=p: open(p, 'rb').read()), {}))
            _update(job, total=len(items))
            added_ids = []
            for name, load, meta in items:
                try:
                    if load is None:      # manual Strava entry: no file
                        res, aid = _manual(user_id, meta)
                    else:
                        raw = load()
                        parsed = parsers.read(name, raw)
                        ext = '.' + '.'.join(name.lower().rsplit('/', 1)[-1].split('.')[1:])
                        res, aid = activities.store(user_id, parsed, meta, raw=raw, ext=ext,
                                                    source='strava' if meta.get('strava_id') else 'file')
                    if res == 'added': added_ids.append(aid)
                    _update(job, done=1, **({'added': 1} if res == 'added' else {'duplicates': 1}))
                except Exception as e:   # one bad file never stops the import
                    _update(job, done=1, failed=1, message=f'{name}: {e}')
            _update(job, status='done', finished=dt.datetime.now(dt.timezone.utc))
            coach.after_import(user_id, added_ids)      # only recent activities get an (paid) AI note
        except Exception as e:
            traceback.print_exc()
            _update(job, status='failed', message=f'import stopped: {e}', finished=dt.datetime.now(dt.timezone.utc))
        finally:
            for p in paths:
                if '/uploads/' in p and os.path.isfile(p): os.remove(p)
            for d in {os.path.dirname(p) for p in paths if '/uploads/' in p}:
                try: os.rmdir(d)      # the job's upload folder, now empty
                except OSError: pass


def _dir_items(d):
    out = []
    for root, _, files in os.walk(d):
        if 'activities.csv' in files:
            return _strava_items(lambda n, root=root: open(os.path.join(root, n), 'rb').read(),
                                 lambda: open(os.path.join(root, 'activities.csv'), 'rb').read(), None)
        for f in sorted(files):
            if f.lower().endswith(EXTS):
                p = os.path.join(root, f); out.append((f, (lambda p=p: open(p, 'rb').read()), {}))
    return out


ZIP_TOTAL = 64 * 1024 ** 3        # everything in one export, unpacked (the biggest real Strava exports are a few GB)


def _zip_read(z, name, cap=parsers.MAX_FILE):
    """One file out of the zip, never more than cap bytes in memory (the sizes in a zip's header can lie)."""
    with z.open(name) as f:
        data = f.read(cap + 1)
    if len(data) > cap: raise parsers.ParseError(f'{name} unpacks to more than {cap // 1024 ** 2} MB - not a workout file')
    return data


def _zip_items(path, user_id):
    z = zipfile.ZipFile(path)
    if sum(i.file_size for i in z.infolist()) > ZIP_TOTAL: raise ValueError('That zip unpacks to more than 64 GB - not an export')
    names = z.namelist()
    csvname = next((n for n in names if n.rsplit('/', 1)[-1] == 'activities.csv'), None)
    if csvname:
        prefix = csvname[: -len('activities.csv')]
        gear_csv = {k: _zip_read(z, prefix + k) for k in ('shoes.csv', 'bikes.csv') if prefix + k in names}
        _import_gear(user_id, gear_csv)
        return _strava_items(lambda n: _zip_read(z, prefix + n), lambda: _zip_read(z, csvname), names, prefix)
    return [(n, (lambda n=n: _zip_read(z, n)), {}) for n in names if n.lower().endswith(EXTS) and not n.startswith('__MACOSX')]


def _num(v):
    try: return float(str(v).replace(',', ''))
    except (TypeError, ValueError): return None


STRAVA_SPORT = {'run': 'run', 'virtual run': 'run', 'trail run': 'run', 'ride': 'ride', 'virtual ride': 'ride',
                'e-bike ride': 'ride', 'mountain bike ride': 'ride', 'gravel ride': 'ride', 'walk': 'walk', 'hike': 'hike',
                'swim': 'swim'}


def _strava_items(read, read_csv, names, prefix=''):
    text = read_csv().decode('utf-8-sig', errors='replace')
    rows = list(csv.reader(io.StringIO(text)))
    if not rows: return []
    head = rows[0]
    first = {}
    for i, h in enumerate(head): first.setdefault(h.strip(), i)
    allidx = lambda h: [i for i, x in enumerate(head) if x.strip() == h]
    items = []
    for r in rows[1:]:
        g = lambda h: (r[first[h]].strip() if h in first and first[h] < len(r) else '')
        meta = {'name': g('Activity Name') or None, 'description': g('Activity Description') or None,
                'private_note': g('Activity Private Note') or None, 'gear': g('Activity Gear') or None,
                'commute': g('Commute').lower() in ('true', '1', 'yes'), 'strava_id': int(g('Activity ID')) if g('Activity ID').isdigit() else None}
        typ = g('Activity Type').lower()
        meta['sport'] = STRAVA_SPORT.get(typ) or parsers.sport_of(typ)
        meta['sport_label'] = g('Activity Type') or None      # Strava's own name, e.g. "Trail Run", "Yoga", "Golf"
        try: meta['start'] = dt.datetime.strptime(g('Activity Date'), '%b %d, %Y, %I:%M:%S %p').replace(tzinfo=dt.timezone.utc)
        except ValueError: meta['start'] = None
        # duplicated metric columns: the later "Distance" is metres, the first is km; "Elapsed Time" is seconds
        dists = [_num(r[i]) for i in allidx('Distance') if i < len(r)]
        dm = next((d for d in reversed(dists) if d), None)
        if dm is not None and len(dists) == 1: dm *= 1000
        meta['distance_m'] = dm
        meta['elapsed_s'] = next((_num(r[i]) for i in allidx('Elapsed Time') if i < len(r) and _num(r[i])), None)
        meta['moving_s'] = next((_num(r[i]) for i in allidx('Moving Time') if i < len(r) and _num(r[i])), None)
        fn = g('Filename')
        if fn:
            items.append((fn, (lambda fn=fn: read(fn)), meta))
        elif meta['start']:
            items.append((meta['name'] or 'manual entry', None, meta))
    return items


def _manual(user_id, meta):
    parsed = {'sport': meta['sport'], 'sub_sport': None, 'start': meta['start'], 'device': None, 'laps': [],
              'session': {'elapsed_s': meta.get('elapsed_s'), 'moving_s': meta.get('moving_s'), 'distance_m': meta.get('distance_m')},
              'streams': {k: [] for k in ('t',) + parsers.STREAMS}}
    return activities.store(user_id, parsed, meta, source='strava')


def _import_gear(user_id, files):
    with db.connect() as c:
        for fname, kind, col in (('shoes.csv', 'shoe', 'Shoe'), ('bikes.csv', 'bike', 'Bike')):
            if fname not in files: continue
            for r in csv.DictReader(io.StringIO(files[fname].decode('utf-8-sig', errors='replace'))):
                brand, model, name = (r.get(f'{col} Brand') or '').strip(), (r.get(f'{col} Model') or '').strip(), (r.get(f'{col} Name') or '').strip()
                # activities.csv refers to shoes as "brand model name" and bikes by name
                full = ' '.join(' '.join(x for x in ((brand, model, name) if kind == 'shoe' else (name or f'{brand} {model}',)) if x).replace('+', ' ').split())
                if not full: continue
                c.execute("""INSERT INTO gear (user_id, kind, name, brand, model) VALUES (%s, %s, %s, %s, %s)
                             ON CONFLICT (user_id, name) DO NOTHING""", (user_id, kind, full, brand or None, model or None))


if __name__ == '__main__':   # python -m app.importer <login> <path> [...]
    if len(sys.argv) < 3: sys.exit(__doc__)
    db.migrate()
    with db.connect() as c:
        u = c.execute('SELECT id FROM users WHERE login = %s', (sys.argv[1],)).fetchone()
    if not u: sys.exit(f'no user {sys.argv[1]}')
    paths = [os.path.abspath(p) for p in sys.argv[2:]]
    job = new_job(u['id'], 'server import: ' + ', '.join(os.path.basename(p) for p in paths))
    print(f'import job {job} started')
    _run(job, u['id'], paths)
    with db.connect() as c:
        r = c.execute('SELECT status, total, added, duplicates, failed, messages FROM imports WHERE id = %s', (job,)).fetchone()
    print(f"{r['status']}: {r['total']} items, {r['added']} added, {r['duplicates']} duplicates, {r['failed']} failed")
    for m in r['messages'][-20:]: print('  ', m)
