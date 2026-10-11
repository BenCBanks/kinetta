"""AI coach notes. Off until an AI key is set (.env or the container environment):
  GEMINI_API_KEY (preferred when both are set; model GEMINI_MODEL, default gemini-3.8-flash), or
  ANTHROPIC_API_KEY (Claude, claude-opus-5-5 at low effort).

- Automatic: a short note for each NEW activity (started in the last 3 days) right after import - never for bulk history.
- On demand: "Get coach note" on any activity, max 30 per person per day.
- Only the person's own numbers are sent. The model is told to be specific, honest about missing data and never invent.
Cost: one short request (~2k tokens in, ~300 out) per note on claude-opus-5-5 at low effort - about a cent.
"""
import datetime as dt
import json
import os
import threading

from . import db

MODEL = 'claude-opus-5-5'
DAILY_LIMIT = 30
_client = None
_lock = threading.Lock()

SYSTEM = """You are a friendly, expert endurance coach writing a short note about one workout for the athlete who did it.
You get the workout's numbers and their recent training as JSON. Write 3-5 sentences of plain text (no headings, no lists,
no emojis): what stood out (compare with their own recent history, matched-route history and records when given), one
thing to watch, and a concrete suggestion for the next session. Use the athlete's units (given as "units"). Only use the
numbers provided; if something important is missing (for example no heart rate), say so briefly instead of guessing.
Never give medical diagnoses; suggest seeing a professional only for clear warning signs."""


def provider():
    if os.environ.get('GEMINI_API_KEY'): return 'gemini'
    if os.environ.get('ANTHROPIC_API_KEY'): return 'claude'
    return None


def enabled():
    return provider() is not None


def _gemini(ctx, system=None):
    """Gemini generateContent over HTTPS (key in a header, never in the URL)."""
    import urllib.error, urllib.request
    model = os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash')
    body = {'systemInstruction': {'parts': [{'text': system or SYSTEM}]},
            'contents': [{'role': 'user', 'parts': [{'text': json.dumps(ctx, default=str)}]}],
            'generationConfig': {'maxOutputTokens': 2000, 'temperature': 0.6}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', json.dumps(body).encode(),
                                 {'Content-Type': 'application/json', 'x-goog-api-key': os.environ['GEMINI_API_KEY']})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise ValueError(f'The coach is unavailable right now ({e.code}).')
    except (urllib.error.URLError, TimeoutError):
        raise ValueError("Couldn't reach the coach - check the server's internet connection.")
    cands = d.get('candidates') or []
    if not cands: raise ValueError('The coach declined to comment on this one.')
    return ''.join(p.get('text', '') for p in (cands[0].get('content') or {}).get('parts', [])).strip()


def client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic(timeout=60.0, max_retries=2)
    return _client


def _context(c, user_id, aid):
    a = c.execute("""SELECT a.id, a.sport, a.sport_label, a.name, a.start_time, a.tz, a.distance_m, a.moving_s, a.elapsed_s, a.ascent_m,
                       a.avg_hr, a.max_hr, a.avg_cad, a.avg_power, a.norm_power, a.gap_s_per_km, a.effort, a.decoupling, a.vo2max,
                       a.avg_temp, a.zones, a.splits_mi, a.splits_km, a.route_id, a.description, a.lengths, a.swolf, a.vam, a.steps
                     FROM activities a WHERE a.id = %s AND a.user_id = %s""", (aid, user_id)).fetchone()
    if not a: return None
    p = c.execute('SELECT units, max_hr, rest_hr, sex, birth_year FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}
    recent = c.execute("""SELECT start_time::date AS day, distance_m, moving_s, avg_hr, effort FROM activities
                          WHERE user_id = %s AND sport = %s AND id <> %s AND start_time BETWEEN %s - interval '42 days' AND %s
                          ORDER BY start_time DESC LIMIT 30""", (user_id, a['sport'], aid, a['start_time'], a['start_time'])).fetchall()
    weeks = c.execute("""SELECT date_trunc('week', start_time)::date AS week, round(sum(distance_m)) AS distance_m, round(sum(moving_s)) AS moving_s,
                           round(sum(coalesce(effort, 0))) AS effort FROM activities WHERE user_id = %s
                           AND start_time BETWEEN %s - interval '8 weeks' AND %s GROUP BY 1 ORDER BY 1""", (user_id, a['start_time'], a['start_time'])).fetchall()
    route = []
    if a['route_id']:
        route = c.execute("""SELECT start_time::date AS day, moving_s, avg_hr, avg_temp FROM activities WHERE route_id = %s AND user_id = %s
                             ORDER BY start_time""", (a['route_id'], user_id)).fetchall()
    efforts = c.execute("""SELECT b.label, b.elapsed_s,
                             (SELECT min(p.elapsed_s) FROM best_efforts p WHERE p.user_id = b.user_id AND p.sport = b.sport
                                AND p.distance_m = b.distance_m AND p.start_time < b.start_time) AS previous_best_s
                           FROM best_efforts b WHERE b.activity_id = %s AND b.user_id = %s ORDER BY b.distance_m""", (aid, user_id)).fetchall()
    a = {k: v for k, v in a.items() if v is not None}
    splits = a.pop('splits_mi', None) if p.get('units', 'imperial') == 'imperial' else a.pop('splits_km', None)
    a.pop('splits_km', None); a.pop('splits_mi', None)
    return {'units': p.get('units', 'imperial'), 'athlete': {k: v for k, v in p.items() if v is not None and k != 'units'},
            'workout': a, 'splits': splits, 'best_efforts_in_this_workout': efforts, 'same_sport_last_6_weeks': recent,
            'weekly_totals_all_sports': weeks, 'same_route_history': route,
            'notes': 'distance_m metres, *_s seconds, gap_s_per_km = grade-adjusted pace in seconds per km, effort = TRIMP, '
                     'decoupling = % heart-rate drift first vs second half, zones = seconds in HR zones 1-5'}


WEEK_SYSTEM = """You are a friendly, expert endurance and nutrition coach writing a weekly review for one athlete.
You get their week as JSON (activities, totals vs the previous 4 weeks, fitness/fatigue, records, food totals and targets
if they log food, weight trend). Keep it SHORT: at most 4 sentences, about 70 words, plain text, no lists or headings.
Sentence 1 is a one-line summary of the week (it is shown on its own as a headline). Then the one thing that matters most
(an improvement, or something to watch such as a load jump, too little easy running, or eating far off target), and
1-2 concrete suggestions for next week.
Use their units. Only use the numbers given; say so briefly when data is missing. No medical diagnoses."""


def _week_context(c, user_id, week_start):
    p = c.execute('SELECT units, tz, kcal_target, protein_target, carbs_target, fat_target FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}
    tz = p.get('tz') or db.DEFAULT_TZ
    rng = (week_start, week_start + dt.timedelta(days=7))
    acts = c.execute("""SELECT (start_time AT TIME ZONE tz)::date AS day, sport, name, distance_m, moving_s, ascent_m, avg_hr, effort, decoupling,
                          vo2max, gap_s_per_km FROM activities WHERE user_id = %s AND (start_time AT TIME ZONE tz)::date >= %s
                          AND (start_time AT TIME ZONE tz)::date < %s ORDER BY start_time""", (user_id, *rng)).fetchall()
    prev = c.execute("""SELECT date_trunc('week', start_time AT TIME ZONE tz)::date AS week, sport, count(*) AS n, round(sum(distance_m)) AS distance_m,
                          round(sum(moving_s)) AS moving_s, round(sum(coalesce(effort, 0))) AS effort FROM activities WHERE user_id = %s
                          AND (start_time AT TIME ZONE tz)::date >= %s - 28 AND (start_time AT TIME ZONE tz)::date < %s GROUP BY 1, 2 ORDER BY 1""",
                     (user_id, week_start, week_start)).fetchall()
    prs = c.execute("""SELECT b.sport, b.label, b.elapsed_s FROM best_efforts b JOIN activities a ON a.id = b.activity_id
                       WHERE b.user_id = %s AND (b.start_time AT TIME ZONE a.tz)::date >= %s AND (b.start_time AT TIME ZONE a.tz)::date < %s
                         AND NOT EXISTS (SELECT 1 FROM best_efforts o WHERE o.user_id = b.user_id AND o.sport = b.sport AND o.distance_m = b.distance_m
                                         AND o.start_time < b.start_time AND o.elapsed_s <= b.elapsed_s)""", (user_id, *rng)).fetchall()
    food = c.execute("""SELECT day, round(sum(kcal)) AS kcal, round(sum(protein_g)) AS protein_g, round(sum(carbs_g)) AS carbs_g, round(sum(fat_g)) AS fat_g
                        FROM food_entries WHERE user_id = %s AND day >= %s AND day < %s GROUP BY day ORDER BY day""", (user_id, *rng)).fetchall()
    w = c.execute('SELECT day, kg FROM weights WHERE user_id = %s AND day >= %s - 28 AND day < %s ORDER BY day', (user_id, week_start, rng[1])).fetchall()
    return {'units': p.get('units', 'imperial'), 'week_start': week_start, 'activities': acts, 'previous_4_weeks': prev,
            'new_personal_records': prs, 'food_days': food, 'targets': {k: v for k, v in p.items() if k.endswith('_target') and v},
            'weights_last_5_weeks': w, 'notes': 'distance_m metres, *_s seconds, effort = TRIMP, decoupling = % HR drift'}


def week_review(user_id, week_start=None):
    """Writes (or rewrites) the review for the week starting Monday week_start (default: this week)."""
    if not enabled(): raise ValueError('The coach is not switched on yet (needs an AI key on the server).')
    if week_start is None:
        today = dt.date.today(); week_start = today - dt.timedelta(days=today.weekday())
    with db.connect() as c:
        ctx = _week_context(c, user_id, week_start)
    if not ctx['activities'] and not ctx['food_days']: raise ValueError('Nothing logged this week yet.')
    text = _gemini(ctx, WEEK_SYSTEM) if provider() == 'gemini' else _claude(ctx, WEEK_SYSTEM)
    if not text: raise ValueError('The coach returned an empty review.')
    with db.connect() as c:
        c.execute("""INSERT INTO coach_notes (user_id, kind, period_start, text) VALUES (%s, 'week', %s, %s)
                     ON CONFLICT (user_id, kind, period_start) DO UPDATE SET text = excluded.text, created = now()""", (user_id, week_start, text))
    return text


def weekly_scheduler():
    """Sunday ~6 PM (server local): a review for everyone who logged something this week."""
    import time
    while True:
        now = dt.datetime.now()
        target = (now + dt.timedelta(days=(6 - now.weekday()) % 7)).replace(hour=18, minute=0, second=0, microsecond=0)
        if target <= now: target += dt.timedelta(days=7)
        time.sleep((target - now).total_seconds())
        if not enabled(): continue
        with db.connect() as c:
            ids = [r['id'] for r in c.execute('SELECT id FROM users').fetchall()]
        for uid in ids:
            try: week_review(uid)
            except Exception as e: print('weekly review', uid, e, flush=True)


def note(user_id, aid, on_demand=False):
    """Writes activities.ai_note; returns the text (or raises ValueError with a friendly message)."""
    if not enabled(): raise ValueError('The coach is not switched on yet (needs an AI key on the server).')
    with db.connect() as c:
        if on_demand:
            n = c.execute("""SELECT count(*) AS n FROM activities WHERE user_id = %s AND ai_note_at > now() - interval '1 day'""", (user_id,)).fetchone()['n']
            if n >= DAILY_LIMIT: raise ValueError('Daily limit for coach notes reached - try again tomorrow.')
        ctx = _context(c, user_id, aid)
    if not ctx: raise ValueError('Activity not found')
    text = _gemini(ctx) if provider() == 'gemini' else _claude(ctx)
    if not text: raise ValueError('The coach returned an empty note.')
    with db.connect() as c:
        c.execute('UPDATE activities SET ai_note = %s, ai_note_at = now() WHERE id = %s AND user_id = %s', (text, aid, user_id))
    return text


def _claude(ctx, system=None):
    import anthropic
    try:
        r = client().beta.messages.create(
            model=MODEL, max_tokens=2000, system=system or SYSTEM,
            output_config={'effort': 'low'},
            betas=['server-side-fallback-2026-07-01'], fallbacks='default',
            messages=[{'role': 'user', 'content': json.dumps(ctx, default=str)}])
    except anthropic.RateLimitError:
        raise ValueError('The coach is busy - try again in a minute.')
    except anthropic.APIStatusError as e:
        raise ValueError(f'The coach is unavailable right now ({e.status_code}).')
    except anthropic.APIConnectionError:
        raise ValueError("Couldn't reach the coach - check the server's internet connection.")
    if r.stop_reason == 'refusal':
        raise ValueError('The coach declined to comment on this one.')
    return ''.join(b.text for b in r.content if b.type == 'text').strip()


def after_import(user_id, ids):
    """Background: notes for activities that started in the last 3 days (bulk history never triggers paid calls)."""
    if not enabled() or not ids: return
    def run():
        with _lock:
            with db.connect() as c:
                fresh = [r['id'] for r in c.execute("""SELECT id FROM activities WHERE user_id = %s AND id = ANY(%s) AND ai_note IS NULL
                                                       AND start_time > now() - interval '3 days' ORDER BY start_time LIMIT 5""", (user_id, ids)).fetchall()]
            for aid in fresh:
                try: note(user_id, aid)
                except Exception as e: print('coach note failed', aid, e, flush=True)
    threading.Thread(target=run, daemon=True).start()
