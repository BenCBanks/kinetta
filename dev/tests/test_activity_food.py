"""Synthetic combined weeks: no watch, calories, AI or full-day assumptions required."""
import datetime as dt,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from app.activity_food import summarize
now=dt.date(2026,10,17);y=now-dt.timedelta(days=1);start=now-dt.timedelta(days=7)
a=[{'day':y,'distance_m':5000,'moving_s':1800},{'day':start,'elapsed_s':1200},{'day':now,'distance_m':99999},{'day':start-dt.timedelta(days=1),'moving_s':99999}]
f=[{'day':y,'protein_g':120},{'day':start,'protein_g':0,'ref':{'unknown_nutrients':['protein_g']}},{'day':now,'protein_g':999}]
s=summarize(now,a,f,110);assert s['workouts']==2 and s['distance_m']==5000 and s['seconds']==3000 and s['days_logged']==2 and s['protein_days_reached']==1 and s['protein_days_unknown']==1 and s['protein_days_known']==1
assert summarize(now,[],[],None)['days_logged']==0
assert summarize(now,[],f,None)['protein_days_reached']==0
assert summarize(now,[],[{'day':y,'protein_g':0}],110)['protein_days_known']==1
assert summarize(now,[],[{'day':y,'protein_g':120},{'day':y,'protein_g':None}],110)['protein_days_reached']==0
print('Combined week synthetic local dates,7 completed days, workouts/distance/time, any-food consistency, protein unknown vs zero/current target and no-watch empty histories PASS')
