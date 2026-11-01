"""Fictional own history for reuse chips; no provider or live account data."""
import datetime as dt
from zoneinfo import ZoneInfo
from kc import person
c=person('zz_test_food_memory_ui','Casey Example')
status,me=c.get('/api/me');assert status==200
day=str(dt.datetime.now(ZoneInfo(me['tz'])).date())
status,rows=c.get('/api/food/day?d='+day);assert status==200
names={row['name'] for row in rows['entries']}
for name,kcal in [('Wooden robot latte',180),('Vanilla latte',150),('Whole milk latte',170)]:
    if name in names:continue
    status,data=c.post('/api/food/entries',[{'day':day,'meal':'breakfast','name':name,'amount':1,'unit':'cup',
        'kcal':kcal,'protein_g':8,'carbs_g':20,'fat_g':7,'source':'quick'}])
    assert status in (200,201),(status,data)
print('Fictional food memory account ready')
