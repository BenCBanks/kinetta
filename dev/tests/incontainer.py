"""Tests that run inside the app container (docker compose exec -T app python - < this file), with the AI service and
the phone push replaced by stand-ins: what is sent, what is kept, consent and limits. Needs the demo data + stage.py
and a placeholder AI key (GEMINI_API_KEY) so the server thinks it has one; nothing leaves the machine."""
import json
from fastapi import HTTPException
from app import api_dishes, api_food, coach, db, food_coach, notify

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
