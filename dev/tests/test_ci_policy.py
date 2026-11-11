"""Event/path decisions and workflow wiring; no GitHub mutations."""
import contextlib
import io
import json
import sys
import textwrap
import importlib.util
from pathlib import Path
import unittest
from collections import Counter
import os
import subprocess
import tempfile
import re
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ci_policy',ROOT/'dev/ci/policy.py')
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)

def configured_roots(source):
    roots=[]
    for pattern in (
        r'\broot(?:Font)?\s*:\s*(\d+)',
        r'\broot\s*={1,2}\s*(\d+)',
        r'\bROOT\s*=\s*(\d+)',
        r"documentElement\.style\.fontSize\s*=\s*['\"](\d+)px",
    ):
        roots.extend(int(value) for value in re.findall(pattern,source))
    for values in re.findall(r'\broot\s+of\s*\[([^\]]+)\]',source):
        roots.extend(int(value) for value in re.findall(r'\d+',values))
    return roots


class CIPolicyTests(unittest.TestCase):
    def test_test_roots_stop_at_16_and_still_allow_15(self):
        self.assertEqual([root for root in configured_roots('root:15; root:16; ROOT=16') if root>16],[])
        self.assertEqual([root for root in configured_roots('root:17; rootFont:24; root==32; ROOT=20; documentElement.style.fontSize="18px"; for(const root of [15,16,32])') if root>16],[17,24,32,20,18,32])

        offenders=[]
        for path in (ROOT/'dev/tests').rglob('*'):
            if not path.is_file() or path.suffix not in {'.cjs','.js','.py','.sh'}:continue
            relative=path.relative_to(ROOT).as_posix()
            if relative=='dev/tests/test_ci_policy.py':continue
            large=[root for root in configured_roots(path.read_text()) if root>16]
            if large:offenders.append((relative,large))
        self.assertEqual(offenders,[],'test roots above 16 are out of scope for this app')

    def test_ready_native_paths_and_draft_skip(self):
        for path in ('mobile/ios/App/App.swift','app/static/style.css','dev/tests/native-ui/run.py','app/asset_build.py','.github/workflows/ios.yml','dev/ci/policy.py','dev/demo/friends.cjs','dev/demo/activity_detail.cjs','dev/demo/track_session.cjs','dev/tests/fixtures/interval_presets.json'):
            self.assertTrue(policy.native_needed('pull_request',{'pull_request':{'draft':False}},[path]))
            self.assertFalse(policy.native_needed('pull_request',{'pull_request':{'draft':True}},[path]))
        for paths in (['app/api_food.py'],['docs/ios.md'],['site/assets/site.css'],['dev/tests/test_social.py'],[]):
            self.assertFalse(policy.native_needed('pull_request',{'pull_request':{'draft':False}},paths))
        for event in ('schedule','workflow_dispatch','push'):self.assertTrue(policy.native_needed(event,{},[]))
        self.assertTrue(policy.native_needed('pull_request',{'pull_request':{'draft':False}},['docs/demo.md']*400+['app/static/app.js']))

    def test_real_git_diff_includes_renamed_fixture(self):
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp)
            def git(*args):return subprocess.run(['git','-C',temp,*args],check=True,capture_output=True).stdout.decode().strip()
            git('init','-b','main');git('config','user.name','Demo');git('config','user.email','demo@example.invalid')
            (folder/'old.txt').write_text('fictional');git('add','.');git('commit','-m','Base');base=git('rev-parse','HEAD')
            (folder/'dev/tests/native-ui').mkdir(parents=True);git('mv','old.txt','dev/tests/native-ui/fixture.txt');git('commit','-m','Move fixture');head=git('rev-parse','HEAD')
            original=os.getcwd()
            try:
                os.chdir(temp);paths=policy.changed_paths({'pull_request':{'base':{'sha':base},'head':{'sha':head}}})
            finally:os.chdir(original)
            self.assertEqual(set(paths),{'old.txt','dev/tests/native-ui/fixture.txt'})
            self.assertTrue(policy.native_needed('pull_request',{'pull_request':{'draft':False}},paths))

    def test_store_draft_preview_is_bounded(self):
        ios=(ROOT/'.github/workflows/ios.yml').read_text()
        script=textwrap.dedent(ios.split("python3 - <<'PYCODE' >> \"$GITHUB_OUTPUT\"",1)[1].split('PYCODE',1)[0])
        cases=[(True,['mobile/appstore/README.md'],True,True),
               (True,['dev/tests/native-ui/appstore.cjs'],True,True),
               (True,['app/static/food.js'],False,False),
               (False,['mobile/appstore/README.md'],True,False),
               (None,[],False,False)]
        for draft,paths,enabled,preview in cases:
            with self.subTest(draft=draft,paths=paths),tempfile.TemporaryDirectory() as temp:
                event=Path(temp)/'event.json';event.write_text(json.dumps({'pull_request':{'draft':draft}} if draft is not None else {}))
                output=io.StringIO();old_path=sys.path[:]
                try:
                    with patch.dict(os.environ,{'GITHUB_EVENT_PATH':str(event)}),patch.dict(sys.modules,{'policy':policy}),patch.object(policy,'changed_paths',return_value=paths),contextlib.redirect_stdout(output):
                        exec(compile(script,'store-preview-step','exec'),{})
                finally:sys.path[:]=old_path
                self.assertEqual(output.getvalue().splitlines(),['enabled='+str(enabled).lower(),'preview='+str(preview).lower()])
        self.assertIn("github.event.pull_request.draft && '[\"pro\"]'",ios)
        self.assertIn("if: matrix.device == 'pro' && needs.changes.outputs.store == 'true'",ios)

    def test_workflow_event_guards_and_release_boundaries(self):
        for name in ('tests.yml','ios.yml','screenshots.yml','admin-ui.yml'):
            text=(ROOT/'.github/workflows'/name).read_text()
            self.assertIn('ready_for_review',text);self.assertIn('synchronize',text);self.assertIn('converted_to_draft',text)
            self.assertIn('github.event.pull_request.draft == false',text)
        tests=(ROOT/'.github/workflows/tests.yml').read_text()
        self.assertIn('github.event.pull_request.draft == true',tests);self.assertIn('dev/tests/run.sh --quick',tests)
        self.assertNotIn('paths:',tests) # required full-suite workflow must run for every ready PR
        ios=(ROOT/'.github/workflows/ios.yml').read_text()
        self.assertIn("native: ${{ steps.paths.outputs.native == 'true' || steps.store.outputs.preview == 'true' }}",ios)
        self.assertIn('python3 dev/ci/policy.py',ios)
        self.assertIn("if: needs.changes.outputs.release == '1' && github.ref == 'refs/heads/main'",ios)
        self.assertEqual(ios.count('npm run sync'),2) # unsigned and signed builds share stamping
        self.assertIn('RUN python -m app.asset_build app/static app/static',(ROOT/'Dockerfile').read_text())



    def test_browser_shards_cover_every_existing_command_once(self):
        workflow=(ROOT/'.github/workflows/tests.yml').read_text()
        script=(ROOT/'dev/tests/run_browser_shard.sh').read_text()
        self.assertIn('shard: [1, 2, 3, 4]',workflow)
        self.assertIn('run_browser_shard.sh',workflow)
        self.assertIn('needs: [backend, browser_shards, reviewer_integration]',workflow)
        self.assertIn('always()',workflow)
        self.assertIn('run: dev/tests/run.sh',workflow)
        self.assertIn('KINETTA_PROJECT: kt-ci-shard-${{ matrix.shard }}',workflow)
        self.assertIn('KINETTA_JOURNEY_SHOTS: /tmp/kt-ci-shard-${{ matrix.shard }}-journey-shots',workflow)
        self.assertIn('COMPOSE_FILE: ${{ github.workspace }}/docker-compose.yml:${{ github.workspace }}/dev/tests/journeys-compose.yml',workflow)

        expected='''interval_voice_ui.cjs navigation_ui.cjs asset_cache_ui.cjs explore_fixture.py lazy_route_ui.cjs
guide_ui.cjs progress_ui.cjs fitness_ui.cjs heatmap_ui.cjs profile_card_ui.cjs nutrition_ui.cjs
track_home_ui.cjs top_chips_ui.cjs track_ready_map_ui.cjs activity_home_ui.cjs activity_home_ui.cjs food_entry_ui.cjs
food_removal_ui.cjs food_memory_fixture.py food_memory_ui.cjs plan_ui.cjs activity_detail_ui.cjs
notification_edit_ui.cjs lift_compact_ui.cjs lift_ui.cjs lift_lazy_route_ui.cjs recipes_compact_ui.cjs friends_ui.cjs
back_navigation_ui.cjs personal_notifications_ui.cjs notification_settings_ui.cjs recaps_ui.cjs
insights_fixture.py insights_ui.cjs goals_ui.cjs weight_progress_fixture.py weight_progress_ui.cjs
weight_progress_actions.cjs weight_progress_journeys.cjs weight_undo_ui.cjs
inline_reactions_fixture.py inline_reactions_ui.cjs inline_reactions_actions.cjs shell_ui.cjs
password_visibility_ui.cjs signup_uniqueness_fixture.py signup_uniqueness_ui.cjs welcome_polish_ui.cjs
community_ui.cjs admin_features_fixture.py admin_features_ui.cjs feature_collection_fixture.py
feature_collection_ui.cjs journeys_prepare.py journeys.cjs journeys.cjs links.cjs'''.split()
        self.assertEqual(Counter(expected),Counter(re.findall(r'(?:node|python3) dev/tests/([A-Za-z0-9_.-]+)',script)))

        shard=None
        owners={}
        for line in script.splitlines():
            stripped=line.strip()
            if stripped in ('1)','2)','3)','4)'):
                shard=stripped[0]
            elif stripped == ';;':
                shard=None
            for prefix in ('node dev/tests/','python3 dev/tests/'):
                if prefix in line and shard:
                    name=line.split(prefix,1)[1].split()[0]
                    owners.setdefault(name,set()).add(shard)
        self.assertEqual(len(owners),len(Counter(expected)))
        self.assertTrue(all(len(shards)==1 for shards in owners.values()),owners)

    def test_exact_workflow_duplicates_are_removed_and_ci_caches_are_pinned(self):
        run=(ROOT/'dev/tests/run.sh').read_text()
        tests=(ROOT/'.github/workflows/tests.yml').read_text()
        screenshots=(ROOT/'.github/workflows/screenshots.yml').read_text()
        admin=(ROOT/'.github/workflows/admin-ui.yml').read_text()
        shard=(ROOT/'dev/tests/run_browser_shard.sh').read_text()
        cache_action=(ROOT/'.github/actions/build-test-image/action.yml').read_text()

        self.assertIn('node dev/tests/test_spacing_geometry.cjs',run)
        self.assertNotIn('node dev/tests/test_spacing_geometry.cjs',tests)
        for name in ('test_admin_logins.js','test_admin_tools.js','test_temporary_login.js'):
            self.assertIn(f'node dev/tests/{name}',run)
            self.assertNotIn(f'node dev/tests/{name}',admin)
        self.assertIn('node dev/tests/navigation_ui.cjs',shard)
        self.assertNotIn('dev/tests/navigation_ui.cjs',screenshots)
        self.assertIn('dev/screenshots/take.js',screenshots)
        self.assertNotIn('/tmp/shots-tool/node_modules',screenshots)

        for workflow in (tests,screenshots):
            self.assertIn('npm ci --prefix dev/tests/browser',workflow)
            self.assertIn('~/.cache/ms-playwright',workflow)
            self.assertIn("hashFiles('dev/tests/browser/package-lock.json')",workflow)
            self.assertNotIn('npm install playwright',workflow)
        self.assertIn('cache-from: type=gha,scope=kinetta-${{ inputs.scope }}',cache_action)
        self.assertIn('cache-to: type=gha,scope=kinetta-${{ inputs.scope }},mode=max,ignore-error=true',cache_action)
        self.assertIn('load: true',cache_action)
        self.assertNotIn('up -d --build',tests+screenshots)

if __name__=='__main__':unittest.main()
