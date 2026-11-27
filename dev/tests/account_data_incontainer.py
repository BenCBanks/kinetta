"""Fresh-schema export/deletion inventory and fictional regressions; no outbound calls."""
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import unittest
import uuid
import zipfile
from unittest.mock import patch
from psycopg import sql, errors
from app import db, auth, api_account as A, api_mydata as E

# Every app table must be exported or explicitly reviewed here. These are
# existing exclusions, not a new retention policy. A new table fails closed,
# even when its personal-data link is JSON/email rather than a foreign key.
EXCLUSIONS = {
    'credentials': '''account_password_changes account_tokens admin_challenges admin_mfa admin_recovery
        admin_sessions friend_links group_invites invites native_push_devices push_subscriptions sessions server_keys''',
    'operator records; retention/access require owner policy': '''admin_action_receipts admin_attempts admin_audit
        admin_mail_events admin_readiness beta_responses feature_switches segment_decisions''',
    'non-account aggregate/deduplication; existing expiry': '''admin_feature_counts admin_feature_keys
        admin_feature_salts admin_feature_state admin_metrics_state ai_service_budget''',
    'abuse prevention; IP/login keys, pruned on later failed sign-in': 'auth_attempts',
    'shared public catalog or schema; no account owner': 'food_cache schema_version',
    'shared derived worker state, not a personal original': 'group_monday_recaps segment_jobs segment_match_state',
}


def app_tables(c):
    return {r['name'] for r in c.execute("""SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
        AND d.objid=c.oid AND d.deptype='e')""")}


def uncovered(c):
    exported=set(re.findall(r'\b(?:FROM|JOIN)\s+(\w+)', ' '.join(E.TABLES.values()), re.I))
    exported.update(('users','profile_photos'))  # account JSON and binary photo writer
    exceptions={t for names in EXCLUSIONS.values() for t in names.split()}
    return app_tables(c)-exported-exceptions


class AccountData(unittest.TestCase):
    def test_schema_inventory_and_new_table_tripwire(self):
        with db.connect() as c:
            self.assertEqual(uncovered(c),set(),'Classify/export new app tables; never silently omit personal data')
            c.execute('CREATE TABLE zz_test_new_personal_table(user_id bigint REFERENCES users(id),detail text)')
            try:self.assertEqual(uncovered(c),{'zz_test_new_personal_table'})
            finally:c.execute('DROP TABLE zz_test_new_personal_table')

    def test_sql_login_revoked_when_dependencies_prevent_drop(self):
        role='zz_test_erasure_'+secrets.token_hex(4)
        with db.connect() as c:
            c.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            c.execute(sql.SQL('GRANT fit_all_readers TO {}').format(sql.Identifier(role)))
            c.execute(sql.SQL('GRANT {} TO fit_app WITH SET TRUE').format(sql.Identifier(role)))
            c.execute('CREATE TABLE zz_test_erasure_dependency(x integer)')
            c.execute(sql.SQL('GRANT SELECT ON zz_test_erasure_dependency TO {}').format(sql.Identifier(role)))
            uid=c.execute("INSERT INTO users(login,name,sql_role) VALUES(%s,'River Example',%s) RETURNING id",(role,role)).fetchone()['id']
            try:
                with c.transaction():
                    c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                    c.execute('SELECT user_id FROM public.profile LIMIT 1')  # inherited all-reader grant
                    c.execute('RESET ROLE')
                A.erase(c,{'id':uid,'sql_role':role})
                self.assertFalse(c.execute('SELECT rolcanlogin FROM pg_roles WHERE rolname=%s',(role,)).fetchone()['rolcanlogin'])
                self.assertFalse(c.execute("SELECT pg_has_role(%s,'fit_readers','MEMBER') AS member",(role,)).fetchone()['member'])
                with self.assertRaises(errors.InsufficientPrivilege),c.transaction():
                    c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                    c.execute('SELECT user_id FROM public.profile LIMIT 1')
            finally:
                c.execute('RESET ROLE')
                c.execute('DELETE FROM users WHERE id=%s',(uid,))
                c.execute('DROP TABLE zz_test_erasure_dependency')
                c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))

    def test_unverified_email_does_not_claim_enrollment(self):
        login='zz_test_unverified_'+secrets.token_hex(4)
        with db.connect() as c:
            uid=c.execute("INSERT INTO users(login,name,email) VALUES(%s,'River Example',%s) RETURNING id",(login,login+'@example.test')).fetchone()['id']
            beta=c.execute("INSERT INTO beta_requests(name,email,phone) VALUES('River Example',%s,'iPhone') RETURNING id",(login+'@example.test',)).fetchone()['id']
            try:
                self.assertEqual(c.execute(E.TABLES['beta_requests'],(uid,)).fetchall(),[])
                A.erase(c,{'id':uid,'sql_role':None})
                self.assertIsNotNone(c.execute('SELECT 1 FROM beta_requests WHERE id=%s',(beta,)).fetchone())
            finally:
                c.execute('DELETE FROM users WHERE id=%s',(uid,))
                c.execute('DELETE FROM beta_requests WHERE id=%s',(beta,))

    def test_export_and_erasure(self):
        ids=[]
        with tempfile.TemporaryDirectory() as temp, patch.object(A,'DATA',temp), patch.object(E,'DATA',temp):
            try:
                with db.connect() as c:
                    for tag in ('owner','other'):
                        login='zz_test_data_'+tag+'_'+secrets.token_hex(4)
                        uid=c.execute("INSERT INTO users(login,name,pw_hash,email,email_verified_at,phone_e164) VALUES(%s,'River Example',%s,%s,now(),'+12025550199') RETURNING id",(login,auth.hash_pw('fictional export password'),login+'@example.test')).fetchone()['id']
                        ids.append(uid)
                        c.execute('INSERT INTO profile(user_id,food_reminders) VALUES(%s,true)',(uid,))
                        c.execute("INSERT INTO recipes(user_id,name) VALUES(%s,%s)",(uid,tag+' recipe sentinel'))
                        c.execute("INSERT INTO beta_requests(name,email,phone,note) VALUES('River Example',%s,'iPhone',%s)",((login+'@example.test').upper(),tag+' beta sentinel '+str(uid)))
                    me,other=ids
                    group=uuid.uuid4();upload=uuid.uuid4();thread=uuid.uuid4()
                    c.execute("INSERT INTO event_groups(id,organizer_id,title,time_zone,goal_type,goal_target,goal_unit,goal_start_date) VALUES(%s,%s,'Fictional group','UTC','distance',10,'km','2026-11-01')",(group,other))
                    for uid in ids:c.execute('INSERT INTO group_members(group_id,user_id) VALUES(%s,%s)',(group,uid))
                    # Legacy shared goal must survive a departing creator, with identical contents.
                    challenge=c.execute("INSERT INTO group_challenges(group_id,creator_id,legacy_group_id,title,metric,target,unit,sports,start_date,time_zone) VALUES(%s,%s,%s,'Shared run goal','distance',10,'km','{run}','2026-11-01','UTC') RETURNING id",(group,me,group)).fetchone()['id']
                    c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id) VALUES(%s,%s,%s)',(challenge,group,me))
                    update=c.execute("INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,'owner update sentinel') RETURNING id",(group,me)).fetchone()['id']
                    c.execute("INSERT INTO group_update_reactions(update_id,user_id,kind) VALUES(%s,%s,'fire')",(update,me))
                    c.execute("INSERT INTO strava_uploads(id,user_id,size,sha256) VALUES(%s,%s,20,%s)",(upload,me,'0'*64))
                    c.execute("INSERT INTO strava_import_stage(user_id,upload_id,reminder_opt_in,reminder_due,stop_hash) VALUES(%s,%s,true,now()+interval '1 day','SECRET_STOP_TOKEN')",(me,upload))
                    c.execute('INSERT INTO kit_threads(id,user_id) VALUES(%s,%s)',(thread,me))
                    c.execute("INSERT INTO kit_memories(user_id,text,kind,source) VALUES(%s,'owner memory sentinel','goal','user')",(me,))
                    c.execute('INSERT INTO kit_conversations(user_id,generation) VALUES(%s,gen_random_uuid())',(me,))
                    c.execute("INSERT INTO kit_turns(user_id,client_id,generation,question,context,state,conversation_id) SELECT user_id,%s,generation,'owner question sentinel','{}','answered',%s FROM kit_conversations WHERE user_id=%s",(uuid.uuid4(),thread,me))
                    c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'card','SECRET_CARD',true)",(me,))
                    c.execute('INSERT INTO card_connections(user_id,member_id,joined) VALUES(%s,%s,true)',(me,other))
                    plan=c.execute("INSERT INTO training_plans(user_id,race,level,weeks,runs,long_day,start_day,race_day,unit) VALUES(%s,'5k','beginner',8,3,6,'2026-11-01','2026-12-27','km') RETURNING id",(me,)).fetchone()['id']
                    c.execute("INSERT INTO plan_adjustments(user_id,plan_id,day,workout) VALUES(%s,%s,'2026-11-01','{\"detail\":\"owner adjustment sentinel\"}')",(me,plan))
                    c.execute("INSERT INTO coach_proposals(id,user_id,kind,payload,baseline,expires) VALUES(%s,%s,'goal','{}','fictional',now()+interval '1 day')",(uuid.uuid4(),me))
                    request=uuid.uuid4()
                    c.execute("INSERT INTO admin_data_requests(id,user_id,kind,status,verified_at,method) VALUES(%s,%s,'deletion','verified',now(),'signed_in')",(request,me))
                    c.execute("INSERT INTO admin_audit(actor_id,action,target) VALUES(%s,'account.test',%s)",(me,str(me)))
                    c.execute('INSERT INTO ai_service_budget(day) VALUES(current_date) ON CONFLICT DO NOTHING')
                    attempt=uuid.uuid4();c.execute("INSERT INTO ai_food_attempts(id,user_id,day,model,kind,state,request_id,reserved_micros,charged_micros) VALUES(%s,%s,current_date,'fictional','food','measured',%s,0,0)",(attempt,me,uuid.uuid4()))
                    before=dict(c.execute('SELECT * FROM group_challenges WHERE id=%s',(challenge,)).fetchone())
                original=Path(temp)/'files'/str(me)/'fictional.gpx';original.parent.mkdir(parents=True);original.write_bytes(b'owner original sentinel')
                staging=Path(temp)/'uploads'/str(me)/('strava-'+str(upload))/'archive.zip';staging.parent.mkdir(parents=True);staging.write_bytes(b'fictional incomplete archive')
                archive=Path(temp)/'export.zip';E._write_export(me,archive)
                with zipfile.ZipFile(archive) as z:
                    entries={name:z.read(name) for name in z.namelist()}
                    records=lambda name:[json.loads(line) for line in entries['data/'+name+'.jsonl'].splitlines()]
                    self.assertIn(b'owner recipe sentinel',entries['data/recipes.jsonl'])
                    self.assertIn(b'owner adjustment sentinel',entries['data/plan_adjustments.jsonl'])
                    self.assertIn(b'owner beta sentinel',entries['data/beta_requests.jsonl'])
                    self.assertIn(b'owner update sentinel',entries['data/group_updates.jsonl'])
                    self.assertIn(b'owner memory sentinel',entries['data/kit_memories.jsonl'])
                    self.assertIn(b'owner question sentinel',entries['data/kit_turns.jsonl'])
                    self.assertTrue(records('signup_join_intents')[0]['want_request'])
                    self.assertTrue(records('card_connections')[0]['joined'])
                    self.assertTrue(records('profile')[0]['food_reminders'])
                    self.assertEqual(json.loads(entries['data/account.json'])['phone_e164'],'+12025550199')
                    self.assertEqual(records('strava_uploads')[0]['id'],str(upload))
                    self.assertTrue(records('strava_import_stage')[0]['reminder_opt_in'])
                    all_data=b''.join(entries.values())
                    for forbidden in (b'other recipe sentinel',b'other beta sentinel',b'SECRET_STOP_TOKEN',b'SECRET_CARD',b'pw_hash'):
                        self.assertNotIn(forbidden,all_data)
                    self.assertEqual(entries['files/fictional.gpx'],b'owner original sentinel')
                with db.connect() as c:
                    me_row=c.execute('SELECT id,sql_role FROM users WHERE id=%s',(me,)).fetchone();A.erase(c,me_row)
                A.erase_files(me)
                with db.connect() as c:
                    # Probe every direct user FK, not just the rows this fixture seeds.
                    for r in c.execute("""SELECT t.relname AS name,a.attname AS col FROM pg_constraint f
                      JOIN pg_class t ON t.oid=f.conrelid JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
                      WHERE f.contype='f' AND f.confrelid='users'::regclass""").fetchall():
                        count=c.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE {}=%s').format(sql.Identifier(r['name']),sql.Identifier(r['col'])),(me,)).fetchone()['n']
                        self.assertEqual(count,0,r)
                    self.assertIsNone(c.execute('SELECT 1 FROM users WHERE id=%s',(me,)).fetchone())
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM recipes WHERE user_id=%s',(other,)).fetchone()['n'],1)
                    self.assertIsNone(c.execute("SELECT 1 FROM beta_requests WHERE note=%s",('owner beta sentinel '+str(me),)).fetchone())
                    after=dict(c.execute('SELECT * FROM group_challenges WHERE id=%s',(challenge,)).fetchone());self.assertIsNone(after.pop('creator_id'));before.pop('creator_id');self.assertEqual(before,after)
                    self.assertIsNone(c.execute('SELECT user_id FROM admin_data_requests WHERE id=%s',(request,)).fetchone()['user_id'])
                    retained=c.execute('SELECT user_id,request_id FROM ai_food_attempts WHERE id=%s',(attempt,)).fetchone();self.assertEqual(dict(retained),{'user_id':None,'request_id':None})
                    c.execute('DELETE FROM admin_data_requests WHERE id=%s',(request,));c.execute('DELETE FROM ai_food_attempts WHERE id=%s',(attempt,))
                self.assertFalse(original.parent.exists());self.assertFalse(staging.parent.exists())
            finally:
                with db.connect() as c:
                    for uid in ids:
                        row=c.execute('SELECT id,sql_role FROM users WHERE id=%s',(uid,)).fetchone()
                        if row:A.erase(c,row)
                for uid in ids:A.erase_files(uid)


if __name__=='__main__':unittest.main()
