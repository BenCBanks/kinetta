"""Real throwaway SQL histories: brief presentation never changes data/default readers; unknown stays unknown."""
import datetime as dt
from contextlib import nullcontext
from unittest.mock import patch
from app.api_food import food_weeks
from app import db
from app.nutrition_insights import insights_data
with db.connect() as c:
    # Roll back the exact fictional fixture rather than writing through a production-facing API.
    c.execute('SAVEPOINT insights_test')
    try:
        uid=c.execute("INSERT INTO users(login,name,pw_hash) VALUES('zz_test_insights_contract','Fictional Insights','unused') RETURNING id").fetchone()['id']
        c.execute("INSERT INTO profile(user_id,tz,weight_kg,height_cm,birth_year,sex,kcal_target,protein_target) VALUES(%s,'UTC',70,174,1992,'female',2100,130)",(uid,))
        today=dt.datetime.now(dt.timezone.utc).date()
        for i in range(1,9):
            c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,ref) VALUES(%s,%s,'lunch','Fictional contract day',1800,120,200,65,%s::jsonb)",(uid,today-dt.timedelta(days=i),'{}'))
        full=insights_data(c,uid);brief=insights_data(c,uid,brief=True)
        assert {k:v for k,v in full.items() if k!='insights'}=={k:v for k,v in brief.items() if k!='insights'}
        assert full['insights']!=brief['insights'] and len(brief['insights'])<=2
        assert insights_data(c,uid)==full,'Default reader remains byte-for-byte equivalent'
        c.execute("UPDATE food_entries SET ref='{"+'"unknown_nutrients":["protein_g"]'+"}'::jsonb WHERE user_id=%s AND day=%s",(uid,today-dt.timedelta(days=1)))
        for mode in (False,True):
            result=insights_data(c,uid,brief=mode)
            assert result['summary']['avg_protein_g'] is None
            assert result['summary']['avg_eaten']==1800
            assert not any('protein' in text.lower() for _,text in result['insights'])
        c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g) VALUES(%s,%s,'lunch','Fictional zero',0,0,0,0)",(uid,today-dt.timedelta(days=10)))
        calendar=insights_data(c,uid)['rows']
        assert next(r for r in calendar if r['day']==str(today-dt.timedelta(days=10)))['entries']==1,'Zero-calorie logged days remain discoverable'
        def weeks():
            with patch('app.api_food.db.connect',return_value=nullcontext(c)):return food_weeks(26,user={'id':uid})
        before=weeks()
        monday=(today-dt.timedelta(days=1))-dt.timedelta(days=(today-dt.timedelta(days=1)).weekday())
        assert next(w for w in before['weeks'] if w['week']==str(monday))['protein_g'] is None,'Missing weekly nutrition is never zero'
        c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g) VALUES(%s,%s,'lunch','Fictional future',999999,999,999,999)",(uid,today+dt.timedelta(days=1)))
        assert weeks()==before,'Weekly food bases exclude future days'
        print('Real SQL optional brief/default/unknown-protein, logged-zero calendar and weekly missing/future bases PASS')
    finally:
        c.execute('ROLLBACK TO SAVEPOINT insights_test')
