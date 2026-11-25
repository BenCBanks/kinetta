"""Offline native tour contracts: fictional scenes, closed requests and isolated copies."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
FIXTURE=ROOT/'dev/tests/native-ui'


class NativeTourTests(unittest.TestCase):
    def test_all_scenes_use_existing_routes_and_fictional_responses(self):
        script=r'''const assert=require('node:assert/strict'),tour=require(process.argv[1]);
assert.equal(Object.keys(tour.scenes).length,17);
for(const name of Object.keys(tour.scenes)){
 const f=tour(name),r=f.responses;
 assert.equal(f.tour.name,name);assert(f.tour.route.startsWith('/'));
 assert(f.tour.ready);assert.equal(r['/api/me'].name,'Alex Example');
 assert.equal(r['/api/friends'].friends.length,3);
 assert.equal(r['/api/activities/1'].social.visibility,'friends');
 assert(!Object.keys(r).some(key=>/messages\/.*\/answer/.test(key)),'no provider-capable answer endpoint');
}
assert.equal(tour.scenes['training-lift-session'].route,'/activity/3');
assert.throws(()=>tour('unknown'),/Unknown native tour scene/);'''
        subprocess.run(['node','-e',script,str(FIXTURE/'tour.cjs')],cwd=ROOT,check=True)

    def test_tour_requests_stay_closed_except_fixture_visit_creation(self):
        script=r'''const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const store=require(process.argv[2])('kit-weekly-insight'),config={stage:'header-me',tour:store.tour,store,root:16};
const c=vm.createContext({KinettaUIFixture:config,addEventListener(){},document:{documentElement:{style:{}}},history:{replaceState(a,b,route){assert.equal(route,'/me/kit?from=progress');}},localStorage:{clear(){}},location:{origin:'https://example.test',href:'https://example.test/'},performance:{now:()=>0},fetch:async()=>{throw Error('Network forbidden');},Response,URL,structuredClone});
vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);
(async()=>{
 const visit=await vm.runInContext("fetch('/api/coach/conversation/visits',{method:'POST',body:JSON.stringify({visit_id:'fictional-visit'})}).then(r=>r.json())",c);
 assert.equal(visit.visit_id,'fictional-visit');
 for(const p of ['/api/coach/conversation/messages','/api/food/thread/messages','/api/profile'])await assert.rejects(vm.runInContext(`fetch('${p}',{method:'POST'})`,c),/blocked unexpected request/);
 assert.equal(config.blocked.length,3);
})().catch(e=>{console.error(e);process.exitCode=1;});'''
        subprocess.run(['node','-e',script,str(FIXTURE/'early.js'),str(FIXTURE/'tour.cjs')],cwd=ROOT,check=True)

    def test_prepare_injects_tour_into_disposable_bundle_only(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'Original.app';static=source/'public/static';static.mkdir(parents=True)
            (source/'public/index.html').write_text('<body><script src="/static/app-shell.js"></script></body>')
            original='const prefs=P.Preferences,get=async key=>(await prefs.get({key})).value;'
            (static/'app-shell.js').write_text(original)
            contract=Path(temp)/'map.json';contract.write_text(json.dumps({'kind':'pmtiles','url':'https://maps.example/fictional.pmtiles'}))
            target=Path(temp)/'Tour.app'
            subprocess.run(['python3',str(FIXTURE/'prepare.py'),str(source),str(target),'--stage','header-me','--store','--tour','challenge-start','--map-config',str(contract),'--run','a'*32],cwd=ROOT,check=True)
            early=(target/'public/static/native-ui-early.js').read_text()
            config=json.loads(early.split('globalThis.KinettaUIFixture=',1)[1].split(';\n',1)[0])
            self.assertEqual(config['tour']['name'],'challenge-start')
            self.assertNotIn('headerPage',config)
            self.assertEqual((static/'app-shell.js').read_text(),original)
            self.assertTrue((target/'public/static/tour-park.jpg').is_file())


if __name__=='__main__':unittest.main()
