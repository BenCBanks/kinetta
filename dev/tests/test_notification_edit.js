'use strict';
// The actual own-detail route block, including delayed/cached redraws and ownership.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/pages.js','utf8'),start=source.indexOf('  const milestoneOwner=readOwner()'),end=source.indexOf('\n});',start);
function fixture({mine=true,search='?edit=1&tab=overview',delay=false}={}){
 let owner='fictional-owner',open=0,draw=0,pending;
 const events=[],location={pathname:'/activity/42',search,hash:'#details'},el={isConnected:true};
 const row={id:42,owner:mine?null:{login:'other'},start_time:'2020-01-01T12:00:00Z'};
 const c={closeActivityEditor:()=>true,URLSearchParams,Date,location,history:{state:{demo:true},replaceState(state,unused,href){events.push('consume');const url=new URL(href,'https://example.test');Object.assign(location,{pathname:url.pathname,search:url.search,hash:url.hash});}},
  readOwner:()=>owner,Milestones:{read:async()=>({items:[]}),paint(){}},drawDetail(){draw++;},$:()=>({}),isoDay:d=>d.toISOString().slice(0,10),
  editActivity(a){assert.equal(a.id,42);assert(!new URLSearchParams(location.search).has('edit'),'Consume before opening');events.push('open');open++;},
  load:async(path,render)=>{if(delay){await new Promise(resolve=>pending=()=>{render(row);resolve();});}else{render(row);render({...row,name:'Fresh version'});}},
 };
 c.replacePageAddress=(view,href)=>{assert.equal(view,el);c.history.replaceState(c.history.state,'',href);return true;};
 vm.createContext(c);vm.runInContext('this.detail=async(el,id)=>{'+source.slice(start,end)+'};',c);
 return {c,el,location,events,open:()=>open,draw:()=>draw,owner:v=>owner=v,release:()=>pending()};
}

// Exercise the actual address helper: a consumed query stays on the same mounted
// page and updates its saved scroll identity; detached/other views cannot change it.
{
 const app=fs.readFileSync('app/static/app.js','utf8'),a=app.indexOf('function replacePageAddress('),b=app.indexOf('function render()',a);
 const el={isConnected:true},location={pathname:'/activity/42',search:'?edit=1'},App={page:{owner:'owner',key:'/activity/42?edit=1'}};
 const c={App,location,readOwner:()=> 'owner',$:()=>el,history:{state:null,replaceState(state,unused,href){const url=new URL(href,'https://example.test');location.pathname=url.pathname;location.search=url.search;}}};
 vm.createContext(c);vm.runInContext(app.slice(a,b),c);
 assert(c.replacePageAddress(el,'/activity/42'));assert.equal(el._renderKey,'/activity/42');assert.equal(App.page.key,'/activity/42');
 assert.equal(c.replacePageAddress({isConnected:true},'/me'),false);assert.equal(location.pathname,'/activity/42');
 el.isConnected=false;assert.equal(c.replacePageAddress(el,'/me'),false);
}

(async()=>{
 let f=fixture();await f.c.detail(f.el,'42');assert.equal(f.open(),1);assert.equal(f.draw(),2);assert.deepEqual(f.events,['consume','open']);assert.equal(f.location.search,'?tab=overview');assert.equal(f.location.hash,'#details');
 f=fixture();f.c.closeActivityEditor=()=>false;await f.c.detail(f.el,'42');assert.equal(f.open(),0,'A retained editor draft cannot be stacked');
 for(const options of [{mine:false},{search:''},{search:'?edit=2'}]){f=fixture(options);await f.c.detail(f.el,'42');assert.equal(f.open(),0);}
 for(const change of [f=>f.el.isConnected=false,f=>f.location.pathname='/me',f=>f.owner('different-account')]){f=fixture({delay:true});const task=f.c.detail(f.el,'42');await new Promise(setImmediate);change(f);f.release();await task;assert.equal(f.open(),0,'Late detail cannot open an editor in another view/account');}
 f=fixture();f.c.load=async()=>{throw Error('Missing');};await assert.rejects(f.c.detail(f.el,'42'),/Missing/);assert.equal(f.open(),0);
 console.log('Notification Edit: own-only, consume-before-open, cached redraw once, preserved query/hash, missing/late account/view guards PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
