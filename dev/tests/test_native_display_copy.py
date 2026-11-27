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
 if(stage==='notifications'){
  assert.equal(r['/api/notifications'].items.length,4);
  const request=r['/api/notifications'].items.find(row=>row.kind==='friend_request');
  assert.equal(request.text,'Taylor wants to be friends','non-friend request matches the server first-name privacy rule');
  assert.equal(request.who.name,'Taylor');
 }
} """
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/appstore.cjs')],cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_store_home_waits_for_both_visible_maps(self):
        node=r"""const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8');
const helper=source.slice(source.indexOf('  function storeMapElements(){'),source.indexOf('  async function waitForStorePaint(){'));
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

    def test_store_map_coverage_fades_replacement_and_failure(self):
        node=r"""const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8');
const helpers=source.slice(source.indexOf('  function storeMapElements(){'),source.indexOf('  async function waitForStoreCrop('));
const bounds={left:0,top:0,right:200,bottom:100,width:200,height:100};
const tile=(left,right,opacity=1)=>({style:{display:'block',visibility:'visible',opacity},loaded:true,getBoundingClientRect:()=>({...bounds,left,right,width:right-left}),classList:{contains(){return this.tile.loaded;}}});
function makeTile(...args){const t=tile(...args);t.classList.tile=t;return t;}
let ownTiles=[makeTile(0,100),makeTile(100,200,0)],friendTiles=[makeTile(0,200)],ticks=0,advances=0,replaced=false,mode='repair';
const own={getBoundingClientRect:()=>bounds,querySelectorAll:()=>ownTiles},friend={getBoundingClientRect:()=>bounds,querySelectorAll:()=>friendTiles};
const cfg={stage:'header-activity',advanceFixtureClock(ms){assert.equal(ms,250);advances++;if(mode==='repair')for(const t of [...ownTiles,...friendTiles])if(t.loaded)t.style.opacity=1;return true;}};
const context=vm.createContext({cfg,WeakSet,document:{querySelectorAll:()=>[own,friend]},innerWidth:200,innerHeight:100,getComputedStyle:e=>e.style||{display:'block',visibility:'visible',opacity:'1'},paintedMap:()=>true,storeReady:()=>true,storeMapElement:()=>friend,setTimeout(ok){ticks++;if(mode==='repair'&&ticks===1){ownTiles=[makeTile(0,100),makeTile(100,200,0)];ownTiles[1].loaded=false;replaced=true;}if(mode==='repair'&&ticks===2)ownTiles[1].loaded=true;ok();},requestAnimationFrame:ok=>ok()});
vm.runInContext(helpers,context);
const painted=()=>vm.runInContext('storeMapsPainted()',context);
assert.equal(vm.runInContext('storeMapTilesLoaded()',context),true);
assert.equal(painted(),false,'loaded transparent own tile cannot pass because friend painted');
ownTiles[1].style.opacity=1;assert.equal(painted(),true);
ownTiles.pop();assert.equal(painted(),false,'missing tile leaves uncovered map area');
ownTiles.push(makeTile(100,200));ownTiles[1].parentElement={style:{display:'block',visibility:'visible',opacity:0}};
assert.equal(painted(),false,'ancestor opacity counts');delete ownTiles[1].parentElement;
(async()=>{
 await vm.runInContext('waitForStorePaint()',context);
 assert(replaced);assert.equal(advances,3,'initial, replacement and later loaded groups each finish their fade');assert(painted());
 mode='stuck';ticks=0;ownTiles[1].style.opacity=0;
 await assert.rejects(vm.runInContext('waitForStorePaint()',context),/tiles must be loaded, opaque and cover every visible map/);
 assert.equal(ticks,200,'unfinished tiles fail within the existing capture bound');
})().catch(e=>{console.error(e);process.exitCode=1;});"""
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/late.js')],cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_store_fade_clock_is_repeatable_bounded_and_stays_on_fixture_day(self):
        node=r"""const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[1],'utf8'),clock=source.slice(source.indexOf('  if(Number.isFinite(cfg.fixtureNow)){'),source.indexOf('  localStorage.clear();'));
function setup(instant){const cfg={fixtureNow:Date.parse(instant),stage:'header-activity',store:{}};const c=vm.createContext({cfg});vm.runInContext(clock,c);return {cfg,c};}
const {cfg,c}=setup('2026-11-02T12:00:00Z');
for(let n=0;n<80;n++)assert.equal(cfg.advanceFixtureClock(250),true);
assert.equal(cfg.advanceFixtureClock(250),false);assert.equal(vm.runInContext('Date.now()',c),cfg.fixtureNow+20000);
assert.equal(cfg.advanceFixtureClock(100000),false);
const midnight=setup('2026-11-02T23:59:59.900Z');assert.equal(midnight.cfg.advanceFixtureClock(250),false);
"""
        result=subprocess.run(['node','-e',node,str(ROOT/'dev/tests/native-ui/early.js')],cwd=ROOT,capture_output=True,text=True,timeout=10)
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
