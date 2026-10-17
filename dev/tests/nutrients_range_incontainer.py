"""Range nutrient coverage is own recorded data, including genuine zero, never inferred intake."""
import datetime as dt,uuid,json
from app import db,nutrition_insights as I
uids=[]
try:
 with db.connect() as c:
  for _ in range(2):
   uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',('zz_test_nutrient_range_'+uuid.uuid4().hex[:12],'Fictional nutrient review')).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'UTC')",(uid,))
 day=dt.datetime.now(dt.timezone.utc).date();uid,other=uids
 with db.connect() as c:
  for owner,sodium,sugar,sat,ref in [(uid,300,0,.5,None),(uid,None,None,None,None),(uid,900,2,1,{'unknown_nutrients':['sodium_mg']}),(other,9999,90,90,None)]:
   c.execute('INSERT INTO food_entries(user_id,day,meal,name,kcal,sodium_mg,sugar_g,saturated_fat_g,ref) VALUES(%s,%s,\'lunch\',\'Fictional bowl\',300,%s,%s,%s,%s)',(owner,day,sodium,sugar,sat,json.dumps(ref)))
  data=I.insights_data(c,uid,7);extra=data['extra_nutrients'];assert extra['sodium_mg']['recorded']==300 and extra['sodium_mg']['known_count']==1 and extra['sodium_mg']['unknown_count']==2 and not extra['sodium_mg']['complete'],extra
  assert extra['sugar_g']['recorded']==2 and extra['sugar_g']['known_count']==2
  assert I.insights_data(c,other,7)['extra_nutrients']['sodium_mg']['recorded']==9999
  c.execute('DELETE FROM food_entries WHERE user_id=%s',(uid,));empty=I.insights_data(c,uid,7)['extra_nutrients'];assert all(v['recorded'] is None and v['unknown_count']==0 and not v['complete'] for v in empty.values())
 print('Range nutrient summary: actual same-transaction records, owner isolation, missing flags, unknown-vs-zero and empty range PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
