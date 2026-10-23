"""Tests that run inside the app container (docker compose exec -T app python - < this file), with the AI service and
the phone push replaced by stand-ins: what is sent, what is kept, consent and limits. Needs the demo data + stage.py
and a placeholder AI key (GEMINI_API_KEY) so the server thinks it has one; nothing leaves the machine."""
import json
from fastapi import HTTPException
from app import api_dishes, api_food, coach, cook_chat, db, food_coach, food_photo, notify

calls = []
def fake_model(ctx, system=None):
    calls.append((ctx, system))
    if 'dietitian' in system:
        return '```json\n' + json.dumps({"headline": "Steady fortnight.", "going_well": ["Logged most days.", "Good breakfasts."],
                                         "try_next": ["More protein on rest days."], "watch": None, "extra": "ignored"}) + '\n```'
    return json.dumps({"summary": "About 440 kcal a portion.", "ideas": [{"change": "<b>Less oil</b>", "effect": "-30 kcal"}], "note": None})
real_gemini = coach._gemini
def scoped_gemini(*args,**kwargs):
    with coach.ai_budget.scope(uid):return real_gemini(*args,**kwargs)
real_food_ask = food_photo.ask
coach._gemini = fake_model
n = 0
def ck(cond, m):
    global n; assert cond, m; n += 1
def refused(fn, code, text=''):
    try: fn(); return False
    except HTTPException as e: return e.status_code == code and text in str(e.detail)

with db.connect() as c:
    uid = c.execute("SELECT id FROM users WHERE login = 'alex'").fetchone()['id']
    jid = c.execute("SELECT id FROM users WHERE login = 'jordan'").fetchone()['id']
    tray = c.execute("SELECT id FROM dishes WHERE user_id = %s AND name = 'Chicken and veg traybake'", (uid,)).fetchone()['id']
    c.execute('DELETE FROM ai_requests'); c.execute("DELETE FROM coach_notes WHERE kind = 'diet'")
    c.execute('UPDATE dishes SET ai_note = NULL, ai_note_at = NULL'); c.execute('UPDATE saved_meals SET ai_note = NULL, ai_note_at = NULL')
    c.execute('UPDATE profile SET ai_ok = (user_id = %s)', (uid,))
    day = c.execute("SELECT max(day) AS d FROM food_entries WHERE user_id = %s", (uid,)).fetchone()['d']
api_dishes.share(tray, api_dishes.ShareIn(login='jordan'), user={'id': uid})

# --- the review of your eating ---
r = food_coach.diet_review(user={'id': uid}); ctx = calls[-1][0]
ck(r['headline'] == 'Steady fortnight.' and len(r['going_well']) == 2 and 'extra' not in r and 'watch' not in r, f'diet answer {r}')
ck(len(ctx['days']) >= 10 and {'kcal', 'protein_g', 'burned', 'exercise', 'partly_logged'} <= set(ctx['days'][0]), 'diet days')
ck(ctx['targets'].get('kcal_target') and ctx['most_eaten'] and ctx['meals'], 'targets, foods, meals')
ck('alex' not in json.dumps(ctx, default=str) and 'user_id' not in json.dumps(ctx, default=str), 'no usernames or ids sent')
ck(food_coach.diet_review_get(user={'id': uid})['latest']['headline'] == 'Steady fortnight.', 'kept')
ck(refused(lambda: food_coach.diet_review(user={'id': uid}), 429), 'not again within minutes')
ck(refused(lambda: food_coach.diet_review(user={'id': jid}), 400, 'AI features are off'), 'needs consent')

# --- feedback on a recipe and on a saved meal ---
r = food_coach.recipe_review(tray, user={'id': uid}); ctx = calls[-1][0]
ck(r['summary'].startswith('About') and r['ideas'][0]['change'] == '<b>Less oil</b>', 'recipe answer (escaped by the app)')
ck('target' not in json.dumps(ctx) and len(ctx['ingredients']) == 5, 'no personal targets: friends can read it')
ck(refused(lambda: food_coach.recipe_review(tray, user={'id': jid}), 404), 'only the cook asks')
ck(api_dishes.dish(tray, user={'id': jid})['review']['summary'].startswith('About'), 'the friend sees it')
api_dishes.portion(tray, api_dishes.PortionIn(grams=50, meal='dinner'), user={'id': uid})
ck(api_dishes.dish(tray, user={'id': uid})['review']['changed_since'] is False, 'a portion is not a recipe change')
ck(refused(lambda: food_coach.recipe_review(tray, user={'id': uid}), 429), 'not again without a change')
api_food.meal_save(api_food.MealIn(name='Test breakfast', from_day=day, meal='breakfast'), user={'id': uid})
mid = [m for m in api_food.meals(user={'id': uid}) if m['name'] == 'Test breakfast'][0]['id']
food_coach.meal_review(mid, user={'id': uid})
ck([m for m in api_food.meals(user={'id': uid}) if m['id'] == mid][0]['review']['summary'], 'saved meal feedback kept')

# --- the daily limit holds, however you ask ---
iid = api_dishes.dish(tray, user={'id': uid})['items'][0]['id']
for k in range(40):
    api_dishes.item_edit(tray, iid, api_dishes.ItemEdit(grams=600 + k + 1), user={'id': uid})
    try: food_coach.recipe_review(tray, user={'id': uid})
    except HTTPException as e:
        ck(e.status_code == 429 and 'Daily limit' in e.detail, f'limit {e.detail}'); break
with db.connect() as c: asked = c.execute('SELECT count(*) AS n FROM ai_requests WHERE user_id = %s', (uid,)).fetchone()['n']
ck(asked == food_coach.DAILY_LIMIT and len(calls) == food_coach.DAILY_LIMIT, f'{asked} requests, {len(calls)} model calls')
ck(food_coach._parse('not json') == {'text': 'not json'} and food_coach._parse('{"headline": 5, "going_well": "x"}') == {}, 'odd answers')

# --- cooking in plain words: the AI only when memory doesn't know, then remembered ---
asked_cook = []
def fake_ask(parts, schema, label, timeout=45):
    asked_cook.append(parts[0]['text'])
    return {'actions': [{'op': 'add', 'name': 'Apple', 'amount': '2 medium', 'grams': 364, 'kcal': 189, 'protein_g': 1, 'carbs_g': 50, 'fat_g': 0.6, 'fiber_g': 8.7},
                        {'op': 'add', 'name': 'Olive oil', 'amount': '1 tbsp', 'grams': 13.5, 'kcal': 9000, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 14}],
            'reply': 'Added 2 medium apples (about 360 g) and 1 tbsp olive oil.'}, {}, 'stand-in'
food_photo.ask = fake_ask
with db.connect() as c: c.execute('UPDATE profile SET ai_ok = (user_id = %s)', (uid,))
cd = api_dishes.dish_add(api_dishes.DishIn(name='Test cook chat'), user={'id': uid})['id']
r = cook_chat.say(cd, cook_chat.SayIn(text='2 apples and a tbsp of olive oil'), user={'id': uid})
ck(r['by']=='clarification' and not r['added'] and not asked_cook, 'unknown household amounts ask before a model can guess')
r = cook_chat.say(cd, cook_chat.SayIn(text='364 g apples and 13.5 g olive oil'), user={'id': uid})
ck(r['by'] == 'ai' and len(r['added']) == 1 and r['dish']['items'][0]['units'] == {}, f'ai add {r}')
ck('left that out' in r['reply'], 'impossible numbers (9000 kcal of oil) skipped and said')
ck('alex' not in asked_cook[-1] and 'Test cook chat' not in asked_cook[-1], 'only ingredients and the message are sent')
r = cook_chat.say(cd, cook_chat.SayIn(text='546 g apples'), user={'id': uid})
ck(r['by'] == 'memory' and r['dish']['items'][-1]['grams'] == 546 and len(asked_cook) == 1, f'remembered nutrition with explicit weight, no AI {r}')
first = r['dish']['items'][0]['id']
def fix(parts, schema, label, timeout=45):
    asked_cook.append(parts[0]['text'])
    return {'actions': [{'op': 'change', 'id': first, 'grams': 200}], 'reply': 'Made it 200 g.'}, {}, 'stand-in'
food_photo.ask = fix
r = cook_chat.say(cd, cook_chat.SayIn(text='oops the apples were 200 g'), user={'id': uid})
ck(r['by']=='clarification' and len(asked_cook)==1, 'two apple ingredients require clarification before any model or change')
r = cook_chat.say(cd, cook_chat.SayIn(text='change the 364 g apples to 200 g'), user={'id': uid})
ck(r['changed'] == [first] and r['dish']['items'][0]['grams'] == 200 and r['removed'] == [], f'correction {r}')
ck(f'{first} | Apple | 364' in asked_cook[-1], 'the dish so far is sent so it can be corrected')
ck(refused(lambda: cook_chat.say(cd, cook_chat.SayIn(text='x'), user={'id': jid}), 404), "only the cook's dish")
with db.connect() as c: c.execute('UPDATE profile SET ai_ok = false WHERE user_id = %s', (uid,))
r = cook_chat.say(cd, cook_chat.SayIn(text='1 g saffron'), user={'id': uid})
ck(r.get('fallback') and r.get('needs_ok') and len(asked_cook) == 2, 'AI off: search instead, and nothing sent')
api_dishes.dish_delete(cd, user={'id': uid})

# --- Native APNs: payload and preferences, with delivery replaced (no real phones) ---
from app.auth import new_session, token_hash
sent = []
with db.connect() as c:
    c.execute('DELETE FROM native_push_devices WHERE user_id = %s', (jid,))
    cook_name = c.execute('SELECT name FROM users WHERE id=%s',(uid,)).fetchone()['name']
    push_session = new_session(c, jid, 'zz_test_native_push')
    c.execute("INSERT INTO native_push_devices (user_id, token, environment, session_hash) VALUES (%s, %s, 'production', %s)", (jid, 'ab' * 32, token_hash(push_session)))
    nid = c.execute("INSERT INTO notifications (user_id, kind, actor_id, dish_id) VALUES (%s, 'dish_shared', %s, %s) RETURNING id", (jid, uid, tray)).fetchone()['id']
ck(notify.push(nid, send=lambda device, data: sent.append((device, data))) == 1, 'native pushed once')
ck(sent[0][0]['token'] == 'ab' * 32 and sent[0][1]['title'] == f'{cook_name} shared Chicken and veg traybake with you' and sent[0][1]['body'] == ''
   and sent[0][1]['url'] == f'/food/cook/{tray}', 'native payload')
notify.settings(notify.PrefsIn(dishes=False), user={'id': jid})
ck(notify.push(nid, send=lambda i, d: sent.append(d)) == 0 and len(sent) == 1, 'turned off: not pushed')
notify.settings(notify.PrefsIn(dishes=True), user={'id': jid})
with db.connect() as c:
    c.execute('DELETE FROM notifications WHERE id = %s', (nid,)); c.execute('DELETE FROM sessions WHERE token_hash = %s', (token_hash(push_session),))
    ck(not c.execute('SELECT 1 FROM native_push_devices WHERE user_id = %s', (jid,)).fetchone(), 'logout cascades device revocation')
    c.execute('UPDATE profile SET ai_ok = false'); c.execute('DELETE FROM ai_requests')
# --- 2026-10-12: a dish is kept until deleted, however old; one opened and left empty for a day is cleared away ---
old1 = api_dishes.dish_add(api_dishes.DishIn(name='Test old stew'), user={'id': uid})['id']
api_dishes.item_add(old1, api_dishes.ItemIn(name='Beans', grams=500, kcal=500), user={'id': uid})
empty = api_dishes.dish_add(api_dishes.DishIn(), user={'id': uid})['id']
with db.connect() as c:
    c.execute("UPDATE dishes SET updated = now() - interval '60 days' WHERE id = %s", (old1,))
    c.execute("UPDATE dishes SET updated = now() - interval '2 days' WHERE id = %s", (empty,))
ids = [d['id'] for d in api_dishes.dishes(user={'id': uid})]
with db.connect() as c:
    gone = c.execute('SELECT count(*) AS n FROM dishes WHERE id = %s', (empty,)).fetchone()['n'] == 0
ck(old1 in ids and gone, 'old dish kept, empty one cleared')
api_dishes.dish_delete(old1, user={'id': uid})

# the coach retries a busy model, then uses the lighter one (2026-10-12: Google answered 503 "high demand" at busy times)
import io, os, time, urllib.error, urllib.request
asked, real_open, real_sleep = [], urllib.request.urlopen, time.sleep
def busy_then_ok(req, timeout=None):
    model = req.full_url.split('/models/')[1].split(':')[0]; asked.append(model)
    if len(asked) < 3: raise urllib.error.HTTPError(req.full_url, 503, 'busy', {}, io.BytesIO(b'{}'))
    return io.BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'text': 'ok'}]}}]}).encode())
urllib.request.urlopen, time.sleep = busy_then_ok, (lambda s: None)
os.environ.setdefault('GEMINI_API_KEY', 'placeholder')
try:
    ck(scoped_gemini({'q': 1}, 'x') == 'ok' and len(asked) == 3 and asked[0] == asked[1] != asked[2], f'busy model: retried, then the fallback {asked}')
    def bad(req, timeout=None):
        asked.append(1); raise urllib.error.HTTPError(req.full_url, 400, 'bad', {}, io.BytesIO(b'{}'))
    asked.clear(); urllib.request.urlopen = bad
    try: scoped_gemini({'q': 1}, 'x'); said = None
    except ValueError as e: said = str(e)
    ck(said and '(400)' in said and len(asked) == 1, f'a 400 is not retried {said} {asked}')
finally:
    urllib.request.urlopen, time.sleep = real_open, real_sleep
# the food estimator (photos, ingredients typed in a dish) does the same: busy twice, then the second model answers
asked.clear()
def scoped_food_ask(*args, **kwargs):
    with food_photo.ai_budget.scope(uid): return real_food_ask(*args, **kwargs)
def food_busy(req, timeout=None):
    model = req.full_url.split('/models/')[1].split(':')[0]; asked.append(model)
    if len(asked) < 3: raise urllib.error.HTTPError(req.full_url, 503, 'busy', {}, io.BytesIO(b'{}'))
    return io.BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'text': '{"reply": "ok"}'}]}}]}).encode())
urllib.request.urlopen, time.sleep = food_busy, (lambda s: None)
try:
    out, _, model = scoped_food_ask([{'text': 'x'}], {'type': 'object', 'properties': {'reply': {'type': 'string'}}}, 'test')
    ck(out == {'reply': 'ok'} and len(asked) == 3 and asked[0] == asked[1] != asked[2] == model, f'food estimator: retried, then the second model {asked}')
    asked.clear(); urllib.request.urlopen = bad
    ck(refused(lambda: scoped_food_ask([{'text': 'x'}], {'type': 'object'}, 'test'), 502) and len(asked) == 1, 'food estimator: a 400 is not retried')
finally:
    urllib.request.urlopen, time.sleep = real_open, real_sleep
    with db.connect() as c:
        rows=c.execute('DELETE FROM ai_food_attempts WHERE user_id=%s AND kind=%s RETURNING day,charged_micros',(uid,'test')).fetchall()
        for row in rows:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(row['charged_micros'],row['day']))

# packaged amounts are looked up first (2026-10-12): misspelled package words count, everyday words don't
ck(all(cook_chat.packaged(t) for t in ['one bx of pene', '2 packges of ramen', 'a botle of soy sauce', '1 can of tomatos', 'a jar of sauce']), 'package words, misspelled too')
ck(not any(cook_chat.packaged(t) for t in ['chicken in a pan', '2 apples', 'a pinch of salt', '3 cups of pasta', 'a banana']), 'everyday words are not packages')
ck(cook_chat.package_grams('14.5 ONZ') == 411.1 and cook_chat.package_grams('16 oz/454 g') == 454 and cook_chat.package_grams('1 LB') == 453.6, 'package weights')
seen = []
real_usda = cook_chat._usda_products
cook_chat._usda_products = lambda q: (seen.append(('usda', q)), [])[1]
try:
    refs = cook_chat.product_refs('one bx of bettr goods protien pene pasta', uid)
    ck(refs == '' and seen == [('usda', 'bettr goods protien pene pasta')], f'reference products for the model {seen}')
    seen.clear(); ck(cook_chat.product_refs('2 apples') == '' and not seen, 'no lookup for loose food')
    seen.clear(); cook_chat.product_refs('a box of penne and 2 cans of beans', jid)
    ck(sorted(seen) == [('usda', 'beans'), ('usda', 'penne')], f'each package uses bounded catalog lookup; no paid grounding {seen}')

finally:
    cook_chat._usda_products = real_usda

# a photo of a nutrition label (2026-10-12): per-serving numbers -> per 100 g; package from servings x serving size
jpeg = 'data:image/jpeg;base64,' + __import__('base64').b64encode(b'\xff\xd8' + b'0' * 200).decode()
was_ask = food_photo.ask
label_out = {'readable': True, 'name': 'Protein penne', 'brand': 'Test', 'serving_label': '2 oz (56g)', 'serving_g': 56, 'servings_per_package': 7,
             'per_serving': {'kcal': 190, 'protein_g': 10, 'carbs_g': 38, 'fat_g': 1, 'fiber_g': 5}}
food_photo.ask = lambda parts, schema, label, timeout=45: (label_out, {}, 'stand-in')
try:
    with db.connect() as c: c.execute('UPDATE profile SET ai_ok = true WHERE user_id = %s', (uid,))
    L = food_photo.label(food_photo.LabelIn(image=jpeg), user={'id': uid})
    ck(round(L['per100']['kcal']) == 339 and round(L['per100']['protein_g'], 1) == 17.9 and L['package_g'] == 392 and L['serving']['g'] == 56, f'label read {L}')
    label_out = {**label_out, 'package_g': 411}; ck(food_photo.label(food_photo.LabelIn(image=jpeg), user={'id': uid})['package_g'] == 411, 'net weight wins')
    label_out = {'readable': False, 'note': 'That is a cat.'}
    ck(refused(lambda: food_photo.label(food_photo.LabelIn(image=jpeg), user={'id': uid}), 422, 'cat'), 'not a label: says why')
    label_out = {'readable': True, 'name': 'X', 'per_serving': {'kcal': 100}}
    ck(refused(lambda: food_photo.label(food_photo.LabelIn(image=jpeg), user={'id': uid}), 422, 'serving size'), 'no serving size: asks again')
    ck(refused(lambda: food_photo.label(food_photo.LabelIn(image='aGVsbG8='), user={'id': uid}), 400), 'not a JPEG')
finally:
    food_photo.ask = was_ask

# Describe or snap (2026-10-12): words alone are enough; several lines = a chat where later lines correct earlier ones
seen_parts = []
def words_ask(parts, schema, label, timeout=45):
    seen_parts.append(parts)
    return {'items': [{'name': 'Hot dog', 'amount': '2', 'kcal': 1100, 'protein_g': 40, 'carbs_g': 90, 'fat_g': 60}], 'notes': 'Costco hot dogs'}, {}, 'stand-in'
food_photo.ask = words_ask
try:
    r = food_photo.photo(food_photo.PhotoIn(note='a hot dog from Costco and a Diet Coke'), user={'id': uid})
    ck(r['items'][0]['name'] == 'Hot dog' and len(seen_parts[-1]) == 1 and 'no photo' in seen_parts[-1][0]['text'], 'words only: estimated without a photo')
    ck('later ones correct' not in seen_parts[-1][0]['text'], 'one message: no correction note')
    food_photo.photo(food_photo.PhotoIn(note='a hot dog from Costco and a Diet Coke\nmake it two hot dogs'), user={'id': uid})
    ck('later ones correct' in seen_parts[-1][0]['text'] and 'make it two' in seen_parts[-1][0]['text'], 'a correction: sent with the earlier words, marked as a correction')
    ck(refused(lambda: food_photo.photo(food_photo.PhotoIn(), user={'id': uid}), 400), 'nothing said, no photo: refused')
finally:
    food_photo.ask = was_ask

# --- 2026-10-12 server review: unpacking limits, and the coach's daily limit counts automatic notes ---
import gzip as _gz, io as _io, zipfile as _zf
from app import importer, parsers
big = _gz.compress(b'0' * (parsers.MAX_FILE + 10))
try: parsers.gunzip_capped(big); ck(False, 'gz bomb read')
except parsers.ParseError: ck(True, 'a .gz that unpacks too big is refused')
buf = _io.BytesIO()
with _zf.ZipFile(buf, 'w', _zf.ZIP_DEFLATED) as z: z.writestr('bomb.fit', b'0' * (parsers.MAX_FILE + 10))
z = _zf.ZipFile(buf)
try: importer._zip_read(z, 'bomb.fit'); ck(False, 'zip bomb read')
except parsers.ParseError: ck(True, 'a zip member that unpacks too big is refused')
with db.connect() as c:
    c.execute('UPDATE profile SET ai_ok = true WHERE user_id = %s', (uid,))
    keep = c.execute('SELECT id, ai_note, ai_note_at FROM activities WHERE user_id = %s ORDER BY id LIMIT %s', (uid, coach.DAILY_LIMIT + 1)).fetchall()
    c.execute("UPDATE activities SET ai_note = 'x', ai_note_at = now() WHERE id = ANY(%s)", ([r['id'] for r in keep[:coach.DAILY_LIMIT]],))
try:
    coach.note(uid, keep[-1]['id']); ck(False, 'over the limit')
except ValueError as e: ck('Daily limit' in str(e), 'automatic notes count towards the daily limit')
finally:
    with db.connect() as c:
        for r in keep: c.execute('UPDATE activities SET ai_note = %s, ai_note_at = %s WHERE id = %s', (r['ai_note'], r['ai_note_at'], r['id']))
        c.execute('UPDATE profile SET ai_ok = false WHERE user_id = %s', (uid,))

# New-workout delivery: real rows and actual push serialization, replaced transport (no phone/network).
import datetime as dt
from unittest.mock import patch
from app import activities, parsers
now = dt.datetime.now(dt.timezone.utc)
parsed = {'sport': 'run', 'sub_sport': None, 'start': now - dt.timedelta(hours=3), 'device': None, 'laps': [],
          'session': {'elapsed_s': 1800, 'moving_s': 1800, 'distance_m': 5000},
          'streams': {k: [] for k in ('t',) + parsers.STREAMS}}
with patch.object(notify.threading, 'Thread'):
    result, aid = activities.store(uid, parsed, {'name': 'Test ready workout'}, source='healthkit')
    ck(result == 'added', 'new Health workout saved')
    with db.connect() as c:
        c.execute("UPDATE profile SET notify = '{}'::jsonb, units = 'metric' WHERE user_id = %s", (uid,))
        push_session = new_session(c, uid, 'zz_test_new_workout')
        c.execute("INSERT INTO native_push_devices (user_id, token, environment, session_hash) VALUES (%s, %s, 'production', %s)", (uid, 'ab' * 32, token_hash(push_session)))
        # The same event replayed under a lock is still only one notification.
        notify.activity_loaded(c, uid, aid)
        rows = c.execute("SELECT id FROM notifications WHERE user_id = %s AND kind = 'activity_ready' AND activity_id = %s", (uid, aid)).fetchall()
        ck(len(rows) == 1, 'workout replay has one notification')
    sent = []
    ck(notify.push(rows[0]['id'], send=lambda info, data: sent.append(data)) == 1, 'new-workout push sent through existing delivery')
    ck(sent[0]['title'] == 'Nice work! Test ready workout saved' and sent[0]['body'] == '5.00 km · 30 min' and sent[0]['url'] == f'/activity/{aid}', 'descriptive title, metric summary and deep link')
    notify.settings(notify.PrefsIn(activities=False), user={'id': uid})
    ck(notify.push(rows[0]['id'], send=lambda i, d: sent.append(d)) == 0 and len(sent) == 1, 'disabled workout category sends nothing')
    with db.connect() as c:
        c.execute('DELETE FROM activities WHERE id = %s AND user_id = %s', (aid, uid))
        c.execute('DELETE FROM sessions WHERE token_hash = %s', (token_hash(push_session),))
        c.execute("UPDATE profile SET notify = '{}'::jsonb, units = 'imperial' WHERE user_id = %s", (uid,))
    # switched off: a new workout leaves no bell entry either; a workout typed in by hand is never celebrated
    parsed['start'] = now - dt.timedelta(hours=2)
    notify.settings(notify.PrefsIn(activities=False), user={'id': uid})
    _, off = activities.store(uid, parsed, {'name': 'Test quiet workout'}, source='healthkit')
    notify.settings(notify.PrefsIn(activities=True), user={'id': uid})
    parsed['start'] = now - dt.timedelta(hours=1)
    _, typed = activities.store(uid, parsed, {'name': 'Test typed workout'}, source='manual')
    with db.connect() as c:
        ck(not c.execute("SELECT 1 FROM notifications WHERE activity_id = ANY(%s) AND kind = 'activity_ready'", ([off, typed],)).fetchone(), 'switched off / typed in: no notification row')
        c.execute('DELETE FROM activities WHERE id = ANY(%s) AND user_id = %s', ([off, typed], uid))
    parsed['start'] = now - dt.timedelta(days=10)
    result, old = activities.store(uid, parsed, {'name': 'Test old import'}, source='file')
    with db.connect() as c:
        ck(not c.execute("SELECT 1 FROM notifications WHERE activity_id = %s AND kind = 'activity_ready'", (old,)).fetchone(), 'old bulk history is quiet')
        c.execute('DELETE FROM activities WHERE id = %s AND user_id = %s', (old, uid))

print(f'in the container (AI + push): {n} checks passed')
