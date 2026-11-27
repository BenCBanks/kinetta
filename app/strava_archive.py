"""Bounded Strava archive inspection. Never extracts paths or writes workouts."""
from contextlib import contextmanager
import datetime as dt
import gzip
import io
import json
import math
from pathlib import PurePosixPath
import stat
import subprocess
import sys
import zipfile
import zlib

MAX_ENTRIES = 20000
MAX_ITEMS = 10000
MAX_EXPANDED = 8 * 1024**3
MAX_FILE = 32 * 1024**2
MAX_CSV = 8 * 1024**2
MAX_RATIO = 200


class ArchiveError(ValueError):
    pass


@contextmanager
def open_archive(path):
    # Bound the central directory before ZipFile allocates one object per declared entry.
    with open(path,'rb') as f:
        end=zipfile._EndRecData(f)
        if not end:raise ArchiveError('not_zip')
        if end[zipfile._ECD_ENTRIES_TOTAL]>MAX_ENTRIES or end[zipfile._ECD_SIZE]>16*1024**2:
            raise ArchiveError('too_many_entries')
        with zipfile.ZipFile(f) as z:yield z


def checked_names(z):
    infos = z.infolist()
    if len(infos) > MAX_ENTRIES: raise ArchiveError('too_many_entries')
    if sum(i.file_size for i in infos) > MAX_EXPANDED: raise ArchiveError('expanded_limit')
    names = set()
    for i in infos:
        p = PurePosixPath(i.filename)
        if (not i.filename or p.is_absolute() or '..' in p.parts or '\\' in i.filename
                or '\x00' in i.filename or i.filename in names or len(i.filename)>512
                or stat.S_ISLNK(i.external_attr >> 16) or i.flag_bits & 1):
            raise ArchiveError('unsafe_archive')
        if i.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED): raise ArchiveError('unsupported_compression')
        if i.file_size > max(1, i.compress_size)*MAX_RATIO: raise ArchiveError('compression_limit')
        names.add(i.filename)
    return names


def read_entry(z, name, cap=MAX_FILE):
    info = z.getinfo(name)
    if info.file_size > cap: raise ArchiveError('entry_limit')
    try:
        with z.open(info) as f: raw = f.read(cap+1)
    except (zipfile.BadZipFile,zlib.error,RuntimeError,EOFError):raise ArchiveError('unreadable') from None
    if len(raw)>cap: raise ArchiveError('entry_limit')
    return raw


def items(z):
    from . import importer
    names = checked_names(z)
    csvs = [n for n in names if PurePosixPath(n).name=='activities.csv']
    if len(csvs)!=1: raise ArchiveError('not_strava_export')
    csvname = csvs[0]; prefix = csvname[:-len('activities.csv')]
    raw = read_entry(z,csvname,MAX_CSV)
    # A malformed/foreign CSV must not turn into an apparently successful empty import.
    import csv
    try:
        rows=csv.reader(io.StringIO(raw.decode('utf-8-sig',errors='replace')))
        head=next(rows,[]);count=0
        for row in rows:
            if any(value.strip() for value in row):count+=1
            if count>MAX_ITEMS:raise ArchiveError('too_many_workouts')
    except csv.Error:raise ArchiveError('invalid_csv') from None
    if not {'Activity ID','Activity Date','Activity Type','Filename'}.issubset(head): raise ArchiveError('not_strava_export')
    try: result = importer._strava_items(lambda n:read_entry(z,prefix+n),lambda:raw,names,prefix)
    except (ValueError,OverflowError,csv.Error): raise ArchiveError('invalid_csv') from None
    result += [('unreadable row',None,{}) for _ in range(count-len(result))]
    if not result: raise ArchiveError('no_workouts')
    if len(result)>MAX_ITEMS: raise ArchiveError('too_many_workouts')
    return result


def parse_item(name, load, meta):
    from . import parsers
    if meta.get('strava_id') is not None and not 0<meta['strava_id']<=9223372036854775807:raise ArchiveError('unreadable')
    if load is None:
        if (not meta.get('start') or not meta.get('elapsed_s') or meta['elapsed_s']<=0
                or any(v is not None and (not math.isfinite(v) or v<0) for v in (meta.get('elapsed_s'),meta.get('moving_s'),meta.get('distance_m')))):
            raise ArchiveError('unreadable')
        return {'sport':meta['sport'],'sub_sport':None,'start':meta['start'],'device':None,'laps':[],
                'session':{k:meta.get(k) for k in ('elapsed_s','moving_s','distance_m')},
                'streams':{k:[] for k in ('t',)+parsers.STREAMS}},None
    raw = load()
    # Bound gzip before the existing parser's larger legacy limit.
    if name.lower().endswith('.gz'):
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as g: unpacked=g.read(MAX_FILE+1)
        except (OSError,EOFError,zlib.error):raise ArchiveError('unreadable') from None
        if len(unpacked)>MAX_FILE: raise ArchiveError('entry_limit')
    # Parse in a separate process: adversarial XML/FIT cannot exhaust the web worker.
    proc = subprocess.run([sys.executable,'-m','app.strava_archive',name],input=raw,
                          stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25)
    if proc.returncode or len(proc.stdout)>64*1024**2: raise ArchiveError('unreadable')
    parsed=json.loads(proc.stdout)
    if parsed['start']: parsed['start']=dt.datetime.fromisoformat(parsed['start'])
    return parsed,raw


def candidate(parsed,meta):
    session=parsed.get('session') or {};streams=parsed['streams']
    start=parsed.get('start') or meta.get('start')
    if not start: raise ArchiveError('unreadable')
    return {'start':start,'sport':meta.get('sport') or parsed['sport'],
            'distance_m':session.get('distance_m') or meta.get('distance_m') or next((v for v in reversed(streams.get('dist',[])) if v is not None),0),
            'elapsed_s':session.get('elapsed_s') or meta.get('elapsed_s') or (streams['t'][-1] if streams['t'] else 0)}


if __name__=='__main__':
    import resource
    resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2))
    resource.setrlimit(resource.RLIMIT_CPU,(15,15))
    resource.setrlimit(resource.RLIMIT_FSIZE,(64*1024**2,64*1024**2))
    from . import parsers
    raw=sys.stdin.buffer.read(MAX_FILE+1)
    if len(raw)>MAX_FILE:sys.exit(1)
    out=json.dumps(parsers.read(sys.argv[1],raw),default=str,separators=(',',':'))
    if len(out)>32*1024**2:sys.exit(1)
    print(out)
