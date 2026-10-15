"""Describe what you ate: grammar, saved-date time zones, no model calls and durable retry, against isolated PostgreSQL."""
import datetime as dt
import os
from unittest.mock import patch
from app import db, meal_chat as chat, api_dishes, food_photo, ai_access
monday = dt.date(2026, 10, 12)
# sentence -> [(part words, portion)], meal, log day, saved day (no catalog: names are plain words)
cases = {
 'I had a 230 grams of the pasta I cooked on Monday': ([('a 230 grams of the pasta', {'grams': 230.})], None, None, monday),
 '230 g pasta from last Monday': ([('230 g pasta', {'grams': 230.})], None, None, monday - dt.timedelta(days=7)),
 'half the pasta I made yesterday': ([('half the pasta', {'share': .5})], None, None, monday - dt.timedelta(days=1)),
 'I had pasta yesterday': ([('pasta', None)], None, monday - dt.timedelta(days=1), None),
 '1½ servings of pasta for lunch': ([('1 1/2 servings of pasta', {'count': 1.5, 'unit': 'serving'})], 'lunch', None, None),
 '1,500g pasta': ([('1500 g pasta', {'grams': 1500.})], None, None, None),
 '2 eggs and toast for breakfast': ([('2 eggs', {'count': 2.}), ('toast', None)], 'breakfast', None, None),
 'a bowl of chili last night': ([('a bowl of chili', {'count': 1, 'unit': 'bowl'})], 'dinner', monday - dt.timedelta(days=1), None),
 'coffee without sugar': ([('coffee', None)], None, None, None),
}
for text, (want, meal, day, saved) in cases.items():
    parts, info = chat.describe(text, monday, [])
    got = [(p['text'], chat.read_part(p['text'], [])['portion']) for p in parts]
    assert (got, info['meal'], info['day'], info['saved_day']) == (want, meal, day, saved), (text, got, info)
for text in ['230g pasta for lunch and dinner', '230g pasta Monday Tuesday', '230g pasta tomorrow', '-230g pasta', '230g pasta saved 2026-99-99']:
    parts, info = chat.describe(text, monday, [])
    assert parts is None, (text, parts)
uid = None
try:
    with db.connect() as c:
        uid = c.execute("INSERT INTO users (login,name) VALUES ('zz_test_meal_dates','Meal Date Test') RETURNING id").fetchone()['id']
        c.execute("INSERT INTO profile (user_id,tz,ai_ok) VALUES (%s,'Pacific/Honolulu',false)", (uid,))
    user = {'id': uid}
    d = api_dishes.dish_add(api_dishes.DishIn(name='Pasta'), user)
    api_dishes.dish_edit(d['id'], api_dishes.DishEdit(known_kcal=2000, cooked_g=1000), user)
    with db.connect() as c:
        # UTC Friday, local Thursday: the saved date is the person's own date, not the server's
        c.execute("UPDATE dishes SET created='2026-10-16T02:00:00Z' WHERE id=%s AND user_id=%s", (d['id'], uid))
    with patch.dict(os.environ, {'KINETTA_AI_ACCESS_MODE': 'entitled'}), patch.object(food_photo, 'ask', side_effect=AssertionError('must never call a model')):
        assert not ai_access.has(uid, 'food')       # works with AI off: no consent, no access
        r = chat.resolve(chat.ResolveIn(say='230 grams of the Pasta I made on 2026-10-15'), user)
        assert r['status'] == 'ready' and r['items'][0]['saved_day'] == '2026-10-15', r
        item = r['items'][0]
        body = chat.ConfirmIn(items=[chat.ItemIn(kind=item['kind'], id=item['id'], portion=chat.Portion(**item['portion']), expected=item['expected'])],
                              issued=r['issued'], client_id=r['client_id'], day='2026-10-20', meal='dinner', confirm=True)
        first = chat.confirm(body, user); assert not first['replayed']
        api_dishes.dish_delete(d['id'], user)
        assert chat.confirm(body, user) == {'ids': first['ids'], 'replayed': True}, 'retry survives a deleted source'
        with db.connect() as c:
            e = c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=%s', (uid, first['ids'][0])).fetchone()
            assert e['kcal'] == 460 and str(e['day']) == '2026-10-20' and e['meal'] == 'dinner'
    print('Meal conversation: grammar, dates/time zone, no model calls, works without AI access, durable retry passed')
finally:
    if uid:
        with db.connect() as c: c.execute('DELETE FROM users WHERE id=%s AND login=%s', (uid, 'zz_test_meal_dates'))

# Product descriptions use public databases before an optional estimate, with all
# name/brand words retained and no personal catalog or model involved.
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app.auth import current_user
product = {'source': 'usda', 'id': 99001, 'name': 'Cocoa Crisp Cereal', 'brand': 'Example Brand',
           'per100': {'kcal': 400, 'protein_g': 10, 'carbs_g': 80, 'fat_g': 4, 'fiber_g': 2},
           'serving': {'g': 30, 'label': '30 g'}}
other = {**product, 'brand': 'Other Brand'}
generic = {**product, 'brand': None}
with patch.object(chat, '_search_usda', return_value=[other, generic, product]) as usda, patch.object(chat, '_search_off', return_value=[product]), patch.object(food_photo, 'ask', side_effect=AssertionError('no model')):
    r = chat.products('60 grams Example Brand Cocoa Crisp Cereal', {'id': -1})
    assert r['foods'] == [product] and r['portion'] == {'grams': 60}, r
    assert usda.call_args.args == ('example brand cocoa crisp cereal',), usda.call_args
    assert chat.products('Other Brand Cocoa Crisp Cereal', {'id': -1})['foods'] == [other]
    assert chat.products('Unknown Brand Cocoa Crisp Cereal', {'id': -1})['foods'] == []
    assert chat.products('-60g Example Cereal', {'id': -1})['foods'] == []
    app.dependency_overrides[current_user] = lambda: {'id': -1}
    try:
        client = TestClient(app)
        response = client.get('/api/food/meals-chat/products', params={'text': '60 grams Example Brand Cocoa Crisp Cereal'})
        assert response.status_code == 200 and response.json()['foods'] == [product]
        assert client.get('/api/food/meals-chat/products', params={'text': 'x' * 201}).status_code == 400
    finally: app.dependency_overrides.pop(current_user, None)
    assert TestClient(app).get('/api/food/meals-chat/products?text=cereal').status_code == 401
with patch.object(chat, '_search_usda', return_value=[]), patch.object(chat, '_search_off', return_value=[]):
    assert chat.products('Example Brand Cereal', {'id': -1})['foods'] == []
print('Product lookup: authenticated, bounded, portion-free full brand query; no generic/other-brand substitution, dedup, no-model and empty catalogs passed')

from app import api_food
uid = None
try:
    with db.connect() as c:
        uid = c.execute("INSERT INTO users (login,name) VALUES ('zz_test_product_brand','Brand Test') RETURNING id").fetchone()['id']
        c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))
    user = {'id': uid}
    api_food.food_add(api_food.FoodIn(name='Greek Yogurt', kcal=100), user)
    r = chat.resolve(chat.ResolveIn(say='Example Greek Yogurt'), user)
    assert r['items'][0]['status'] == 'unknown', 'an extra brand must not silently match generic stored yogurt'
    branded = api_food.food_add(api_food.FoodIn(name='Greek Yogurt', brand='Example', kcal=120), user)
    r = chat.resolve(chat.ResolveIn(say='Example Greek Yogurt'), user)
    assert r['items'][0]['status'] == 'ready' and r['items'][0]['id'] == branded['id'], r
    print('Stored foods: brand-aware matching; an extra brand cannot silently fall back to a generic food')
finally:
    if uid:
        with db.connect() as c: c.execute("DELETE FROM users WHERE id=%s AND login='zz_test_product_brand'", (uid,))
