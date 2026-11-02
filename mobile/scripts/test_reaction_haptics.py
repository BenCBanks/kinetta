"""Reaction hook contracts with a stand-in bridge; no device, vibration or network calls."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ReactionHaptics(unittest.TestCase):
    def test_simulator_smoke_requires_the_actual_bridge(self):
        script = r'''
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const swift=fs.readFileSync('mobile/ios/App/App/NativeActivityShare.swift','utf8');
const body=swift.match(/let script = """\n([\s\S]*?)\n\s*"""/)[1];
const hook=fs.readFileSync('app/static/haptics.js','utf8');
async function run({preloaded=true,reject=false,missing=false,loadError=false,hang=false}={}){
 let expire;const calls=[];
 const c={isNativePlatform:()=>true,getPlatform:()=>'ios',isPluginAvailable:()=>!missing,Plugins:{KinettaHaptics:{tap:async options=>{
  calls.push(options.kind);if(reject)throw Error('Fictional native failure');if(hang)await new Promise(()=>{});
 }}}};
 const context=vm.createContext({Capacitor:c,setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>{},document:{
  createElement:()=>({}),head:{append:script=>{
   assert.equal(script.src,'/static/haptics.js');
   if(loadError)script.onerror();else{vm.runInContext(hook,context);script.onload();}
  }}
 }});
 if(preloaded)vm.runInContext(hook,context);
 const pending=vm.runInContext('(async()=>{'+body+'})()',context);
 if(hang){await new Promise(resolve=>setImmediate(resolve));expire();}
 return {result:JSON.parse(JSON.stringify(await pending)),calls};
}
(async()=>{
 for(const preloaded of [true,false]){
  const {result,calls}=await run({preloaded});assert.deepEqual(calls,['light','selection']);
  assert.deepEqual(result,{available:true,lightResolved:true,selectionResolved:true,hookLoadedBy:preloaded?'app':'fixture'});
 }
 await assert.rejects(run({missing:true}),/Native haptics unavailable/);
 await assert.rejects(run({reject:true}),/Fictional native failure/);
 await assert.rejects(run({preloaded:false,loadError:true}),/Bundled haptics hook missing/);
 await assert.rejects(run({hang:true}),/Haptics bridge timeout/);
 console.log('Simulator haptics smoke script: app/fixture loading, real bridge success/failure and bounded timeout PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
        subprocess.run(['node', '-e', script], cwd=ROOT, check=True)

    def test_native_mapping_and_browser_failure_boundaries(self):
        script = r'''
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/static/haptics.js','utf8');
const load=capacitor=>{
 const context=vm.createContext({Capacitor:capacitor,navigator:{vibrate(){throw Error('Browser vibration is forbidden');}}});
 vm.runInContext(source,context);return context;
};
const native=plugin=>({isNativePlatform:()=>true,getPlatform:()=>'ios',isPluginAvailable:()=>true,Plugins:{KinettaHaptics:plugin}});
(async()=>{
 const calls=[],plugin={tap:async options=>{calls.push(JSON.parse(JSON.stringify(options)));}};
 const ios=load(native(plugin));
 assert(Object.isFrozen(ios.Haptics));await ios.Haptics.react();await ios.Haptics.tick();
 assert.deepEqual(calls,[{kind:'light'},{kind:'selection'}],'one light impact and one selection tick');
 for(const capacitor of [undefined,{...native(plugin),isNativePlatform:()=>false},
       {...native(plugin),getPlatform:()=>'android'}, {...native(plugin),isPluginAvailable:()=>false},
       native(undefined),native({})]){
  const browser=load(capacitor);await browser.Haptics.react();await browser.Haptics.tick();
 }
 assert.equal(calls.length,2,'browser, unsupported platform and missing bridge are silent');
 const late=load(native(undefined));await late.Haptics.react();
 late.Capacitor.Plugins.KinettaHaptics=plugin;await late.Haptics.react();
 assert.equal(calls.length,3,'plugin is resolved when called, not at script installation');
 const failures=[];process.on('unhandledRejection',error=>failures.push(error));
 for(const broken of [{tap(){throw Error('Fictional missing native method');}},
       {tap(){return Promise.reject(Error('Fictional bridge rejection'));}}]){
  const ios=load(native(broken));await ios.Haptics.react();await ios.Haptics.tick();
 }
 const unavailable=load({...native(plugin),isPluginAvailable(){throw Error('Fictional old runtime');}});
 await unavailable.Haptics.react();await unavailable.Haptics.tick();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(failures,[]);
 // Loading before Native/app initialization is safe, and a non-responding bridge never blocks the caller.
 const pending=load(native({tap:()=>new Promise(()=>{})}));
 assert.equal(typeof pending.Haptics.react().then,'function');
 console.log('Reaction haptics: light/selection, browser no-op, late/missing/throwing/rejected bridges and script order PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
        subprocess.run(['node', '-e', script], cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
