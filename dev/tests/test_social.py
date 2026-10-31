"""Friends, sharing, hidden map ends, the friends feed, cheers and comments (api_social.py). Runs on the demo data:
alex shares with friends after stage.py, so it first puts alex back to "only me"."""
import json, math, sys, urllib.parse
from kc import ALEX, Client, login, person

ok_n = 0


def check(cond, msg):
    global ok_n
    if not cond: print('FAIL', msg); sys.exit(1)
    ok_n += 1


class S:
    """want = the expected status; anything else fails the test."""
    def __init__(self, c): self.c = c
    def q(self, m, p, b=None, want=200):
        code, data = self.c.req(m, p, b if b is not None else ({} if m != 'GET' else None))
        check(code == want, f'{m} {p} -> {code} (wanted {want}) {str(data)[:200]}')
        return data


alex = S(login(*ALEX))
fr, st, pe = (S(person(w)) for w in ('zz_test_friend', 'zz_test_stranger', 'zz_test_pending'))
people = {'zz_test_friend': fr, 'zz_test_stranger': st, 'zz_test_pending': pe}

# start clean: alex shares nothing, and has no zz_test friends or requests
alex.q('PUT', '/api/sharing', {'default': 'me', 'trim_m': 400})
for a in alex.q('GET', '/api/activities?limit=100'):
    if a['visibility'] != 'me': alex.q('PUT', f"/api/activities/{a['id']}/sharing", {'visibility': 'me', 'usual_details': True})
for who, s in people.items(): s.q('DELETE', '/api/friends/alex'); alex.q('DELETE', f'/api/friends/{who}')
before = alex.q('GET', '/api/friends/waiting')['n']
for a in alex.q('GET', '/api/activities?limit=20&before=2026-10-03T00:00:00Z'):      # left over from an earlier failed run
    if a['start_time'][:10] in ('2026-10-01', '2026-10-02') and (a['distance_m'] in (900, None) or a['sport'] == 'walk') and a['name'] in ('Morning Run', 'Morning Walk') and (a['moving_s'] in (600, 900)):
        alex.q('DELETE', f"/api/activities/{a['id']}")

# --- friends ---
alex.q('POST', '/api/friends', {'login': 'nobody_here'}, want=404)
alex.q('POST', '/api/friends', {'login': 'alex'}, want=400)
r = fr.q('POST', '/api/friends', {'login': 'ALEX'}); check(r['status'] == 'sent', 'request sent (case-insensitive)')
r = pe.q('POST', '/api/friends', {'login': 'alex'}); check(r['status'] == 'sent', 'pending sent')
check(alex.q('GET', '/api/friends/waiting')['n'] == before + 2, 'alex has 2 more waiting')
check(alex.q('GET', '/api/me')['friend_requests'] == before + 2, '/api/me count')
r = alex.q('POST', '/api/friends/zz_test_friend/accept'); check(r['waiting'] == before + 1, 'one left after accept')
fl = alex.q('GET', '/api/friends')
check('zz_test_friend' in [f['login'] for f in fl['friends']] and 'zz_test_pending' in [f['login'] for f in fl['incoming']], 'friend lists')
fr.q('POST', '/api/friends', {'login': 'alex'}, want=409)
# stranger asks and cancels; then asks again and alex declines
st.q('POST', '/api/friends', {'login': 'alex'}); st.q('DELETE', '/api/friends/alex')
check(alex.q('GET', '/api/friends/waiting')['n'] == before + 1, 'cancel removes request')
st.q('POST', '/api/friends', {'login': 'alex'}); alex.q('POST', '/api/friends/zz_test_stranger/decline')
check(st.q('GET', '/api/friends')['outgoing'] == [], 'declined request is gone')

# --- sharing ---
sh = alex.q('GET', '/api/sharing')
check(sh['default'] == 'me' and sh['trim_m'] == 400 and sh['details'] == {'map': True, 'heart_rate': False, 'pace': True, 'splits': True,
      'elevation': True, 'calories': False, 'description': True, 'device': True}, f'safe defaults {sh}')
alex.q('PUT', '/api/sharing', {'trim_m': 300}, want=400)
alex.q('PUT', '/api/sharing', {'details': {'password': True}}, want=400)
feed = alex.q('GET', '/api/activities?limit=20')
# the newest few carry the demo's cheers and comments: the first three with a map and nothing on them yet
a1, a2, a3 = [x['id'] for x in feed if x['line'] and not x['cheers'] and not x['comments']][:3]
check(all(s.q('GET', f'/api/shared/{a1}', want=404) for s in (fr, st, pe)), 'private by default: nobody sees it')
alex.q('PUT', f'/api/activities/{a1}/sharing', {'visibility': 'friends'})
alex.q('PUT', f'/api/activities/{a2}/sharing', {'visibility': 'everyone'})
own_rows=alex.q('GET','/api/activities?limit=100')
check(all(aid in [a['id'] for a in own_rows] for aid in (a1,a2,a3)),'Activity and Me own-reader include both shared and private workouts')
from urllib.parse import urlencode
first=own_rows[0];later=alex.q('GET','/api/activities?'+urlencode({'limit':100,'before':first['start_time'],'before_id':first['id']}))
check(first['id'] not in [a['id'] for a in later] and [a['id'] for a in later[:3]]==[a['id'] for a in own_rows[1:4]],'own pagination includes private rows with the same time/id cursor')
check(all(a3 not in [a['id'] for a in other.q('GET','/api/feed/friends?limit=100')] for other in (fr,st,pe)),'other people never receive the owner private workout in their feeds')
fr.q('PUT', f'/api/activities/{a1}/sharing', {'visibility': 'everyone'}, want=404)   # not the owner
v = fr.q('GET', f'/api/shared/{a1}')
st.q('GET', f'/api/shared/{a1}', want=404); pe.q('GET', f'/api/shared/{a1}', want=404)
st.q('GET', f'/api/activities/{a1}/social', want=404)
st.q('POST', f'/api/activities/{a1}/cheer', want=404)
st.q('POST', f'/api/activities/{a1}/comments', {'text': 'hi'}, want=404)
check(st.q('GET', f'/api/shared/{a2}')['id'] == a2, 'everyone: a non-friend sees it')
st.q('GET', f'/api/activities/{a1}', want=404)   # the owner's own detail endpoint stays owner-only

never = ('private_note', 'ai_note', 'file_path', 'file_sha256', 'user_id', 'start_pt', 'end_pt', 'geom', 'strava_id', 'source_id',
         'gear_id', 'route_id', 'tz', 'avg_power', 'avg_cad')
for k in never + ('avg_hr', 'max_hr', 'zones', 'effort', 'calories'): check(k not in v, f'{k} absent from a friend view')
check(v['line'] and v['ends_hidden'], 'map shared, ends trimmed')
check('hr' not in (v.get('chart') or {}), 'no HR chart series')
check(all('avg_hr' not in s for s in v.get('splits_mi', [])), 'no HR in splits')
check('avg_hr' not in json.dumps(fr.q('GET', '/api/feed/friends')), 'no HR anywhere in the feed')

# map trimming really drops the ends: the owner's line is longer than the shared one, and the ends differ
def decode(s):
    out, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        vals = []
        for _ in (0, 1):
            sh, res = 0, 0
            while True:
                b = ord(s[i]) - 63; i += 1; res |= (b & 0x1f) << sh; sh += 5
                if b < 0x20: break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]; lon += vals[1]; out.append((lat / 1e5, lon / 1e5))
    return out
def dist(p, q): return math.hypot((p[0] - q[0]) * 111320, (p[1] - q[1]) * 111320 * math.cos(math.radians(p[0])))
full = decode(alex.q('GET', f'/api/activities/{a1}')['line']); part = decode(v['line'])
d0, d1 = dist(full[0], part[0]), dist(full[-1], part[-1])
print(f'trim 400 m: shared map starts {d0:.0f} m and ends {d1:.0f} m (straight line) from the real start/end')
check(d0 > 100 and d1 > 100, 'shared map starts and ends away from the real start and end')

# details: turn HR on for one activity only, then back to usual
alex.q('PUT', f'/api/activities/{a1}/sharing', {'details': {**sh['details'], 'heart_rate': True, 'map': False}})
v2 = fr.q('GET', f'/api/shared/{a1}')
check('avg_hr' in v2 and v2['line'] is None, 'per-activity override: HR on, map off')
so = alex.q('GET', f'/api/activities/{a1}/social'); check(so['custom'] and so['visibility'] == 'friends', 'owner sees sharing state')
alex.q('PUT', f'/api/activities/{a1}/sharing', {'usual_details': True})
check('avg_hr' not in fr.q('GET', f'/api/shared/{a1}'), 'back to usual: HR gone')
# pace off: no pace numbers, splits or time axis
alex.q('PUT', '/api/sharing', {'details': {'pace': False}})
v3 = fr.q('GET', f'/api/shared/{a1}')
check('gap_s_per_km' not in v3 and 'splits_mi' not in v3 and 'laps' not in v3 and 't' not in (v3.get('chart') or {}), 'pace off')
alex.q('PUT', '/api/sharing', {'details': sh['details']})
# trim choices + too short to trim
alex.q('PUT', '/api/sharing', {'trim_m': 0}); check(len(decode(fr.q('GET', f'/api/shared/{a1}')['line'])) == len(full), 'trim off: whole route')
alex.q('PUT', '/api/sharing', {'trim_m': 800}); check(fr.q('GET', f'/api/shared/{a1}')['line'], 'trim 800')
alex.q('PUT', '/api/sharing', {'trim_m': 400})
short = alex.q('POST', '/api/activities/manual', {'sport': 'run', 'start': '2026-10-01T07:00', 'duration_s': 600, 'distance_m': 900})['id']
alex.q('PUT', f'/api/activities/{short}/sharing', {'visibility': 'friends'})
check(fr.q('GET', f'/api/shared/{short}')['line'] is None, 'no route: no map')

# --- feed ---
f = fr.q('GET', '/api/feed/friends?limit=2')
check([x['id'] for x in f] == [a1, a2], f'friend feed newest first {[x["id"] for x in f]}')
f2 = fr.q('GET', '/api/feed/friends?limit=2&before=' + urllib.parse.quote(f[-1]['start_time']))
check(short in [x['id'] for x in f2], 'feed page 2')
check(st.q('GET', '/api/feed/friends') == [], 'non-friend feed empty')
check(pe.q('GET', '/api/feed/friends') == [], 'pending feed empty')

# --- cheers + comments ---
# you can cheer your own activity (2026-10-12): it counts, shows as cheered in your list, and doesn't notify you
r = alex.q('POST', f'/api/activities/{a1}/cheer'); check(r['cheered'] and r['mine'] and len(r['cheers']) == 1, 'cheer your own')
check(any(x['id'] == a1 and x['cheered'] and x['cheers'] == 1 for x in alex.q('GET', '/api/activities?limit=100')), 'own list says cheered')
check(not any(i['kind'] == 'cheer' and i['who']['login'] == 'alex' for i in alex.q('GET', '/api/notifications')['items']), 'no note to yourself')
alex.q('DELETE', f'/api/activities/{a1}/cheer')
r = fr.q('POST', f'/api/activities/{a1}/cheer'); check(r['cheered'] and r['cheers'][0]['login'] == 'zz_test_friend', 'cheered, who')
fr.q('POST', f'/api/activities/{a1}/cheer')
check(len(alex.q('GET', f'/api/activities/{a1}/social')['cheers']) == 1, 'one cheer per person')
evil = '<img src=x onerror=alert(1)>'
r = fr.q('POST', f'/api/activities/{a1}/comments', {'text': evil}); cid = r['comments'][-1]['id']
check(r['comments'][-1]['text'] == evil, 'comment stored as plain text (escaped when shown)')
fr.q('POST', f'/api/activities/{a1}/comments', {'text': 'x' * 501}, want=422)
fr.q('POST', f'/api/activities/{a1}/comments', {'text': '   '}, want=400)
r = fr.q('POST', f'/api/activities/{a1}/comments', {'text': 'Nice run!'}); cid2 = r['comments'][-1]['id']
st.q('DELETE', f'/api/comments/{cid}', want=404)                 # not theirs
fr.q('DELETE', f'/api/comments/{cid}')                           # own comment
alex.q('DELETE', f'/api/comments/{cid2}')                        # owner deletes any comment on their activity
check(alex.q('GET', f'/api/activities/{a1}/social')['comments'] == [], 'comments deleted')
fr.q('DELETE', f'/api/activities/{a1}/cheer')
# unfriend: friends-only activity disappears
fr.q('DELETE', '/api/friends/alex'); fr.q('GET', f'/api/shared/{a1}', want=404)
check(fr.q('GET', '/api/feed/friends') == [], 'after unfriending: feed empty')
# new activities follow the person's default
alex.q('PUT', '/api/sharing', {'default': 'friends'})
n2 = alex.q('POST', '/api/activities/manual', {'sport': 'walk', 'start': '2026-10-02T07:00', 'duration_s': 900})['id']
check(alex.q('GET', f'/api/activities/{n2}/social')['visibility'] == 'friends', 'new activity uses default')
# a lifting session still being logged is nobody else's until it's finished, and can be discarded outright (28 October 2026)
lid = alex.q('POST', '/api/lifts/start', {})['id']
alex.q('PUT', f'/api/activities/{lid}/sharing', {'visibility': 'everyone'})
fr.q('GET', f'/api/shared/{lid}', want=404)   # open session hidden from a friend
check(lid not in [x.get('id') for x in fr.q('GET', '/api/feed/friends?limit=50')], 'open session not in the friends feed')
alex.q('PUT', f'/api/activities/{lid}/lifts', {'exercises': [], 'finish': True})
fr.q('GET', f'/api/shared/{lid}')   # finished: shared as chosen
alex.q('DELETE', f'/api/activities/{lid}')
lid = alex.q('POST', '/api/lifts/start', {})['id']
alex.q('DELETE', f'/api/activities/{lid}'); alex.q('GET', f'/api/activities/{lid}/lifts', want=404)
check(alex.q('GET', '/api/lifts/sessions?limit=5') == [] or all(s['id'] != lid for s in alex.q('GET', '/api/lifts/sessions?limit=5')), 'discarded session is gone')
alex.q('PUT', '/api/sharing', {'default': 'me'})
for i in (short, n2): alex.q('DELETE', f'/api/activities/{i}')
for i in (a1, a2): alex.q('PUT', f'/api/activities/{i}/sharing', {'visibility': 'me'})
alex.q('DELETE', '/api/friends/zz_test_pending')
print(f'friends and sharing: {ok_n} checks passed')
