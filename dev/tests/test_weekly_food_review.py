"""Synthetic sparse/mixed/complete food weeks. No model or database needed."""
import datetime as dt,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from app.weekly_food_review import build
TODAY=dt.date(2026,10,17)
def food(days=1,**kwargs):return {'day':TODAY-dt.timedelta(days=days),'meal':'dinner','name':'Fictional beans','kcal':400,'protein_g':30,'fiber_g':8,'sodium_mg':300,'sugar_g':0,'saturated_fat_g':1,**kwargs}
r=build([],TODAY);assert r['days_logged']==0 and not r['suggestions'] and r['nutrients']['fiber_g']['recorded'] is None
r=build([food(0),food(8),food(7)],TODAY);assert r['entries']==1 and r['days_logged']==1 and r['start']=='2026-10-10' and r['end']=='2026-10-16'
r=build([food(1),food(2,sodium_mg=None,fiber_g=None),food(2,name='Fictional unknown',protein_g=0,ref={'unknown_nutrients':['protein_g']})],TODAY)
assert r['days_logged']==2 and r['entries']==3 and r['nutrients']['sugar_g']['recorded']==0 and r['nutrients']['sodium_mg']['unknown_count']==1
assert r['nutrients']['protein_g']['recorded']==60 and r['nutrients']['protein_g']['unknown_count']==1 and not r['nutrients']['protein_g']['complete']
assert len(r['suggestions'])==2 and 'Fictional beans' in r['suggestions'][0]['text'] and r['suggestions'][1]['kind']=='coverage'
rows=[food(n) for n in range(1,8)]+[food(n,meal='breakfast',name='Fictional yogurt',kcal=150,protein_g=5) for n in range(1,8)]
r=build(rows,TODAY);assert r['days_logged']==7 and r['nutrients']['protein_g']['complete'] and r['protein_by_meal'][0]['recorded']==35 and r['top_foods'][0]['name']=='Fictional beans'
assert len(r['suggestions'])==1 and r['suggestions'][0]['kind']=='protein_spread' and 'recorded' in r['suggestions'][0]['text']
rows=[food(n,protein_g=0,sodium_mg=None,sugar_g=None,saturated_fat_g=None) for n in range(1,8)];r=build(rows,TODAY);assert r['nutrients']['protein_g']['recorded']==0 and r['nutrients']['sugar_g']['recorded'] is None and r['suggestions'][0]['kind']=='coverage'
r=build([food(1,protein_g=float('nan'),sodium_mg=float('inf'))],TODAY);assert r['nutrients']['protein_g']['recorded'] is None and r['nutrients']['sodium_mg']['recorded'] is None
r=build([food(n,protein_g=10,meal=['breakfast','lunch','dinner'][n%3]) for n in range(1,8)],TODAY);assert r['suggestions'][0]['kind']=='usual'
assert len(r['top_foods'])<=5 and 'user_id' not in str(r)
print('Weekly food review: completed local dates, any-food days vs entries, sparse/mixed/complete data, protein spread, fiber/extras, zero/unknown/nonfinite, own sources and max2 nonjudgmental suggestions PASS')
