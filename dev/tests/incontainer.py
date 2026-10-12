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
print(f'in the container (AI + push): {n} checks passed')
