// Production texting viewport/controller with controlled keyboard/composer sizes.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/thread.js','utf8');const input={},events=new EventTarget(),viewport=new EventTarget(),send=new EventTarget(),list=new EventTarget(),composer={};let top=0,frame=0,observer,live=true;
Object.assign(list,{scrollHeight:1400,clientHeight:500});Object.defineProperty(list,'scrollTop',{get:()=>top,set:v=>top=Math.max(0,Math.min(v,list.scrollHeight-list.clientHeight))});const frames=new Map();
const c={AbortController,ResizeObserver:class{constructor(fn){observer=fn}observe(){}disconnect(){observer=null}},document:{activeElement:input},window:{visualViewport:viewport},addEventListener:events.addEventListener.bind(events),requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame},cancelAnimationFrame:id=>frames.delete(id)};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function foodChatViewport('),source.indexOf('const FoodThread =')),c);
const view=c.foodChatViewport({list,composer,field:input,send,active:()=>live});const flush=()=>{for(const fn of [...frames.values()])fn();frames.clear()};
view.pin();flush();assert.equal(top,900);list.clientHeight=300;viewport.dispatchEvent(new Event('resize'));flush();assert.equal(top,1100,'keyboard shrink keeps latest reply in view');
list.scrollHeight=1550;view.pin();flush();assert.equal(top,1250,'reply growth stays at newest message');list.clientHeight=400;observer();flush();assert.equal(top,1150,'composer shrink keeps bottom pinned');
const up=new Event('wheel');Object.defineProperty(up,'deltaY',{value:-20});list.dispatchEvent(up);list.scrollTop=100;list.scrollHeight=1800;view.pin();viewport.dispatchEvent(new Event('resize'));flush();assert.equal(top,100,'reading history is not interrupted by response/resize');view.pin(true);flush();assert.equal(top,1400,'sending explicitly returns to newest message');
const down=new Event('pointerdown',{cancelable:true});Object.assign(down,{button:0,isPrimary:true});send.dispatchEvent(down);assert(down.defaultPrevented,'Send cannot steal composer focus/close keyboard');c.document.activeElement={};const other=new Event('pointerdown',{cancelable:true});Object.assign(other,{button:0,isPrimary:true});send.dispatchEvent(other);assert(!other.defaultPrevented,'keyboard/assistive button focus keeps normal behavior');
view.dispose();top=15;viewport.dispatchEvent(new Event('resize'));flush();assert.equal(top,15,'disposed view cannot move the old conversation');
assert(source.includes('enterkeyhint="send"'));assert(source.includes('!e.isComposing'));assert(source.includes('e.keyCode!==229'));assert(source.includes("!e.shiftKey"));
console.log('Food texting: latest reply stays visible through keyboard/composer/response resizes; history reading respected; Send preserves input focus; disposal and IME/Shift+Enter guards PASS');
