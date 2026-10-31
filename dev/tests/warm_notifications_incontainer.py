"""Real owner-scoped SQL and device/session delivery with a local send stand-in."""
import datetime as dt
import unittest
from unittest.mock import patch

from app import auth, db, notify, notification_facts, notification_words

UTC=dt.timezone.utc
NOW=dt.datetime(2026,10,31,18,tzinfo=UTC)


class WarmNotifications(unittest.TestCase):
    def setUp(self):
        self.ids=[]
        with db.connect() as c:
            for suffix,name in [('owner','Alex Example'),('actor','Jordan Example'),('other','Casey Example')]:
                uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',('zz_test_warm_'+suffix,name)).fetchone()['id'];self.ids.append(uid)
                c.execute("INSERT INTO profile(user_id,units,tz) VALUES(%s,'imperial','America/New_York')",(uid,))
        self.owner,self.actor,self.other=self.ids
        self.addCleanup(self.clean)

    def clean(self):
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def activity(self,start,metres=5000,sport='run',uid=None,seconds=1800,**extra):
        with db.connect() as c:
            aid=c.execute("""INSERT INTO activities(user_id,sport,name,start_time,elapsed_s,moving_s,distance_m,source,visibility,lift_open)
              VALUES(%s,%s,'Fictional workout',%s,%s,%s,%s,'manual','me',%s) RETURNING id""",(uid or self.owner,sport,start,seconds,seconds,metres,extra.get('lift_open',False))).fetchone()['id']
        return aid

    def effort(self,aid,seconds,metres=5000,uid=None,label='untrusted imported label'):
        with db.connect() as c:
            c.execute("""INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time)
              SELECT %s,id,sport,%s,%s,%s,start_time FROM activities WHERE id=%s""",(uid or self.owner,metres,label,seconds,aid))

    def notice(self,aid):
        with db.connect() as c:return c.execute("INSERT INTO notifications(user_id,actor_id,kind,activity_id) VALUES(%s,%s,'activity_ready',%s) RETURNING id",(self.owner,self.owner,aid)).fetchone()['id']

    def row(self,nid):
        with db.connect() as c:return c.execute(notify._LIST+' WHERE n.id=%s',(nid,)).fetchone()

    def facts(self,nid,now=NOW):
        row=self.row(nid)
        with db.connect() as c:return row,notification_facts.read(c,row,now)

    def test_plain_owner_numbers_canonical_best_and_ties(self):
        old=self.activity(NOW-dt.timedelta(days=3),7000);self.effort(old,1500)
        current=self.activity(NOW-dt.timedelta(hours=2),5000);nid=self.notice(current)
        self.assertEqual(notification_facts.read.__module__,'app.notification_facts')
        row,facts=self.facts(nid);self.assertNotIn('\n',notify._push_words(row,facts)[1])
        self.effort(current,1450);row,facts=self.facts(nid)
        self.assertIn('New 5K best: 24:10',notify._push_words(row,facts)[1]);self.assertNotIn('untrusted',str(facts))
        self.assertIn('Alex',notify._push_words(row)[0]);self.assertNotIn('Jordan',notify._push_words(row)[0])
        self.assertEqual(notify._words(row)[1],f'/activity/{current}?edit=1')
        self.assertIn('3.11 mi in 30 min',notify._push_words(row)[1])
        # Another person's faster effort never changes this owner's best.
        other=self.activity(NOW-dt.timedelta(days=4),5000,uid=self.other);self.effort(other,1000,uid=self.other)
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'New 5K best: 24:10')
        with db.connect() as c:c.execute('UPDATE best_efforts SET elapsed_s=1450 WHERE activity_id=%s',(old,))
        row,facts=self.facts(nid);self.assertFalse(notification_words.highlight(row,facts))

    def test_fractional_mile_effort_uses_real_column_precision(self):
        old=self.activity(NOW-dt.timedelta(days=3),7000);current=self.activity(NOW-dt.timedelta(hours=2),5000)
        self.effort(old,500,1609.344);self.effort(current,480,1609.344)
        row,facts=self.facts(self.notice(current));self.assertEqual(notification_words.highlight(row,facts),'New 1 mile best: 8:00')

    def test_push_words_sports_other_kinds_and_original_destinations(self):
        row={'activity_id':2,'user_id':self.owner,'recipient_name':'Alex Example','name':'Jordan Example','activity':'Morning Run','sport':'run','distance_m':8062.81344,'moving_s':2460,'units':'imperial','comment':'Looking good','kind':'activity_ready'}
        for sport,label in [('run','run'),('ride','ride'),('walk','walk'),('hike','hike'),('swim','swim'),('row','row'),('ski','ski'),('workout','workout')]:
            for aid in (1,2,3):
                title,body=notify._push_words({**row,'sport':sport,'activity_id':aid})
                self.assertIn(label,title.lower());self.assertIn('Alex',title);self.assertLess(len(title),40);self.assertNotIn('\n',body)
        self.assertIn('lift',notify._push_words({**row,'sport':'workout','has_lifts':True})[0].lower())
        for kind,expected,link in [('cheer','Jordan Example cheered your Morning Run','/activity/2'),('friend_accepted','You and Jordan Example are now friends','/activity'),('milestone','100th run','/me/milestones')]:
            notice={**row,'kind':kind,'milestone_title':'100th run'}
            self.assertEqual(notify._words(notice),(expected,link));self.assertEqual(notify._push_words(notice)[1],expected)
        title,body=notify._push_words({**row,'kind':'comment'});self.assertEqual(title,'New comment');self.assertEqual(body,'Jordan Example commented on your Morning Run\nLooking good')

    def test_longest_current_period_strict_and_completed_only(self):
        self.activity(NOW-dt.timedelta(days=40),40000,sport='ride')
        self.activity(NOW-dt.timedelta(days=4),10000,sport='ride')
        current=self.activity(NOW-dt.timedelta(hours=2),20000,sport='ride');nid=self.notice(current)
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'Longest ride this month')
        self.activity(NOW+dt.timedelta(days=1),90000,sport='ride')
        self.activity(NOW-dt.timedelta(hours=1),90000,sport='ride',lift_open=True)
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'Longest ride this month')
        self.activity(NOW-dt.timedelta(hours=1),20000,sport='ride')
        row,facts=self.facts(nid);self.assertFalse(notification_words.highlight(row,facts),'A later completed tie invalidates the current-record claim')

    def test_weekly_known_distance_and_break(self):
        self.activity(NOW-dt.timedelta(days=2),8000,sport='walk');self.activity(NOW-dt.timedelta(days=1),5000,sport='walk')
        current=self.activity(NOW-dt.timedelta(hours=2),5000,sport='walk');nid=self.notice(current)
        row,facts=self.facts(nid);self.assertEqual(facts['weekly'],{'count':3,'distance_m':18000})
        self.assertTrue(notification_words.highlight(row,facts).startswith('3rd walk this week'))
        with db.connect() as c:c.execute('UPDATE activities SET distance_m=NULL WHERE user_id=%s AND id<>%s',(self.owner,current))
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'3rd walk this week')
        with db.connect() as c:c.execute('DELETE FROM activities WHERE user_id=%s AND id<>%s',(self.owner,current))
        self.activity(NOW-dt.timedelta(days=15),5000,sport='walk')
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'First walk in 2 weeks. Welcome back')

    def test_unknown_competitor_cannot_establish_longest(self):
        self.activity(NOW-dt.timedelta(days=40),40000,sport='ride')
        self.activity(NOW-dt.timedelta(days=4),10000,sport='ride')
        current=self.activity(NOW-dt.timedelta(hours=2),20000,sport='ride');nid=self.notice(current)
        self.activity(NOW-dt.timedelta(hours=1),None,sport='ride')
        row,facts=self.facts(nid);self.assertEqual(facts['longest']['month']['unknown'],1)
        self.assertFalse(notification_words.highlight(row,facts))

    def test_owner_invalid_time_and_missing_generation_fail_closed(self):
        current=self.activity(NOW-dt.timedelta(hours=2));nid=self.notice(current);row=self.row(nid)
        with db.connect() as c:
            for changes in ({'activity_owner':self.other},{'generation':None},{'lift_open':True},{'elapsed_s':float('nan')},{'start_time':NOW+dt.timedelta(hours=1)},{'start_time':NOW-dt.timedelta(days=3)}):
                self.assertIsNone(notification_facts.read(c,{**row,**changes},NOW))
        self.assertNotEqual(notification_facts.signature(row,NOW),notification_facts.signature(row,NOW+dt.timedelta(days=1)))

    def test_milestones_own_chronological_prefix_and_units(self):
        start=NOW-dt.timedelta(days=100)
        for n in range(99):self.activity(start+dt.timedelta(hours=n),1000,sport='walk')
        current=self.activity(NOW-dt.timedelta(hours=2),1000,sport='walk');nid=self.notice(current)
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'100th walk')
        with db.connect() as c:
            c.execute("UPDATE profile SET units='metric' WHERE user_id=%s",(self.owner,))
            c.execute('DELETE FROM activities WHERE user_id=%s AND id<>%s',(self.owner,current))
        self.activity(NOW-dt.timedelta(days=10),99000,sport='walk')
        row,facts=self.facts(nid);self.assertEqual(notification_words.highlight(row,facts),'100 km in 2026')

    def devices(self):
        with db.connect() as c:
            session=auth.new_session(c,self.owner,'fictional warm notification')
            for value in ('91','92'):c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",(value*32,self.owner,auth.token_hash(session)))

    def test_once_before_locks_and_changed_history_omits_second_device_highlight(self):
        now=dt.datetime.now(UTC);old=self.activity(now-dt.timedelta(days=3),7000);self.effort(old,1500)
        current=self.activity(now-dt.timedelta(hours=2));self.effort(current,1450);nid=self.notice(current);self.devices();sent=[]
        read=notification_facts.read
        def observed(c,row,now=None):
            self.assertFalse(c.execute("SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'").fetchone())
            return read(c,row,now)
        def send(device,payload):
            sent.append(payload)
            if len(sent)==1:
                with db.connect() as c:c.execute('UPDATE best_efforts SET elapsed_s=1400 WHERE activity_id=%s',(old,))
            return True
        with patch.object(notification_facts,'read',side_effect=observed) as loader:self.assertEqual(notify.push(nid,send=send),2);self.assertEqual(loader.call_count,1)
        self.assertIn('New 5K best',sent[0]['body']);self.assertNotIn('\n',sent[1]['body'])
        self.assertTrue(all(p['url']==f'/activity/{current}?edit=1' for p in sent))

    def test_change_during_fact_read_discards_before_first_delivery(self):
        now=dt.datetime.now(UTC);old=self.activity(now-dt.timedelta(days=3),7000);self.effort(old,1500)
        current=self.activity(now-dt.timedelta(hours=2));self.effort(current,1450);nid=self.notice(current);self.devices();sent=[];read=notification_facts.read
        def changed(c,row,now=None):
            facts=read(c,row,now);c.execute('UPDATE best_efforts SET elapsed_s=1400 WHERE activity_id=%s',(old,));return facts
        with patch.object(notification_facts,'read',side_effect=changed):self.assertEqual(notify.push(nid,send=lambda d,p:sent.append(p)),2)
        self.assertTrue(all('\n' not in p['body'] for p in sent))

    def test_midnight_during_fact_scan_discards_old_period_highlight(self):
        now=dt.datetime.now(UTC);old=self.activity(now-dt.timedelta(days=3),7000);self.effort(old,1500)
        current=self.activity(now-dt.timedelta(hours=2));self.effort(current,1450);nid=self.notice(current);self.devices()
        before=now.replace(hour=23,minute=59);after=before+dt.timedelta(minutes=2);advanced=[False];sent=[];read=notification_facts.read
        def clock(row,asof=None):return before if asof is not None or not advanced[0] else after
        def crossing(c,row,asof=None):
            facts=read(c,row,asof);advanced[0]=True;return facts
        with patch.object(notification_facts,'local_now',side_effect=clock),patch.object(notification_facts,'read',side_effect=crossing):
            self.assertEqual(notify.push(nid,send=lambda d,p:sent.append(p)),2)
        self.assertTrue(all('\n' not in p['body'] for p in sent),'The next day cannot inherit yesterday’s period claims')

    def test_optional_loader_and_sql_errors_preserve_plain_delivery(self):
        current=self.activity(dt.datetime.now(UTC)-dt.timedelta(hours=2));nid=self.notice(current);self.devices()
        def bad_sql(c,row,now=None):c.execute('SELECT 1/0')
        for error in (RuntimeError('fictional private detail must not be logged'),bad_sql):
            sent=[]
            with patch.object(notification_facts,'read',side_effect=error):self.assertEqual(notify.push(nid,send=lambda d,p:sent.append(p)),2)
            self.assertTrue(all('\n' not in p['body'] for p in sent))

    def test_distance_threshold_uses_double_sum_of_stored_records(self):
        with db.connect() as c:c.execute("UPDATE profile SET units='metric' WHERE user_id=%s",(self.owner,))
        for n in range(99):self.activity(NOW-dt.timedelta(days=20,hours=n),1000.001,sport='walk')
        current=self.activity(NOW-dt.timedelta(hours=2),999.9,sport='walk');nid=self.notice(current)
        row,facts=self.facts(nid)
        with db.connect() as c:total=c.execute('SELECT sum(distance_m::double precision) AS total FROM activities WHERE user_id=%s',(self.owner,)).fetchone()['total']
        self.assertLess(total,100000);self.assertFalse(any(m['kind']=='year_distance' and m['amount']==100 for m in facts['milestones']))


if __name__=='__main__':unittest.main(verbosity=2)
