"""Prepare diagnostics only in a disposable bundle; leave the original app/assets intact."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
PREPARE=ROOT/'dev/tests/native-ui/prepare.py'


class DisplayCopyTests(unittest.TestCase):
    def test_store_fixture_serves_home_group_strip_and_only_noop_celebration_post(self):
        node = r'''const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const config={stage:'activity',store:require(process.argv[2])()};
const context=vm.createContext({KinettaUIFixture:config,addEventListener(){},document:{documentElement:{style:{}}},history:{replaceState(){}},localStorage:{clear(){}},location:{origin:'https://example.test',href:'https://example.test/'},performance:{now:()=>0},fetch:async()=>{throw Error('native network blocked')},Response,URL,structuredClone});
vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);
(async()=>{
  const strip=await vm.runInContext("fetch('/api/groups/activity-strip').then(r=>r.json())",context);
  assert.deepEqual(strip,{muted:false,has_upcoming:false});
  const result=await vm.runInContext("fetch('/api/milestones/celebrate',{method:'POST'}).then(r=>r.json())",context);
  assert.deepEqual(result,{items:[],pending:false});
  await assert.rejects(vm.runInContext("fetch('/api/password/reset',{method:'POST'})",context),/Store fixture blocked unexpected request/);
  assert.deepEqual(Array.from(config.blocked),['POST /api/password/reset']);
})().catch(e=>{console.error(e);process.exitCode=1;});'''
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/early.js'),str(ROOT/'dev/tests/native-ui/appstore.cjs')],cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_original_and_update_keep_fixture_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'Original.app';public=source/'public';static=public/'static';static.mkdir(parents=True)
            (public/'index.html').write_text('<body><script src="/static/keyboard.js?v=0123456789abcdef0123456789abcdef"></script></body>')
            (static/'native.js').write_text("const get = async (key) => (await prefs.get({key})).value;")
            (static/'appearance.js').write_bytes((ROOT/'app/static/appearance.js').read_bytes())
            before={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
            destination=Path(temp)/'Fixture.app'
            for update,token in [(False,'a'*32),(True,'b'*32)]:
                args=['python3',str(PREPARE),str(source),str(destination),'--stage','review','--root','16','--run',token]
                if update:args.append('--update')
                subprocess.run(args,check=True,cwd=ROOT)
                early=(destination/'public/static/native-ui-early.js').read_text()
                self.assertIn('function install(cfg, env = globalThis)',early)
                self.assertEqual(early.count('function install(cfg, env = globalThis)'),1)
                self.assertLess(early.index('function install'),early.index('const cfg=globalThis.KinettaUIFixture,errors='))
                self.assertIn('"run": "'+token+'"',early)
                self.assertEqual((destination/'public/static/appearance.js').read_bytes(),(static/'appearance.js').read_bytes(),'Production appearance bytes stay exact even in the instrumented copy')
                late=(destination/'public/static/native-ui-late.js').read_text()
                self.assertIn('display:cfg.displayDiagnostics(),navigation',late)
                self.assertIn('errors:cfg.errors,display:cfg.displayDiagnostics()',late)
                self.assertEqual((destination/'public/index.html').read_text().count('native-ui-late.js'),1)
                after={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
                self.assertEqual(before,after)
            subprocess.run(['python3',str(PREPARE),str(source),str(destination),'--stage','header-me','--root','16','--run','c'*32,'--update','--startup-timing'],check=True,cwd=ROOT)
            early=(destination/'public/static/native-ui-early.js').read_text()
            self.assertIn('"startupTiming": {}',early)
            self.assertIn('webViewReadyPerfMs=performance.now()',early)
            late=(destination/'public/static/native-ui-late.js').read_text()
            self.assertIn('firstUsefulRenderPerfMs=performance.now()',late)
            after={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
            self.assertEqual(before,after,'Startup timings are injected into the disposable copy only')


if __name__=='__main__':unittest.main()
