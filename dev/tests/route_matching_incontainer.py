"""Ordered route matching on synthetic GPS, with real PostGIS and private accounts."""
import datetime as dt
from app import db,activities
uids=[]
LINE='LINESTRING(10 10,10.005 10.005,10.01 10)'
WRONG='LINESTRING(10 10,10.005 9.98,10.01 10)'
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
 print('Route matching: newest established first, unmatched pair creation, shape/sport/distance/correction filters, replay and two-owner isolation PASS')
finally:
 if uids:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
