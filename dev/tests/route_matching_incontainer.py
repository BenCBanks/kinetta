"""Ordered route matching on synthetic GPS, with real PostGIS and private accounts."""
import datetime as dt
from app import db,activities,api_activities
uids=[]
LINE='LINESTRING(10 10,10.005 10.005,10.01 10)'
WRONG='LINESTRING(10 10,10.005 9.98,10.01 10)'
elapsed_rid=None;elapsed_ids=[]
try:
 with db.connect() as c:
  for suffix in ('a','b'):
   uid=c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',('zz_test_route_order_'+suffix,'Fictional route '+suffix)).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id) VALUES (%s)',(uid,))
  uid,other=uids;now=dt.datetime.now(dt.timezone.utc)
  def route(owner):return c.execute("INSERT INTO routes(user_id,sport,name) VALUES (%s,'walk','Fictional route') RETURNING id",(owner,)).fetchone()['id']
  def activity(owner,ago=0,rid=None,line=LINE,sport='run',distance=1800,corrected=False):
   return c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,distance_m,moving_s,elapsed_s,route_id,geom,start_pt,end_pt,summary_overrides)
     VALUES (%s,%s,'Fictional route fixture',%s,'file',%s,600,600,%s,ST_GeomFromText(%s,4326),
       ST_StartPoint(ST_GeomFromText(%s,4326))::geography,ST_EndPoint(ST_GeomFromText(%s,4326))::geography,%s) RETURNING id""",
     (owner,sport,now-dt.timedelta(days=ago),distance,rid,line,line,line,'{"distance_m":1800}' if corrected else '{}')).fetchone()['id']
  old,new,foreign=route(uid),route(uid),route(other)
  activity(uid,ago=10,rid=old);activity(uid,ago=5,rid=new)
  # A newer unmatched activity must not outrank an established route.
  activity(uid,ago=4)
  # These newer established routes must be rejected by the unchanged filters.
  activity(uid,ago=3,rid=old,line=WRONG)
  activity(uid,ago=2,rid=old,sport='ride')
  activity(uid,ago=1,rid=old,corrected=True)
  wrong_owner=activity(other,ago=0,rid=foreign)
  target=activity(uid,ago=-1)
  assert activities.match_route(c,uid,target)==new,'latest valid established route wins after rejecting invalid shapes/sports/corrections/other owner'
  assert c.execute('SELECT route_id FROM activities WHERE id=%s',(target,)).fetchone()['route_id']==new
  assert activities.match_route(c,uid,target)==new,'repeated matching is stable'
  assert activities.match_route(c,uid,wrong_owner) is None,'a foreign target is rejected'
  assert c.execute('SELECT route_id FROM activities WHERE id=%s',(wrong_owner,)).fetchone()['route_id']==foreign
  for kwargs in ({'distance':100},{'line':None},{'corrected':True}):
   skipped=activity(uid,ago=-2,**kwargs);assert activities.match_route(c,uid,skipped) is None
  # With no established route, the newest matching unassigned pair form a route.
  a=activity(other,ago=3,sport='ride');b=activity(other,ago=2,sport='ride')
  rid=activities.match_route(c,other,b);assert rid and rid!=foreign
  assert {r['route_id'] for r in c.execute('SELECT route_id FROM activities WHERE user_id=%s AND id=ANY(%s)',(other,[a,b]))}=={rid}
  # A genuinely different path never joins just because endpoints and distance fit.
  no_match=activity(other,ago=-1,line=WRONG,sport='ride');assert activities.match_route(c,other,no_match) is None
  elapsed_rid=c.execute("INSERT INTO routes(user_id,sport,name) VALUES (%s,'run','Fictional elapsed route') RETURNING id",(uid,)).fetchone()['id']
  for index,(moving,elapsed) in enumerate(((2400,3300),(2500,3150),(2600,3000),(2700,2700),(2685,2700),(2000,None))):
   line=LINE;geom='ST_GeomFromText(%s,4326)'
   row=c.execute(f"""INSERT INTO activities(user_id,sport,name,start_time,source,distance_m,moving_s,elapsed_s,route_id,geom,start_pt,end_pt)
       VALUES (%s,'run','Fictional paused route run',%s,'file',8046.72,%s,%s,%s,{geom},
       ST_StartPoint(ST_GeomFromText(%s,4326))::geography,ST_EndPoint(ST_GeomFromText(%s,4326))::geography) RETURNING id""",
       (uid,now-dt.timedelta(days=3-index),moving,elapsed,elapsed_rid,line,line,line)).fetchone()
   elapsed_ids.append(row['id'])
 route_data=api_activities.route(elapsed_rid,{'id':uid});assert route_data['fastest_id']==elapsed_ids[3],'route fastest badge follows elapsed duration even when moving time favors another run'
 assert route_data['pace_trend']['slope_per_day']<0,'elapsed pace trend improves while the moving-time trend would worsen';assert all(a['distance_m']==8046.72 for a in route_data['activities']),'route history preserves source distance'
 assert route_data['activities'][0]['elapsed_s']==3300 and route_data['activities'][0]['moving_s']==2400,'route API exposes separate elapsed and moving durations'
 equal=next(a for a in route_data['activities'] if a['id']==elapsed_ids[3]);close=next(a for a in route_data['activities'] if a['id']==elapsed_ids[4]);unknown=next(a for a in route_data['activities'] if a['id']==elapsed_ids[5])
 assert equal['elapsed_s']==equal['moving_s']==2700,'route detail keeps equal elapsed and moving durations'
 assert close['elapsed_s']==2700 and close['moving_s']==2685,'route detail preserves a sub-30-second pause difference'
 assert unknown['elapsed_s'] is None and unknown['moving_s']==2000,'route detail preserves unknown elapsed without substituting moving duration'
 listed=next(r for r in api_activities.routes({'id':uid}) if r['id']==elapsed_rid);assert listed['best_s']==2700,'route-list best_s now carries best elapsed duration'
 trends=api_activities.progress_trends('run',{'id':uid})['months'];trend=next(row for row in trends if row['n']>=3)
 with db.connect() as c:
  expected=c.execute("""SELECT sum(distance_m) FILTER (WHERE distance_m>0 AND elapsed_s>0) AS pace_d,
      sum(elapsed_s) FILTER (WHERE distance_m>0 AND elapsed_s>0) AS pace_t,
      sum(distance_m) FILTER (WHERE distance_m>0 AND moving_s>0) AS pd,
      sum(moving_s) FILTER (WHERE distance_m>0 AND moving_s>0) AS pt
      FROM activities WHERE user_id=%s AND sport='run' AND to_char(start_time AT TIME ZONE 'UTC','YYYY-MM')=%s""",(uid,trend['m'])).fetchone()
 assert all(trend[k]==expected[k] for k in ('pace_d','pace_t','pd','pt')),'monthly API separates elapsed pace totals from moving-time totals'
 assert trend['pace_t']!=trend['pt'],'paused fictional route durations affect pace without changing moving-time aggregate'
 volume=next(row for row in api_activities.progress_volume('month',{'id':uid})['rows'] if row['s']=='run' and row['p'].isoformat()==now.date().replace(day=1).isoformat())
 assert volume['pace_d']==expected['pace_d'] and volume['pace_t']==expected['pace_t'],'Progress Totals groups elapsed pace sums by period while excluding unknown-elapsed distance'
 with db.connect() as c:
  similar=api_activities._similar(c,uid,elapsed_ids[0],10)
  peer=next(r for r in similar if r['id']==elapsed_ids[2]);assert peer['elapsed_s']==3000 and peer['moving_s']==2600,'similar-activity API carries both source durations'
  equal_peer=next(r for r in similar if r['id']==elapsed_ids[3]);close_peer=next(r for r in similar if r['id']==elapsed_ids[4]);unknown_peer=next(r for r in similar if r['id']==elapsed_ids[5])
  assert equal_peer['elapsed_s']==equal_peer['moving_s']==2700 and close_peer['elapsed_s']==2700 and close_peer['moving_s']==2685,'similar API retains equal and under-30-second durations'
  assert unknown_peer['elapsed_s'] is None and unknown_peer['moving_s']==2000,'similar API does not synthesize elapsed time from moving time'
 print('Routes: elapsed-first fastest/best/pace trend and similar fields; moving efficiency and two-owner isolation preserved PASS')
 print('Route matching: newest established first, unmatched pair creation, shape/sport/distance/correction filters, replay and two-owner isolation PASS')
finally:
 if uids:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
