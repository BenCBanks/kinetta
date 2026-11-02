"""Event/path decisions and workflow wiring; no GitHub mutations."""
import contextlib
import io
import json
import sys
import textwrap
import importlib.util
from pathlib import Path
import unittest
import os
import subprocess
import tempfile
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ci_policy',ROOT/'dev/ci/policy.py')
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)


class CIPolicyTests(unittest.TestCase):
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


if __name__=='__main__':unittest.main()
