"""Date/context grammar and access boundary against isolated PostgreSQL; zero model calls."""
import datetime as dt
import os
from unittest.mock import patch
from fastapi import HTTPException
from app import db, meal_chat as chat, api_dishes, food_photo, ai_access
monday=dt.date(2026,10,12)
cases={
 'I had a 230 grams of the pasta I cooked on Monday':(['pasta'],{'grams':230.},monday),
 '230 g pasta from last Monday':(['pasta'],{'grams':230.},monday-dt.timedelta(days=7)),
 'half the pasta saved yesterday':(['pasta'],{'share':.5},monday-dt.timedelta(days=1)),
 '1½ servings of pasta':(['pasta'],{'count':1.5},None),
 'pasta saved on 2026-10-01 8oz':(['pasta'],{'grams':226.796},dt.date(2026,10,1)),
 '1,500g pasta':(['pasta'],{'grams':1500.},None),
 'make it 300 grams':([] ,{'grams':300.},None),
}
for text,expected in cases.items():
 p=chat.parse(text,monday);assert (p.get('query'),p.get('portion'),p.get('saved_day'))==expected,(text,p)
for text in ['230g pasta and salad','230g pasta\n100g rice','230g pasta not rice','230g pasta saved 2026-99-99','230g pasta Monday Tuesday','230g pasta for lunch and dinner','1/0 g pasta']:
 p=chat.parse(text,monday);assert 'error' in p,(text,p)
uid=None
try:
 with db.connect() as c:
  uid=c.execute("INSERT INTO users (login,name) VALUES ('zz_test_meal_dates','Meal Date Test') RETURNING id").fetchone()['id']
  c.execute("INSERT INTO profile (user_id,tz,ai_ok) VALUES (%s,'Pacific/Honolulu',false)",(uid,))
 user={'id':uid}
 d=api_dishes.dish_add(api_dishes.DishIn(name='Pasta'),user)
 api_dishes.dish_edit(d['id'],api_dishes.DishEdit(known_kcal=2000,cooked_g=1000),user)
 with db.connect() as c:
  # UTC Friday, local Thursday; use the actual saved local date, not the server's UTC date.
  c.execute("UPDATE dishes SET created='2026-10-16T02:00:00Z' WHERE id=%s AND user_id=%s",(d['id'],uid))
 with patch.dict(os.environ,{'KINETTA_AI_ACCESS_MODE':'entitled'}), patch.object(food_photo,'ask',side_effect=AssertionError('Saved meal must never call a model')):
  assert not ai_access.has(uid,'food')
  r=chat.resolve(chat.ResolveIn(text='230 grams of Pasta saved on 2026-10-15'),user)
  assert r['status']=='ready' and str(r['dish']['saved_day'])=='2026-10-15',r
  assert chat.resolve(chat.ResolveIn(text='230g Pasta saved 2026-10-16'),user)['status']=='no_match'
  body=chat.ConfirmIn(dish_id=d['id'],grams=230,issued=r['issued'],expected=r['expected'],client_id=r['client_id'],day='2026-10-20',meal='dinner',confirm=True)
  first=chat.confirm(body,user);assert not first['replayed']
  api_dishes.dish_delete(d['id'],user)
  assert chat.confirm(body,user)=={'id':first['id'],'replayed':True},'retry survives deleted source recipe'
  with db.connect() as c:
   e=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=%s',(uid,first['id'])).fetchone()
   assert e['kcal']==460 and str(e['day'])=='2026-10-20' and e['meal']=='dinner'
 print('Meal conversation: grammar/date/timezone, no model calls, consent/access independence and durable retry passed')
finally:
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s AND login=%s',(uid,'zz_test_meal_dates'))
