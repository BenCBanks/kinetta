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
ck(r['by'] == 'ai' and len(r['added']) == 1 and r['dish']['items'][0]['units'] == {'each': 182.0}, f'ai add {r}')
ck('left that out' in r['reply'], 'impossible numbers (9000 kcal of oil) skipped and said')
ck('alex' not in asked_cook[-1] and 'Test cook chat' not in asked_cook[-1], 'only ingredients and the message are sent')
r = cook_chat.say(cd, cook_chat.SayIn(text='3 apples'), user={'id': uid})
ck(r['by'] == 'memory' and r['dish']['items'][-1]['grams'] == 546 and len(asked_cook) == 1, f'remembered size, no AI {r}')
first = r['dish']['items'][0]['id']
def fix(parts, schema, label, timeout=45):
    asked_cook.append(parts[0]['text'])
    return {'actions': [{'op': 'change', 'id': first, 'grams': 200}, {'op': 'remove', 'id': 'nope'}], 'reply': 'Made it 200 g.'}, {}, 'stand-in'
food_photo.ask = fix
r = cook_chat.say(cd, cook_chat.SayIn(text='oops the apples were 200 g'), user={'id': uid})
ck(r['changed'] == [first] and r['dish']['items'][0]['grams'] == 200 and r['removed'] == [], f'correction {r}')
ck(f'{first} | Apple | 364' in asked_cook[-1], 'the dish so far is sent so it can be corrected')
ck(refused(lambda: cook_chat.say(cd, cook_chat.SayIn(text='x'), user={'id': jid}), 404), "only the cook's dish")
with db.connect() as c: c.execute('UPDATE profile SET ai_ok = false WHERE user_id = %s', (uid,))
r = cook_chat.say(cd, cook_chat.SayIn(text='a pinch of saffron'), user={'id': uid})
ck(r.get('fallback') and r.get('needs_ok') and len(asked_cook) == 2, 'AI off: search instead, and nothing sent')
api_dishes.dish_delete(cd, user={'id': uid})

# --- phone push: what is sent, and the person's choices ---
sent = []
with db.connect() as c:
    c.execute('DELETE FROM push_subscriptions WHERE user_id = %s', (uid,))
    c.execute("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (%s, 'https://push.example/alex', 'k', 'a')", (uid,))
    nid = c.execute("INSERT INTO notifications (user_id, kind, actor_id, dish_id) VALUES (%s, 'dish_shared', %s, %s) RETURNING id", (uid, jid, tray)).fetchone()['id']
ck(notify.push(nid, send=lambda info, data: sent.append((info, json.loads(data)))) == 1, 'pushed once')
ck(sent[0][0]['endpoint'] == 'https://push.example/alex' and sent[0][1]['body'] == 'Jordan Lee shared Chicken and veg traybake with you'
   and sent[0][1]['url'] == f'/food/cook/{tray}', f'payload {sent[0][1]}')
notify.settings(notify.PrefsIn(dishes=False), user={'id': uid})
ck(notify.push(nid, send=lambda i, d: sent.append(d)) == 0 and len(sent) == 1, 'turned off: not pushed')
notify.settings(notify.PrefsIn(dishes=True), user={'id': uid})
ck(notify._vapid() is not None and len(notify._vapid()[1]) > 80, 'server push key')
with db.connect() as c:
    c.execute('DELETE FROM notifications WHERE id = %s', (nid,)); c.execute('DELETE FROM push_subscriptions WHERE user_id = %s', (uid,))
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
    ck(real_gemini({'q': 1}, 'x') == 'ok' and len(asked) == 3 and asked[0] == asked[1] != asked[2], f'busy model: retried, then the fallback {asked}')
    def bad(req, timeout=None):
        asked.append(1); raise urllib.error.HTTPError(req.full_url, 400, 'bad', {}, io.BytesIO(b'{}'))
    asked.clear(); urllib.request.urlopen = bad
    try: real_gemini({'q': 1}, 'x'); said = None
    except ValueError as e: said = str(e)
    ck(said and '(400)' in said and len(asked) == 1, f'a 400 is not retried {said} {asked}')
finally:
    urllib.request.urlopen, time.sleep = real_open, real_sleep
# the food estimator (photos, ingredients typed in a dish) does the same: busy twice, then the second model answers
asked.clear()
def food_busy(req, timeout=None):
    model = req.full_url.split('/models/')[1].split(':')[0]; asked.append(model)
    if len(asked) < 3: raise urllib.error.HTTPError(req.full_url, 503, 'busy', {}, io.BytesIO(b'{}'))
    return io.BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'text': '{"reply": "ok"}'}]}}]}).encode())
urllib.request.urlopen, time.sleep = food_busy, (lambda s: None)
try:
    out, _, model = real_food_ask([{'text': 'x'}], {'type': 'object', 'properties': {'reply': {'type': 'string'}}}, 'test')
    ck(out == {'reply': 'ok'} and len(asked) == 3 and asked[0] == asked[1] != asked[2] == model, f'food estimator: retried, then the second model {asked}')
    asked.clear(); urllib.request.urlopen = bad
    ck(refused(lambda: real_food_ask([{'text': 'x'}], {'type': 'object'}, 'test'), 502) and len(asked) == 1, 'food estimator: a 400 is not retried')
finally:
    urllib.request.urlopen, time.sleep = real_open, real_sleep

# packaged amounts are looked up first (2026-10-12): misspelled package words count, everyday words don't
ck(all(cook_chat.packaged(t) for t in ['one bx of pene', '2 packges of ramen', 'a botle of soy sauce', '1 can of tomatos', 'a jar of sauce']), 'package words, misspelled too')
ck(not any(cook_chat.packaged(t) for t in ['chicken in a pan', '2 apples', 'a pinch of salt', '3 cups of pasta', 'a banana']), 'everyday words are not packages')
ck(cook_chat.package_grams('14.5 ONZ') == 411.1 and cook_chat.package_grams('16 oz/454 g') == 454 and cook_chat.package_grams('1 LB') == 453.6, 'package weights')
seen = []
real_web, real_usda = cook_chat._web_product, cook_chat._usda_products
cook_chat._web_product = lambda t: (seen.append(('web', t)), {'source': 'web: Test shop', 'brand': None, 'name': 'Test protein penne', 'package_g': 411,
                                                              'per100': {'kcal': 339, 'protein_g': 18, 'carbs_g': 68, 'fat_g': 2, 'fiber_g': 9}})[1]
cook_chat._usda_products = lambda q: (seen.append(('usda', q)), [])[1]
try:
    refs = cook_chat.product_refs('one bx of bettr goods protien pene pasta')
    ck('Test protein penne | package 411 g' in refs and ('usda', 'bettr goods protien pene pasta') in seen, f'reference products for the model {seen}')
    seen.clear(); ck(cook_chat.product_refs('2 apples') == '' and not seen, 'no lookup for loose food')
    seen.clear(); cook_chat.food_photo._used[(999, 'web', __import__('datetime').date.today())] = cook_chat.WEB_LIMIT
    cook_chat.product_refs('a box of penne', 999); ck(seen == [('usda', 'penne')], f'over the web search brake: USDA only {seen}')
    seen.clear(); cook_chat.product_refs('a box of penne and 2 cans of beans', 998)
    ck(sorted(seen) == [('usda', 'beans'), ('usda', 'penne'), ('web', '2 cans of beans'), ('web', 'a box of penne')], f'each packaged part looked up {seen}')
finally:
    cook_chat._web_product, cook_chat._usda_products = real_web, real_usda

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

from app import api_connections as AC
first, again = AC.intervals_sync_now(user={'id': jid}), AC.intervals_sync_now(user={'id': jid})
ck(not first.get('already') and again.get('already'), 'Sync now: a second tap within 2 minutes starts nothing')
ck(not AC.intervals_sync_now(user={'id': uid}).get('already'), "one person's sync doesn't hold up another's")

print(f'in the container (AI + push): {n} checks passed')
