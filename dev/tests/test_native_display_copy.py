"""Prepare diagnostics only in a disposable bundle; leave the original app/assets intact."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
PREPARE=ROOT/'dev/tests/native-ui/prepare.py'


class DisplayCopyTests(unittest.TestCase):
    def test_native_fixture_patches_esbuild_minified_preferences_get(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'Original.app';public=source/'public';static=public/'static';static.mkdir(parents=True)
            (public/'index.html').write_text('<body><script src="/static/app-shell.js"></script></body>')
            (static/'app-shell.js').write_text('const P=on?C.Plugins:{},prefs=P.Preferences,get=async key=>(await prefs.get({key})).value,put=(key,value)=>value;')
            (static/'appearance.js').write_bytes((ROOT/'app/static/appearance.js').read_bytes())
            original=(static/'app-shell.js').read_text()
            destination=Path(temp)/'Fixture.app'
            subprocess.run(['python3',str(PREPARE),str(source),str(destination),'--stage','header-me','--root','16','--run','d'*32,'--startup-timing'],check=True,cwd=ROOT)
            shell=(destination/'public/static/app-shell.js').read_text()
            self.assertIn("key==='token'?'fictional-native-ui-only'",shell,'the disposable fixture patches the minified native Preferences.get function')
            self.assertEqual((static/'app-shell.js').read_text(),original,'the simulator source bundle stays untouched')
            early=(destination/'public/static/native-ui-early.js').read_text()
            html=(destination/'public/index.html').read_text()
            self.assertLess(html.index('native-ui-early.js'),html.index('app-shell.js'))
            self.assertIn('webViewReadyPerfMs=performance.now()',early)

    def test_store_fixture_serves_home_group_strip_and_blocks_unlisted_writes(self):
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

    def test_store_food_totals_and_homepage_privacy_match_the_fixture(self):
        node=r"""const assert=require('node:assert/strict'),fixture=require(process.argv[1]);
for(const homepage of [false,true]){
  const r=fixture(homepage).responses,day=r['/api/food/day'],history=r['/api/food/history'][0];
  for(const key of ['kcal','protein_g','carbs_g','fat_g']){
    assert.equal(day.entries.reduce((sum,entry)=>sum+entry[key],0),day.totals[key]);
    assert.equal(history[key],day.totals[key],'the history and daily screenshot show the same logged food');
  }
  assert.equal(r['/api/me'].protein_target,day.targets.protein_target);
  assert.equal(r['/api/activities/1'].visibility,homepage?'me':'friends');
  assert.equal(r['/api/activities/1/social'].visibility,homepage?'me':'friends');
}"""
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/appstore.cjs')],
                              cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_current_store_scenes_are_display_only_and_reopen_saved_chat(self):
        node=r"""const assert=require('node:assert/strict'),fixture=require(process.argv[1]);
const A='00000000-0000-4000-8000-000000000011';
for(const stage of ['kit-chart','kit-history','kit-memory','notifications','food-review']){
 const r=fixture(false,stage).responses;
 assert(!Object.keys(r).some(k=>/messages.*answer|DELETE |memory$/.test(k)&&k.startsWith('POST ')));
 if(stage.startsWith('kit-')){
  assert(r['/api/me'].kit_chat&&r['/api/me'].ai_access.coach.available);
  assert.equal(r['/api/coach/conversation/threads'].conversations.length,8);
  const e=r['POST /api/coach/conversation/threads/'+A+'/resume'];
  assert.deepEqual(e.messages,r['/api/coach/conversation/threads/'+A].messages);
  assert.deepEqual(e.messages[0].answer.chart.points.map(p=>p.plot_value),[125,171,200]);
  assert.equal(r['/api/coach/conversation/memory'].memories.length,6);
 }
 const day=r['/api/food/day'];assert.equal(day.totals.kcal,915);assert.equal(day.entries.reduce((n,e)=>n+e.kcal,0),915);assert.equal(day.totals.protein_g*4+day.totals.carbs_g*4+day.totals.fat_g*9,915);
 if(stage==='food-review'){
  const messages=r['/api/food/thread'].messages;assert.equal(messages.length,6);
  assert.equal(new Set(messages.filter(m=>m.kind==='user').map(m=>m.client_id)).size,3);
  const preview=messages.find(m=>m.result.kind==='preview');assert(preview);
  assert(preview.result.parts[0].entries.every(e=>e.ref.estimated_portion===false));
  assert(day.entries.every(e=>e.ref.estimated_portion),'review-specific portion knowledge must not alter the logged Nutrition day');
 }
 if(stage==='notifications')assert.equal(r['/api/notifications'].items.length,4);
} """
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/appstore.cjs')],cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_store_home_waits_for_both_visible_maps(self):
        node=r"""const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8');
const helper=source.slice(source.indexOf('  function storeMapTilesLoaded(){'),source.indexOf('  async function waitForStorePaint(){'));
const bounds={left:0,top:200,right:440,bottom:500,width:440,height:300};
let ownLoaded=false;
const tile=loaded=>({getBoundingClientRect:()=>bounds,classList:{contains:()=>loaded()}});
const own={getBoundingClientRect:()=>bounds,querySelectorAll:()=>[tile(()=>ownLoaded)]};
const friend={getBoundingClientRect:()=>bounds,querySelectorAll:()=>[tile(()=>true)]};
const offscreen={getBoundingClientRect:()=>({...bounds,top:1200,bottom:1500}),querySelectorAll:()=>[tile(()=>false)]};
const context=vm.createContext({cfg:{stage:'header-activity'},document:{querySelectorAll:()=>[own,friend,offscreen]},innerWidth:440,innerHeight:956,getComputedStyle:()=>({display:'block',visibility:'visible'}),storeMapElement:()=>friend});
vm.runInContext(helper,context);
assert.equal(vm.runInContext('storeMapTilesLoaded()',context),false,'loaded friend does not hide an unpainted own map');
ownLoaded=true;
assert.equal(vm.runInContext('storeMapTilesLoaded()',context),true,'both visible maps are ready; offscreen maps do not block capture');
"""
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/late.js')],cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_original_and_update_keep_fixture_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'Original.app';public=source/'public';static=public/'static';static.mkdir(parents=True)
            (public/'index.html').write_text('<body><script src="/static/boot.js?v=0123456789abcdef0123456789abcdef"></script>\n<script src="/static/app-shell.js?v=0123456789abcdef0123456789abcdef"></script></body>')
            (static/'native.js').write_text("const get = async (key) => (await prefs.get({key})).value;")
            (static/'app-shell.js').write_text('/* native.js */\n'+(static/'native.js').read_text())
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
                html=(destination/'public/index.html').read_text()
                self.assertEqual(html.count('native-ui-early.js'),1,'one fixture bridge script is injected')
                self.assertLess(html.index('native-ui-early.js'),html.index('app-shell.js'),'the bridge runs before app-shell.js')
                self.assertLess(html.index('boot.js'),html.index('native-ui-early.js'),'boot remains ahead of the native fixture bridge')
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
            shell=(destination/'public/static/app-shell.js').read_text()
            self.assertIn("key==='token'?'fictional-native-ui-only'",shell,'the disposable native fixture patches the bundled bridge actually loaded by index.html')
            self.assertNotIn("key==='token'?'fictional-native-ui-only'",(destination/'public/static/native.js').read_text(),'the standalone source module is not used as a runtime patch target')
            late=(destination/'public/static/native-ui-late.js').read_text()
            self.assertIn('firstUsefulRenderPerfMs=performance.now()',late)
            after={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
            self.assertEqual(before,after,'Startup timings are injected into the disposable copy only')


if __name__=='__main__':unittest.main()
