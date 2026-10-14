"""Synthetic recording coverage; no real records or device access."""
from app import activities
from app.parsers import STREAMS

def recording(times, gps=True, hr=True):
    s = {k:[] for k in STREAMS}
    s['t'] = times
    if gps: s.update(lat=[40+i*.001 for i in range(len(times))], lon=[-75]*len(times))
    if hr: s['hr'] = [140]*len(times)
    return s

full = recording([0,60,120,180,240,300,360,420,480,540,600])
partial = recording(list(range(0,61,2)))
merged = activities.merge_streams(full,partial)
assert merged['t']==full['t'] and merged['lat']==full['lat'] and merged['hr']==full['hr'], 'dense partial recording cannot erase full coverage'
richer = recording(list(range(0,601,10)),hr=False)
merged = activities.merge_streams(full,richer)
assert merged['t']==richer['t'] and merged['lat']==richer['lat'] and all(x==140 for x in merged['hr']), 'fuller GPS retains existing HR'
empty = recording([],False,False)
assert activities.merge_streams(full,empty)['lat']==full['lat']
print('Health recording coverage: partial/empty retries preserve fuller signals; fuller GPS retains existing HR')
