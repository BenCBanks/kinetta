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
from fastapi import HTTPException
import psycopg
from psycopg import sql, errors
from psycopg.rows import tuple_row
from psycopg.types.json import Jsonb
from app import users as U, sql_logins
from app import db, auth, api_account as A, api_mydata as E

"""Explicit schema review: a JOIN is never an export disposition.
Column lists freeze the reviewed schema; any added column/table requires a new review.
Added export projections are separately checked against production NEW_EXPORTS.
Exclusions describe existing policy only, never an authorization to retain new data.
"""
TABLE_REVIEW = {
    'account_password_changes': ('exclude:credentials', 'token_hash user_id expires created'),
    'account_tokens': ('exclude:credentials', 'token_hash user_id kind email created expires used_at resend_id bounced_at'),
    'achievement_moment_reactions': ('export:achievement_moment_reactions', 'owner_id week_start user_id kind created'),
    'activities': ('export:activities', 'id user_id sport sub_sport name auto_name description private_note commute start_time tz elapsed_s moving_s distance_m ascent_m descent_m avg_hr max_hr avg_cad avg_power max_power max_speed avg_temp calories avg_vo avg_gct avg_stride gap_s_per_km effort decoupling vo2max zones laps splits_km splits_mi power_curve chart device source source_id file_sha256 file_path strava_id gear_id route_id geom start_pt end_pt ai_note ai_note_at created updated sport_label max_alt min_alt vam norm_power steps pool_length_m lengths strokes swolf visibility share_details lift_open healthkit_id health_details summary_overrides summary_original leaderboard_excluded segment_assistance segment_assistance_rev segment_revision'),
    'activity_intervals': ('export:activity_intervals', 'user_id recording_id activity_id payload request_hash'),
    'activity_photos': ('export:activity_photos', 'id activity_id user_id img thumb w h created'),
    'activity_route_plans': ('export:activity_route_plans', 'activity_id user_id source_kind route_id version snapshot_key name distance_m'),
    'activity_streams': ('export:activity_streams', 'activity_id user_id t lat lon alt dist hr cad power speed temp vo gct stride'),
    'admin_account_days': ('export:admin_account_days', 'user_id day'),
    'admin_action_receipts': ('exclude:operator records; retention/access require owner policy', 'request_key actor_id action target fingerprint result created'),
    'admin_attempts': ('exclude:operator records; retention/access require owner policy', 'key created'),
    'admin_audit': ('exclude:operator records; retention/access require owner policy', 'id actor_id action target created outcome'),
    'admin_challenges': ('exclude:credentials', 'token_hash user_id seed expires'),
    'admin_data_requests': ('export:support_requests', 'id user_id kind status received verified_at completed_at method actor_id completed_by'),
    'admin_feature_counts': ('exclude:non-account aggregate/deduplication; existing expiry', 'feature day people opens'),
    'admin_feature_keys': ('exclude:non-account aggregate/deduplication; existing expiry', 'day feature digest opened'),
    'admin_feature_salts': ('exclude:non-account aggregate/deduplication; existing expiry', 'day secret'),
    'admin_feature_state': ('exclude:non-account aggregate/deduplication; existing expiry', 'singleton started'),
    'admin_login_events': ('export:admin_login_events', 'id user_id channel outcome stage created'),
    'admin_mail_events': ('exclude:operator records; retention/access require owner policy', 'id provider_id state created'),
    'admin_metrics_state': ('exclude:non-account aggregate/deduplication; existing expiry', 'singleton started_at'),
    'admin_mfa': ('exclude:credentials', 'user_id secret last_counter'),
    'admin_readiness': ('exclude:operator records; retention/access require owner policy', 'check_key passed observed_at recorded_at actor_id'),
    'admin_recovery': ('exclude:credentials', 'user_id code_hash'),
    'admin_sessions': ('exclude:credentials', 'token_hash user_id expires'),
    'ai_daily_usage': ('export:ai_daily_usage', 'user_id day kind requests'),
    'ai_entitlements': ('export:ai_entitlements', 'user_id feature enabled expires_at updated_at'),
    'ai_food_attempts': ('export:ai_food_attempts', 'id user_id day model kind created state reserved_micros charged_micros input_tokens output_tokens thinking_tokens lease_until finished_at request_id'),
    'ai_requests': ('export:ai_food_requests', 'user_id kind created'),
    'ai_service_budget': ('exclude:non-account aggregate/deduplication; existing expiry', 'day charged_micros warned_at'),
    'api_requests': ('export:api_requests', 'id created user_id method route status duration_ms channel request_id'),
    'auth_attempts': ('exclude:abuse prevention; IP/login keys, pruned on later failed sign-in', 'key created'),
    'best_efforts': ('export:best_efforts', 'id user_id activity_id sport distance_m label elapsed_s start_s start_time'),
    'beta_requests': ('export:beta_requests', 'id name email phone watch note created status invite_id card_code card_request challenge_code challenge_join'),
    'beta_responses': ('exclude:operator records; retention/access require owner policy', 'id request_id actor_id kind fingerprint recipient subject body invite_id state provider_id created first_attempt attempted error'),
    'blocks': ('export:blocked', 'user_id blocked created'),
    'card_connections': ('export:card_connections', 'user_id member_id joined created'),
    'challenge_members': ('export:challenge_members', 'challenge_id user_id status joined three_notice finished_notice'),
    'challenges': ('export:challenges', 'id user_id code kind sports target unit start_day end_day zone ended_at request_id request_body created checked_at'),
    'cheers': ('export:cheers_given', 'activity_id user_id created kind'),
    'coach_notes': ('export:coach_notes', 'id user_id kind period_start text created'),
    'coach_proposals': ('export:coach_proposals', 'id user_id kind payload baseline status created expires'),
    'comments': ('export:comments_written', 'id activity_id user_id text created'),
    'connections': ('export:connections', 'user_id kind token_hash settings status last_sync last_count created'),
    'custom_foods': ('export:custom_foods', 'id user_id name brand barcode serving_label serving_g kcal protein_g carbs_g fat_g fiber_g favorite created origin origin_notes origin_model origin_edited origin_ref sodium_mg sugar_g saturated_fat_g'),
    'day_energy': ('export:day_energy', 'user_id day burned_kcal source'),
    'day_goals': ('export:day_goals', 'user_id day kcal'),
    'dish_shares': ('export:dishes_shared_with_me', 'dish_id user_id created'),
    'dishes': ('export:dishes', 'id user_id name items known_kcal known_protein_g known_carbs_g known_fat_g cooked_g eaten_g created updated done_at ai_note ai_note_at recipe_updated meal recipe_id eaten_share serving servings known_fiber_g recipe_source known_sodium_mg known_sugar_g known_saturated_fat_g yield_servings'),
    'event_groups': ('export:groups_created', 'id organizer_id title event_date time_zone note goal_type goal_target goal_unit invite_generation joining_closed closed_at created goal_sports goal_start_date training_for'),
    'exercises': ('export:exercises', 'id user_id name kind muscle note created'),
    'feature_switches': ('exclude:operator records; retention/access require owner policy', 'name enabled changed actor_id'),
    'food_cache': ('exclude:shared public catalog or schema; no account owner', 'key data fetched'),
    'food_chat_aliases': ('export:food_chat_aliases', 'user_id key templates created'),
    'food_chat_cancellations': ('export:food_chat_cancellations', 'user_id client_id created'),
    'food_chat_entries': ('export:food_chat_entries', 'user_id message_id entry_id'),
    'food_chat_jobs': ('export:food_chat_jobs', 'user_id message_id lease expires state input_hash created'),
    'food_chat_messages': ('export:food_chat_messages', 'id user_id client_id kind body captured_at created local_day state reply_to result'),
    'food_entries': ('export:food_entries', 'id user_id day meal name brand amount unit kcal protein_g carbs_g fat_g fiber_g source ref position created updated client_id sodium_mg sugar_g saturated_fat_g entry_method'),
    'friend_links': ('exclude:credentials', 'user_id code created expires'),
    'friendships': ('export:friends', 'requester addressee status created accepted'),
    'gear': ('export:gear', 'id user_id kind name brand model notes start_distance_m alert_distance_m retired is_default created'),
    'goals': ('export:goals', 'id user_id sport period metric target created'),
    'group_challenge_members': ('export:group_challenge_members', 'challenge_id group_id user_id share_total joined_at'),
    'group_challenges': ('export:group_challenges_created', 'id group_id creator_id legacy_group_id title metric target unit sports start_date end_date time_zone note training_for ended_at created'),
    'group_friend_invites': ('export:group_friend_invites', 'id group_id inviter_id invitee_id status created_at expires_at responded_at'),
    'group_invites': ('exclude:credentials', 'id group_id generation token_hash created_at expires_at revoked_at'),
    'group_members': ('export:group_members', 'group_id user_id status joined_at removed_invite_generation recap_consent notifications_muted sharing_level monday_recap_enabled'),
    'group_monday_recaps': ('exclude:shared derived worker state, not a personal original', 'group_id week_start created'),
    'group_update_reactions': ('export:group_update_reactions', 'update_id user_id kind created'),
    'group_updates': ('export:group_updates', 'id group_id user_id text created'),
    'group_weekly_reactions': ('export:group_weekly_reactions', 'group_id week_start user_id kind created'),
    'health_nutrition_days': ('export:health_nutrition_days', 'user_id day revision changed_at'),
    'health_resting': ('export:health_resting', 'user_id tz day resting_kcal observed_at synced_at'),
    'health_weight_exclusions': ('export:health_weight_exclusions', 'user_id day before_time'),
    'health_weight_samples': ('export:health_weight_samples', 'user_id sample_id sampled_at kg source_name source_bundle deleted observed_at excluded'),
    'imports': ('export:imports', 'id user_id label status total done added duplicates failed messages created finished'),
    'interval_preset_receipts': ('export:interval_preset_receipts', 'user_id mutation_id preset_id request_hash version'),
    'interval_presets': ('export:interval_presets', 'id user_id definition version updated deleted_at'),
    'invites': ('exclude:credentials', 'id token_hash created_by note created expires used_by used_at'),
    'kit_conversations': ('export:kit_conversations', 'user_id generation created memory_enabled memory_version opens_at opens_count'),
    'kit_memories': ('export:kit_memories', 'id user_id text health_included created updated kind source'),
    'kit_threads': ('export:kit_threads', 'id user_id created updated'),
    'kit_turns': ('export:kit_turns', 'id user_id client_id generation question context state lease expires answer error created visit_id conversation_id invalidated_at replay_blocked_at'),
    'kit_visits': ('export:kit_visits', 'id user_id created ended conversation_id draft_conversation_id'),
    'known_devices': ('export:known_devices', 'user_id device first_seen last_seen'),
    'lift_sets': ('export:lift_sets', 'id user_id activity_id exercise_id pos n reps kg secs warmup done'),
    'meal_reminder_attempts': ('export:meal_reminder_attempts', 'user_id day meal attempted_at delivered'),
    'milestone_state': ('export:milestone_state', 'user_id generation processed fresh baseline_at changed next_check last_push_day'),
    'milestones': ('export:milestones', 'id user_id code kind title rank activity_id day occurred details garmin_source silent valid seen_at shared_at created'),
    'native_push_devices': ('exclude:credentials', 'token environment user_id session_hash created'),
    'notifications': ('export:notifications', 'id user_id kind actor_id activity_id dish_id comment_id created read_at reaction_kind cancelled milestone_id challenge_id push_pending group_id group_update_id group_week_start group_friend_invite_id'),
    'nutrition_checkins': ('export:nutrition_checkins', 'id user_id week state data baseline created updated acted_at'),
    'pans': ('export:pans', 'id user_id name grams created'),
    'personal_notification_attempts': ('export:personal_notification_attempts', 'user_id kind period attempted_at delivered'),
    'plan_adjustments': ('export:plan_adjustments', 'user_id plan_id day workout created'),
    'plan_marks': ('export:plan_marks', 'user_id plan_id day created done'),
    'planned_route_versions': ('export:planned_route_versions', 'route_id user_id version waypoints legs geom distance_m ascent_m descent_m elevation warnings created'),
    'planned_routes': ('export:planned_routes', 'id user_id client_id name description sport source version created updated share_audience share_revision share_disabled source_route_id'),
    'profile': ('export:profile', 'user_id units tz max_hr rest_hr sex birth_year weight_kg kcal_target protein_target carbs_target fat_target fiber_target deficit_start height_cm activity_factor ai_ok health_ai_ok share_default share_details share_trim_m findable notify bio resting_source nutrition_goal goal_pace_percent food_chat_auto_log food_chat_tone food_chat_daily_note sodium_target_mg sugar_target_g saturated_fat_target_g health_weight_read health_weight_epoch health_weight_last_synced health_weight_ai_ok weight_health_derived health_nutrition_write health_nutrition_epoch health_nutrition_since health_nutrition_older health_account_id food_reminders training_day_targets training_food_adult_confirmed training_target_average training_target_kcal garmin_ai_ok signin_email friend_link segment_boards ai_adult_at ai_adult_by ai_access_allowed setup_hidden profile_layout setup_skipped terms_version terms_accepted_at welcome_completed_day health_setup_day share_achievements share_achievements_since find_by_email find_by_phone showcase_pins group_strip_muted'),
    'profile_photos': ('export:photos/profile.jpg', 'user_id img created'),
    'public_cards': ('export:public_card', 'user_id code enabled photo sports stats allow_requests created updated'),
    'push_subscriptions': ('exclude:credentials', 'id user_id endpoint p256dh auth created'),
    'recipe_link_drafts': ('export:recipe_link_drafts', 'user_id id url state data error_code error_message created expires saved_dish_id'),
    'recipes': ('export:recipes', 'id user_id name items known_kcal known_protein_g known_carbs_g known_fat_g ai_note ai_note_at created updated cooked'),
    'reports': ('export:reports_made', 'id reporter person activity_id comment_id what reason note created status kind dish_id challenge_id group_id'),
    'route_copy_receipts': ('export:route_copy_receipts', 'user_id client_id source_route_id destination_id snapshot_key created'),
    'route_drafts': ('export:route_drafts', 'user_id draft_key data updated'),
    'route_publications': ('export:route_publications', 'route_id user_id revision source_version data geom hidden_start_m hidden_end_m created'),
    'route_reports': ('export:route_reports_made', 'id reporter route_id reason note created status decided_by decided outcome'),
    'route_share_previews': ('export:route_share_previews', 'id user_id route_id source_version route_updated share_revision policy_trim audience data hidden_start_m hidden_end_m consumed_revision created expires'),
    'routes': ('export:routes', 'id user_id sport name renamed created'),
    'saved_meals': ('export:saved_meals', 'id user_id name items created ai_note ai_note_at'),
    'schema_version': ('exclude:shared public catalog or schema; no account owner', 'version applied'),
    'segment_appeals': ('export:segment_appeals', 'id effort_id user_id note status decided outcome created'),
    'segment_bookmarks': ('export:segment_bookmarks', 'user_id segment_id created'),
    'segment_decisions': ('exclude:operator records; retention/access require owner policy', 'id actor_id target_kind target_id action reviewed_rev reason created'),
    'segment_drafts': ('export:segment_drafts', 'id user_id data updated'),
    'segment_efforts': ('export:segment_efforts', 'id segment_id user_id activity_id start_i end_i started elapsed_raw elapsed_s on_line start_m end_m line_m matcher state reason moderation moderation_reason rev created generation source_revision'),
    'segment_jobs': ('exclude:shared derived worker state, not a personal original', 'id kind ref cursor attempts last_error created epoch'),
    'segment_match_state': ('exclude:shared derived worker state, not a personal original', 'segment_id active active_matcher pending pending_matcher next_epoch processed cursor swept started activated'),
    'segment_reports': ('export:segment_reports_made', 'id reporter segment_id person reason note status decided_by decided outcome created'),
    'segment_scans': ('export:segment_scans', 'segment_id activity_id user_id matcher outcome reason scanned generation source_revision'),
    'segment_stage_scans': ('export:segment_stage_scans', 'segment_id epoch activity_id user_id source_revision matcher result outcome reason'),
    'segments': ('export:segments_created', 'id creator_id client_id name description sport geom distance_m ascent_m elevation_source source fingerprint matcher created audience published status status_reason status_changed replaced_by'),
    'server_keys': ('exclude:credentials', 'name value created'),
    'sessions': ('exclude:credentials', 'token_hash user_id created last_seen agent app_version'),
    'signup_join_intents': ('export:signup_join_intents', 'user_id kind code want_request created'),
    'strava_import_stage': ('export:strava_import_stage', 'user_id state upload_id reminder_opt_in reminder_due reminder_attempted reminder_sent stop_hash updated expires'),
    'strava_uploads': ('export:strava_uploads', 'id user_id size sha256 received state audience cursor preview result error_code created updated expires'),
    'track_recording_receipts': ('export:track_recording_receipts', 'user_id client_id activity_id created'),
    'training_plans': ('export:training_plans', 'id user_id race level weeks runs long_day start_day race_day goal_s unit start_vol active created ended prescription'),
    'users': ('export:account.json', 'id login name pw_hash sql_role created is_admin photo_v email email_verified_at needs_email_confirm suspended_at suspended_reason password_change_expires signup_guard signup_confirmed_at phone_e164 email_confirmation_reminder_count email_confirmation_reminder_at unconfirmed_final_warning_at unconfirmed_final_warning_sent_at first_name last_name'),
    'weights': ('export:weights', 'user_id day kg note source health_sample_id source_name'),
}



def app_tables(c):
    return {r['name'] for r in c.execute("""SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
        AND d.objid=c.oid AND d.deptype='e')""")}


def uncovered(c):
    return app_tables(c)-set(TABLE_REVIEW)


def unreviewed_columns(c):
    columns={}
    for r in c.execute("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'"):
        columns.setdefault(r['table_name'],set()).add(r['column_name'])
    return {name for name,(_,fields) in TABLE_REVIEW.items() if columns.get(name)!=set(fields.split())}


class AccountData(unittest.TestCase):
    def test_schema_inventory_and_new_table_tripwire(self):
        with db.connect() as c:
            self.assertEqual(uncovered(c),set(),'Classify/export new app tables; never silently omit personal data')
            self.assertEqual(unreviewed_columns(c),set(),'Every schema field addition needs explicit export/retention review')
            for disposition,_ in TABLE_REVIEW.values():
                if disposition.startswith('export:'):
                    artifact=disposition.removeprefix('export:')
                    self.assertTrue(artifact in E.TABLES or artifact in ('account.json','photos/profile.jpg'),artifact)
            for artifact,(table,fields) in E.NEW_EXPORTS.items():
                self.assertEqual(TABLE_REVIEW[table][0],'export:'+artifact)
                self.assertLessEqual(set(fields.split()),set(TABLE_REVIEW[table][1].split()))
            c.execute('CREATE TABLE zz_test_new_personal_table(user_id bigint REFERENCES users(id),detail text)')
            try:
                with patch.dict(E.TABLES,{'joined_only':'SELECT 1 FROM users JOIN zz_test_new_personal_table ON true'}):
                    self.assertEqual(uncovered(c),{'zz_test_new_personal_table'})
            finally:c.execute('DROP TABLE zz_test_new_personal_table')
            c.execute('ALTER TABLE recipes ADD COLUMN zz_test_unreviewed_secret text')
            try:self.assertEqual(unreviewed_columns(c),{'recipes'})
            finally:c.execute('ALTER TABLE recipes DROP COLUMN zz_test_unreviewed_secret')

    def test_sql_login_revoked_when_dependencies_prevent_drop(self):
        login='zz_test_erasure_'+secrets.token_hex(4)
        role=login+'_sql'
        session=peer=None
        peer_role=role+'_peer'
        try:
            with db.connect() as c:
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal('fictional SQL fixture password')))
                c.execute(sql.SQL('GRANT fit_readers, fit_all_readers TO {}').format(sql.Identifier(role)))
                c.execute('CREATE TABLE zz_test_erasure_dependency(x integer)')
                c.execute(sql.SQL('GRANT SELECT ON zz_test_erasure_dependency TO {}').format(sql.Identifier(role)))
                uid=c.execute("INSERT INTO users(login,name,sql_role) VALUES(%s,'Departing SQL Person',%s) RETURNING id",(login,role)).fetchone()['id']
                with c.cursor(row_factory=tuple_row) as catalog:
                    sql_logins.record_owner(catalog,{'id':uid,'login':login,'sql_role':role})
                other=c.execute("INSERT INTO users(login,name) VALUES(%s,'Distinct Remaining Person') RETURNING id",(role+'_other',)).fetchone()['id']
                c.execute('INSERT INTO profile(user_id) VALUES(%s)',(other,))
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(peer_role),sql.Literal('fictional peer SQL password')))
                c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(peer_role)))
                c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(peer_role,other))
            # A real independent authenticated login, not SET ROLE on the deleting app connection.
            session=psycopg.connect(db._conninfo(role,'fictional SQL fixture password'),autocommit=True)
            session.execute('SET ROLE fit_all_readers')
            pid=session.info.backend_pid
            peer=psycopg.connect(db._conninfo(peer_role,'fictional peer SQL password'),autocommit=True)
            peer_pid=peer.info.backend_pid
            self.assertEqual(session.execute('SELECT count(*) FROM profile WHERE user_id=%s',(other,)).fetchone()[0],1)
            with patch.object(A,'_disable_sql_login',side_effect=RuntimeError('fixture signal refusal')):
                with self.assertRaises(RuntimeError):
                    with db.connect() as c:A.erase(c,{'id':uid,'sql_role':role})
            with db.connect() as c:self.assertIsNotNone(c.execute('SELECT 1 FROM users WHERE id=%s',(uid,)).fetchone())
            with db.connect() as c:A.erase(c,{'id':uid,'sql_role':role})
            self.assertEqual(peer.execute('SELECT count(*) FROM profile WHERE user_id=%s',(other,)).fetchone()[0],1)
            self.assertEqual(peer.info.backend_pid,peer_pid)
            with self.assertRaises(psycopg.OperationalError):session.execute('SELECT user_id FROM profile')
            with self.assertRaises(psycopg.OperationalError):psycopg.connect(db._conninfo(role,'fictional SQL fixture password'),connect_timeout=2)
            with db.connect() as c:
                self.assertFalse(c.execute('SELECT rolcanlogin FROM pg_roles WHERE rolname=%s',(role,)).fetchone()['rolcanlogin'])
                for reader in ('fit_readers','fit_all_readers'):
                    self.assertFalse(c.execute("SELECT pg_has_role(%s,%s,'MEMBER') AS member",(role,reader)).fetchone()['member'])
                self.assertIsNone(c.execute('SELECT 1 FROM pg_stat_activity WHERE pid=%s',(pid,)).fetchone())
                self.assertIsNotNone(c.execute('SELECT 1 FROM profile WHERE user_id=%s',(other,)).fetchone())
        finally:
            if session:session.close()
            if peer:peer.close()
            with db.connect() as c:
                c.execute('DELETE FROM users WHERE login IN (%s,%s)',(login,role+'_other'))
                c.execute('DROP TABLE IF EXISTS zz_test_erasure_dependency')
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(peer_role)))

    def test_foreign_or_shared_sql_roles_are_never_changed(self):
        for case in ('unmarked','wrong_name','wrong_owner','wrong_database','shared_member','foreign_membership','foreign_database','foreign_session'):
            with self.subTest(case=case):
                login='zz_test_ownership_'+secrets.token_hex(4);role=login+'_sql';extra=login+'_peer'
                session=foreign_session=None
                with psycopg.connect(db._conninfo('postgres',db.secret('POSTGRES_PASSWORD')),autocommit=True) as admin:
                    try:
                        with db.connect() as c:
                            uid=c.execute("INSERT INTO users(login,name,sql_role) VALUES(%s,'Ownership Fixture',%s) RETURNING id",(login,role)).fetchone()['id']
                            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal('fictional ownership password')))
                            c.execute(sql.SQL('GRANT fit_readers,fit_all_readers TO {}').format(sql.Identifier(role)))
                            with c.cursor(row_factory=tuple_row) as catalog:
                                account={'id':uid,'login':login,'sql_role':role}
                                if case!='unmarked':sql_logins.record_owner(catalog,account)
                            if case=='wrong_name':c.execute("UPDATE users SET login=login||'_renamed' WHERE id=%s",(uid,))
                            if case in ('wrong_owner','wrong_database'):
                                with c.cursor(row_factory=tuple_row) as catalog:marker=sql_logins.owner_marker(catalog,account)
                                parts=marker.split(':');parts[3 if case=='wrong_owner' else 2]='999999999'
                                c.execute(sql.SQL('COMMENT ON ROLE {} IS {}').format(sql.Identifier(role),sql.Literal(':'.join(parts))))
                            if case in ('shared_member','foreign_membership'):
                                c.execute(sql.SQL('CREATE ROLE {}').format(sql.Identifier(extra)))
                                source,target=(role,extra) if case=='shared_member' else (extra,role)
                                c.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(source),sql.Identifier(target)))
                        if case=='foreign_database':
                            admin.execute(sql.SQL('GRANT CONNECT ON DATABASE postgres TO {}').format(sql.Identifier(role)))
                        if case=='foreign_session':
                            foreign_session=psycopg.connect(db._conninfo(role,'fictional ownership password'),dbname='postgres',autocommit=True)
                        session=psycopg.connect(db._conninfo(role,'fictional ownership password'),autocommit=True)
                        session.execute('SET ROLE fit_all_readers');pid=session.info.backend_pid
                        snapshot=lambda:admin.execute("SELECT rolcanlogin,rolconfig,pg_catalog.shobj_description(oid,'pg_authid') FROM pg_catalog.pg_roles WHERE rolname=%s",(role,)).fetchone()
                        memberships=lambda:admin.execute('SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_catalog.pg_auth_members ORDER BY roleid,member,grantor').fetchall()
                        before=snapshot();grants_before=memberships()
                        with self.assertRaisesRegex(RuntimeError,'administrator review'):
                            with db.connect() as c:A.erase(c,{'id':uid,'sql_role':'ignored caller role'})
                        self.assertEqual(snapshot(),before);self.assertEqual(memberships(),grants_before)
                        if foreign_session:self.assertEqual(foreign_session.execute('SELECT current_database()').fetchone()[0],'postgres')
                        self.assertEqual(session.execute('SELECT pg_backend_pid()').fetchone()[0],pid)
                        for reader in ('fit_readers','fit_all_readers'):
                            self.assertTrue(admin.execute("SELECT pg_has_role(%s,%s,'MEMBER')",(role,reader)).fetchone()[0])
                        with db.connect() as c:self.assertIsNotNone(c.execute('SELECT id FROM users WHERE id=%s',(uid,)).fetchone())
                        # CLI password reset must not silently claim a foreign login either.
                        if case=='unmarked':
                            with patch.object(U.db,'migrate'),patch.object(U,'ask',return_value='fictional reset password'):
                                with self.assertRaisesRegex(RuntimeError,'administrator review'):U.main(['sql-login',login])
                    finally:
                        if session:session.close()
                        if foreign_session:foreign_session.close()
                        with db.connect() as c:c.execute('DELETE FROM users WHERE login IN (%s,%s)',(login,login+'_renamed'))
                        admin.execute(sql.SQL('REVOKE CONNECT ON DATABASE postgres FROM {}').format(sql.Identifier(role)))
                        admin.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(extra)))
                        admin.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_sql_login_provisioning_records_owner(self):
        login='zz_test_provision_'+secrets.token_hex(4);role=login+'_sql'
        try:
            with db.connect() as c:uid=c.execute("INSERT INTO users(login,name) VALUES(%s,'SQL Provision Fixture') RETURNING id",(login,)).fetchone()['id']
            with patch.object(U.db,'migrate'),patch.object(U,'ask',return_value='fictional provisioning password'),patch('builtins.print'):
                U.main(['sql-login',login]);U.main(['sql-login',login])
            with db.connect() as c:A.erase(c,{'id':uid,'sql_role':None})
            with db.connect() as c:self.assertIsNone(c.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone())
        finally:
            with db.connect() as c:
                c.execute('DELETE FROM users WHERE login=%s',(login,))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_every_new_export_has_exact_account_records(self):
        # Expectations are explicit fixture values, never selected from TABLES or
        # NEW_EXPORTS. Three identities differ in projected fields on EVERY table.
        ids=[];cleanup=[];expected={}
        generated=object()
        with tempfile.TemporaryDirectory() as temp,patch.object(E,'DATA',temp):
            try:
                with db.connect() as c:
                    def seed(table,values):
                        values={k:(Jsonb(v) if k in ('items','payload','workout','preview','result') else v) for k,v in values.items()}
                        q=sql.SQL('INSERT INTO {} ({}) VALUES ({}) RETURNING *').format(sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,values)),sql.SQL(',').join(sql.Placeholder() for _ in values))
                        row=c.execute(q,tuple(values.values())).fetchone()
                        if 'id' in row:cleanup.append((table,row['id']))
                        return row
                    def add(uid,artifact,table,record,private):
                        raw={**record,**private}
                        if record.get('id') is generated:raw.pop('id')
                        row=seed(table,raw)
                        if record.get('id') is generated:record['id']=row['id']
                        expected[uid][artifact].append(record)
                        return row
                    for i in range(3):
                        login='zz_test_exact_'+str(i)+'_'+secrets.token_hex(4)
                        uid=seed('users',{'login':login,'name':'Exact Person '+str(i),'email':login+'@example.test','email_verified_at':'2026-11-01T00:00:00+00:00'})['id']
                        ids.append(uid);expected[uid]={name:[] for name in E.NEW_EXPORTS}
                    groups={uid:str(uuid.uuid4()) for uid in ids}
                    for i,uid in enumerate(ids):
                        peer=ids[(i+1)%3];stamp=f'2026-11-{10+i:02d}T10:00:00+00:00';end=f'2026-12-{10+i:02d}T10:00:00+00:00';day=f'2026-11-{10+i:02d}';week=f'2026-11-{2+7*i:02d}'
                        private={'user_id':uid}
                        add(uid,'beta_requests','beta_requests',dict(id=generated,name='Exact '+str(i),email=c.execute('SELECT email::text AS e FROM users WHERE id=%s',(uid,)).fetchone()['e'],phone='iPhone '+str(i),watch='Watch '+str(i),note='Enrollment '+str(i),created=stamp,status='new',card_request=bool(i%2),challenge_join=bool(i%2)),{})
                        add(uid,'recipes','recipes',dict(id=generated,name='Recipe '+str(i),items=[{'name':'oats '+str(i),'grams':100+i,'per100':{'kcal':200+i}}],known_kcal=400+i,known_protein_g=20+i,known_carbs_g=50+i,known_fat_g=10+i,ai_note='Note '+str(i),ai_note_at=stamp,created=stamp,updated=stamp,cooked=stamp),private)
                        add(uid,'coach_proposals','coach_proposals',dict(id=str(uuid.uuid4()),kind='goal',payload={'candidate':{'before':str(10+i)+' km','after':str(12+i)+' km'}},status='pending',created=stamp,expires=end),{**private,'baseline':'SECRET_BASELINE_'+str(i)})
                        plan=seed('training_plans',{**private,'race':'5k','level':'beginner','weeks':8,'runs':3,'long_day':6,'start_day':day,'race_day':'2026-12-31','unit':'km'})['id']
                        add(uid,'plan_adjustments','plan_adjustments',dict(plan_id=plan,day=day,workout={'day':day,'type':'easy','dist':5+i,'title':'Easy '+str(i),'detail':'Run '+str(i)},created=stamp),private)
                        add(uid,'ai_entitlements','ai_entitlements',dict(feature='coach',enabled=bool(i%2),expires_at=end,updated_at=stamp),private)
                        add(uid,'admin_account_days','admin_account_days',dict(day=day),private)
                        add(uid,'admin_login_events','admin_login_events',dict(channel=('web','app','admin')[i],outcome=('success','failure','limited')[i],created=stamp),{**private,'stage':'password'})
                        add(uid,'api_requests','api_requests',dict(created=stamp,method='GET',route='/api/exact/'+str(i),status=200+i,duration_ms=10+i,channel='web'),{**private,'request_id':uuid.uuid4()})
                        add(uid,'groups_created','event_groups',dict(id=groups[uid],title='Group '+str(i),event_date='2026-12-31',time_zone='UTC',note='Group note '+str(i),goal_type='distance',goal_target=10+i,goal_unit='km',goal_sports=['run'],goal_start_date=day,training_for='Race '+str(i),joining_closed=bool(i%2),closed_at=None,created=stamp),{'organizer_id':uid})
                        add(uid,'group_members','group_members',dict(group_id=groups[uid],status=('active','left','active')[i],joined_at=stamp,recap_consent=bool(i%2),notifications_muted=bool(i%2),sharing_level=('just_in','total_shared','just_in')[i],monday_recap_enabled=bool(i%2)),private)
                        update=add(uid,'group_updates','group_updates',dict(id=generated,group_id=groups[uid],text='Update '+str(i),created=stamp),private)['id']
                        add(uid,'group_update_reactions','group_update_reactions',dict(update_id=update,kind=('fire','clap','heart')[i],created=stamp),private)
                        add(uid,'group_weekly_reactions','group_weekly_reactions',dict(group_id=groups[uid],week_start=week,kind=('fire','clap','heart')[i],created=stamp),private)
                        add(uid,'achievement_moment_reactions','achievement_moment_reactions',dict(owner_id=peer,week_start=week,kind=('fire','clap','heart')[i],created=stamp),private)
                        activity=seed('activities',{**private,'sport':'run','name':'Exact run '+str(i),'start_time':stamp,'source':'manual'})['id']
                        add(uid,'notifications','notifications',dict(id=generated,kind='comment',activity_id=activity,dish_id=None,comment_id=None,created=stamp,read_at=stamp,reaction_kind=None,milestone_id=None,challenge_id=None,group_id=None,group_update_id=None,group_week_start=None,group_friend_invite_id=None),{**private,'actor_id':peer})
                        add(uid,'meal_reminder_attempts','meal_reminder_attempts',dict(day=day,meal=('breakfast','lunch','dinner')[i],attempted_at=stamp,delivered=i),private)
                        upload=str(uuid.uuid4())
                        add(uid,'strava_uploads','strava_uploads',dict(id=upload,size=20+i,received=10+i,state='uploading',audience=None,cursor=i,preview={'added':i,'already_here':i+1,'unreadable':i+2},result={'added':i+3,'already_here':i+4,'unreadable':i+5},error_code=None,created=stamp,updated=stamp,expires=end),{**private,'sha256':str(i)*64})
                        add(uid,'strava_import_stage','strava_import_stage',dict(state='requested',upload_id=upload,reminder_opt_in=bool(i%2),reminder_due=end,reminder_attempted=stamp,reminder_sent=bool(i%2),updated=stamp,expires=end),{**private,'stop_hash':'SECRET_STOP_'+str(i)})
                        segment=seed('segments',{'creator_id':uid,'client_id':uuid.uuid4(),'name':'Segment '+str(i),'sport':'run','distance_m':100+i,'source':'map','fingerprint':'exact-'+str(uid),'audience':'me'})['id']
                        add(uid,'segment_scans','segment_scans',dict(segment_id=segment,activity_id=activity,matcher=1+i,outcome=('match','none','ineligible')[i],reason='Reason '+str(i),scanned=stamp,generation=1+i,source_revision=1+i),private)
                        route=seed('planned_routes',{**private,'client_id':uuid.uuid4(),'sport':'run','name':'Route '+str(i)})['id']
                        add(uid,'route_reports_made','route_reports',dict(route_id=route,reason='privacy',note='Route report '+str(i),created=stamp,status='open',decided=None,outcome=None),{'reporter':uid,'decided_by':peer})
                        add(uid,'segment_reports_made','segment_reports',dict(segment_id=segment,reason='privacy',note='Segment report '+str(i),created=stamp,status='open',decided=None,outcome=None),{'reporter':uid,'person':peer,'decided_by':peer})
                    # Each account has both an outgoing and an incoming invitation;
                    # a third-party invitation must never enter its archive.
                    for i,uid in enumerate(ids):
                        peer=ids[(i+1)%3];record=dict(group_id=groups[uid],status='pending',created_at=f'2026-11-{10+i:02d}T10:00:00+00:00',expires_at=f'2026-12-{10+i:02d}T10:00:00+00:00',responded_at=None)
                        add(uid,'group_friend_invites','group_friend_invites',record,{'inviter_id':uid,'invitee_id':peer})
                        expected[peer]['group_friend_invites'].append(record.copy())
                for uid in ids:
                    archive=Path(temp)/f'{uid}.zip';E._write_export(uid,archive)
                    with zipfile.ZipFile(archive) as z:
                        for name,records in expected[uid].items():
                            with self.subTest(user=uid,artifact=name):
                                self.assertTrue(records,'No empty fixture may masquerade as isolation proof')
                                actual=[json.loads(line) for line in z.read('data/'+name+'.jsonl').splitlines()]
                                self.assertCountEqual(actual,records)
            finally:
                with db.connect() as c:
                    # Reverse FK insertion order, and remove retained nullable-owner
                    # rows explicitly, before deleting the three fictional accounts.
                    for table,rid in reversed(cleanup):
                        if table!='users':c.execute(sql.SQL('DELETE FROM {} WHERE id=%s').format(sql.Identifier(table)),(rid,))
                    for uid in ids:c.execute('DELETE FROM users WHERE id=%s',(uid,))

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

    def test_export_limits_links_and_failure_cleanup(self):
        user={'id':987654321,'login':'zz_test_export_limits'}
        with patch.dict(E._last_export,{},clear=True),patch.dict(E._links,{},clear=True),patch.object(E.time,'time',return_value=1000):
            E._last_export[user['id']]=900
            with self.assertRaises(HTTPException) as error:E._send_export(user)
            self.assertEqual(error.exception.status_code,429)
            path=E.export_link(user=user)['path'];key=path.rsplit('/',1)[1]
            with patch.object(E,'_send_export',return_value='own archive') as send:
                self.assertEqual(E.export_by_link(key),'own archive');send.assert_called_once_with(user)
                with self.assertRaises(HTTPException) as error:E.export_by_link(key)
                self.assertEqual(error.exception.status_code,404)
            key=E.export_link(user=user)['path'].rsplit('/',1)[1]
            with patch.object(E.time,'time',return_value=1301),patch.object(E,'_send_export') as send:
                with self.assertRaises(HTTPException) as error:E.export_by_link(key)
                self.assertEqual(error.exception.status_code,404);send.assert_not_called()
            E._last_export.clear()
            with tempfile.TemporaryDirectory() as directory:
                fd,path=tempfile.mkstemp(dir=directory)
                with patch.object(E.tempfile,'mkstemp',return_value=(fd,path)),patch.object(E,'_write_export',side_effect=RuntimeError('fixture failure')):
                    with self.assertRaises(RuntimeError):E._send_export(user)
                self.assertFalse(Path(path).exists());self.assertNotIn(user['id'],E._last_export)

    def test_export_and_erasure(self):
        ids=[]
        with tempfile.TemporaryDirectory() as temp, patch.object(A,'DATA',temp), patch.object(E,'DATA',temp):
            try:
                with db.connect() as c:
                    for index,tag in enumerate(('owner','other','moderator')):
                        login='zz_test_data_'+tag+'_'+secrets.token_hex(4)
                        uid=c.execute("INSERT INTO users(login,name,pw_hash,email,email_verified_at,phone_e164) VALUES(%s,%s,%s,%s,now(),%s) RETURNING id",(login,('River Owner','Avery Other','Morgan Moderator')[index],auth.hash_pw('fictional export password'),login+'@example.test',('+12025550199','+12025550198','+12025550197')[index])).fetchone()['id']
                        ids.append(uid)
                        c.execute('INSERT INTO profile(user_id,food_reminders) VALUES(%s,true)',(uid,))
                        c.execute("INSERT INTO recipes(user_id,name) VALUES(%s,%s)",(uid,tag+' recipe sentinel'))
                        c.execute("INSERT INTO beta_requests(name,email,phone,note) VALUES('River Example',%s,'iPhone',%s)",((login+'@example.test').upper(),tag+' beta sentinel '+str(uid)))
                    me,other,moderator=ids
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
                    c.execute("INSERT INTO coach_proposals(id,user_id,kind,payload,baseline,expires) VALUES(%s,%s,'goal',%s,'SECRET_BASELINE',now()+interval '1 day')",(uuid.uuid4(),me,json.dumps({'candidate':{'before':'10 km','after':'12 km','goal':{'metric':'distance','target':10000,'credentials':'SECRET_NESTED_GOAL'},'admin_notes':'SECRET_NESTED_CANDIDATE'},'provider_key':'SECRET_NESTED_PAYLOAD'})))
                    request=uuid.uuid4()
                    c.execute("INSERT INTO admin_data_requests(id,user_id,kind,status,verified_at,method) VALUES(%s,%s,'deletion','verified',now(),'signed_in')",(request,me))
                    c.execute("INSERT INTO admin_audit(actor_id,action,target) VALUES(%s,'account.test',%s)",(me,str(me)))
                    c.execute('INSERT INTO ai_service_budget(day) VALUES(current_date) ON CONFLICT DO NOTHING')
                    attempt=uuid.uuid4();c.execute("INSERT INTO ai_food_attempts(id,user_id,day,model,kind,state,request_id,reserved_micros,charged_micros) VALUES(%s,%s,current_date,'fictional','food','measured',%s,0,0)",(attempt,me,uuid.uuid4()))
                    c.execute("UPDATE recipes SET items=%s WHERE user_id=%s",(json.dumps([{'name':'owner oats','grams':100,'per100':{'kcal':200,'token':'SECRET_NESTED_NUTRIENT'},'ref':{'key':'SECRET_RECIPE_REF'}}]),me))
                    c.execute("UPDATE strava_uploads SET preview=%s,result=%s WHERE id=%s",(json.dumps({'added':2,'already_here':1,'unreadable':0,'filename':'SECRET_ARCHIVE_FILENAME'}),json.dumps({'added':1,'already_here':1,'unreadable':0,'path':'SECRET_ARCHIVE_PATH'}),upload))
                    activities={}
                    for uid in ids:
                        activities[uid]=c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,private_note,file_path) VALUES(%s,'run',%s,now(),'manual',%s,'SECRET_SERVER_PATH') RETURNING id",(uid,'activity '+str(uid),'private note '+str(uid))).fetchone()['id']
                    incoming=c.execute("INSERT INTO comments(activity_id,user_id,text) VALUES(%s,%s,'OTHER_INCOMING_PRIVATE_COMMENT') RETURNING id",(activities[me],other)).fetchone()['id']
                    kept_comment=c.execute("INSERT INTO comments(activity_id,user_id,text) VALUES(%s,%s,'OTHER_UNRELATED_COMMENT') RETURNING id",(activities[other],other)).fetchone()['id']
                    c.execute("INSERT INTO notifications(user_id,kind,actor_id,activity_id,comment_id) VALUES(%s,'comment',%s,%s,%s)",(me,other,activities[me],incoming))
                    moderation=c.execute("INSERT INTO admin_audit(actor_id,action,target) VALUES(%s,'PRIVATE_MODERATION_SENTINEL',%s) RETURNING id",(moderator,str(me))).fetchone()['id']
                    c.execute("UPDATE admin_data_requests SET actor_id=%s,completed_by=%s WHERE id=%s",(moderator,moderator,request))
                    c.execute("INSERT INTO api_requests(user_id,method,route,status,duration_ms,channel,request_id) SELECT %s,'GET','/api/food/entries',200,1,'web',gen_random_uuid() FROM generate_series(1,620)",(me,))
                    stable_queries={
                        'users':('SELECT * FROM users WHERE id=%s',(other,)),
                        'profile':('SELECT * FROM profile WHERE user_id=%s',(other,)),
                        'recipes':('SELECT * FROM recipes WHERE user_id=%s ORDER BY id',(other,)),
                        'activities':('SELECT id,name,private_note FROM activities WHERE user_id=%s ORDER BY id',(other,)),
                        'group':('SELECT * FROM event_groups WHERE id=%s',(group,)),
                        'comment':('SELECT * FROM comments WHERE id=%s',(kept_comment,)),
                        'moderator':('SELECT * FROM users WHERE id=%s',(moderator,)),
                        'moderation':('SELECT * FROM admin_audit WHERE id=%s',(moderation,)),
                    }
                    stable_before={name:c.execute(q,args).fetchall() for name,(q,args) in stable_queries.items()}
                    before=dict(c.execute('SELECT * FROM group_challenges WHERE id=%s',(challenge,)).fetchone())
                original=Path(temp)/'files'/str(me)/'fictional.gpx';original.parent.mkdir(parents=True);original.write_bytes(b'owner original sentinel')
                staging=Path(temp)/'uploads'/str(me)/('strava-'+str(upload))/'archive.zip';staging.parent.mkdir(parents=True);staging.write_bytes(b'fictional incomplete archive')
                unrelated=Path(temp)/'other-private.gpx';unrelated.write_bytes(b'OTHER_PRIVATE_FILE_BYTES')
                (original.parent/'escape.gpx').symlink_to(unrelated)
                (original.parent/'escape-directory').symlink_to(unrelated.parent,target_is_directory=True)
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
                    self.assertEqual(len(records('api_requests')),620,'All pages of a >500-row streaming export are kept')
                    self.assertEqual(records('coach_proposals')[0]['payload']['candidate']['after'],'12 km')
                    self.assertEqual(records('recipes')[0]['items'][0]['per100'],{'kcal':200})
                    self.assertEqual(records('strava_uploads')[0]['preview'],{'added':2,'already_here':1,'unreadable':0})
                    self.assertNotIn('actor_id',records('notifications')[0])
                    self.assertNotIn('actor_id',records('support_requests')[0])
                    self.assertNotIn('completed_by',records('support_requests')[0])
                    for artifact,(_,fields) in E.NEW_EXPORTS.items():
                        for record in records(artifact):self.assertLessEqual(set(record),set(fields.split()),artifact)
                    self.assertTrue(all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in entries))
                    self.assertFalse(any('escape' in name for name in entries))
                    all_data=b''.join(entries.values())
                    for forbidden in (b'other recipe sentinel',b'other beta sentinel',b'SECRET_STOP_TOKEN',b'SECRET_CARD',b'pw_hash',b'SECRET_',b'Avery Other',b'Morgan Moderator',b'+12025550198',b'+12025550197',b'OTHER_',b'private note '+str(other).encode(),b'private note '+str(moderator).encode()):
                        self.assertNotIn(forbidden,all_data)
                    for identity in (stable_before['users'][0],stable_before['moderator'][0]):
                        for field in ('login','name','email','phone_e164'):
                            self.assertNotIn(str(identity[field]).encode(),all_data,field)
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
                    for name,(q,args) in stable_queries.items():self.assertEqual(c.execute(q,args).fetchall(),stable_before[name],name)
                    self.assertIsNone(c.execute('SELECT 1 FROM comments WHERE id=%s',(incoming,)).fetchone(),'Incoming comment follows its deleted activity')
                    self.assertIsNone(c.execute('SELECT 1 FROM users WHERE id=%s',(me,)).fetchone())
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM recipes WHERE user_id=%s',(other,)).fetchone()['n'],1)
                    self.assertIsNone(c.execute("SELECT 1 FROM beta_requests WHERE note=%s",('owner beta sentinel '+str(me),)).fetchone())
                    after=dict(c.execute('SELECT * FROM group_challenges WHERE id=%s',(challenge,)).fetchone());self.assertIsNone(after.pop('creator_id'));before.pop('creator_id');self.assertEqual(before,after)
                    self.assertIsNone(c.execute('SELECT user_id FROM admin_data_requests WHERE id=%s',(request,)).fetchone()['user_id'])
                    retained=c.execute('SELECT user_id,request_id FROM ai_food_attempts WHERE id=%s',(attempt,)).fetchone();self.assertEqual(dict(retained),{'user_id':None,'request_id':None})
                    c.execute('DELETE FROM admin_audit WHERE id=%s',(moderation,));c.execute('DELETE FROM admin_data_requests WHERE id=%s',(request,));c.execute('DELETE FROM ai_food_attempts WHERE id=%s',(attempt,))
                self.assertFalse(original.parent.exists());self.assertFalse(staging.parent.exists())
            finally:
                with db.connect() as c:
                    for uid in ids:
                        row=c.execute('SELECT id,sql_role FROM users WHERE id=%s',(uid,)).fetchone()
                        if row:A.erase(c,row)
                for uid in ids:A.erase_files(uid)


if __name__=='__main__':unittest.main()
