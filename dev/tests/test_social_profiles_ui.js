// Production social renderers/handlers under latency, retries and account-safe API stand-ins.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/social.js','utf8'),tick=()=>new Promise(setImmediate);
(async()=>{
 let editorOwner='first';const c={readOwner:()=>editorOwner,esc:String,stat:(k,v,u='')=>`[${k}:${v}${u}]`,U:{dist:n=>(n/1000).toFixed(1),du:()=> 'km'},dur:n=>n+' seconds',fdate:d=>d};vm.createContext(c);
 // Your own profile belongs to Me; other people's profiles remain in Activity.
 c.App={me:{login:'alex'},cache:new Map()};vm.runInContext(source.slice(source.indexOf('const profileTab'),source.indexOf('route(/^\\/people'))+'\nglobalThis.tab=profileTab;',c);
 assert.equal(c.tab('ALEX'),'me');assert.equal(c.tab('jordan'),'activity');
 // Find friends keeps discovery, inline incoming requests and secondary actions in their current order.
 Object.assign(c,{App:{me:{login:'alex'}},backBtn:label=>`<button>${label}</button>`,svg:name=>`<svg data-icon="${name}"></svg>`,profileHref:p=>'/people/'+p.login,avatar:p=>`<span>${p.login}</span>`,route(){}});
 vm.runInContext(fs.readFileSync('app/static/friends-ui.js','utf8')+'\nglobalThis.FriendsUITest=FriendsUI;',c);
 const shell=c.FriendsUITest.shell('Me');assert(shell.includes('Search name or @username'));assert(shell.includes('Invite a friend'));assert(shell.includes('friend-more-ways'));assert(shell.includes('fr-requests'));assert(shell.includes('fr-suggest'));
 for(const retired of ['Your profile','Your friends will appear here','New activities:','/me/sharing','fr-own-list','fr-lists'])assert(!shell.includes(retired),`Find friends omits ${retired}`);
 const requestMarkup=c.FriendsUITest.requests({incoming:[{name:'Casey Fixture',login:'casey'}],outgoing:[{name:'Riley Fixture',login:'riley'}]});assert(requestMarkup.includes('Waiting for you'));assert(requestMarkup.includes('Sent'));assert(!requestMarkup.includes('Your friends will appear here'));
 // The separate profile editor is gone; Settings uses the current inline card editor.
 const profile=fs.readFileSync('app/static/profile.js','utf8'),settings=fs.readFileSync('app/static/settings-route.js','utf8');
 assert(!source.includes('function editProfile(')&&!source.includes('Draft preview')&&!source.includes('pf-editor'));
 assert(!profile.includes('data-card-identity')&&!profile.includes('function editor(box,initial'));
 assert(settings.includes("$('#m-profile', el).onclick = () => MeCard.openEditor()"));assert(profile.includes("openEditor:()=>go('/me?edit=profile')"));
 // Friend invites use the Story artwork while carrying the invitation URL in selectable text.
 c.invalidate=()=>{};c.keep=()=>{};c.invalidateFeed=()=>{};c.toast=()=>{};c.App={me:{name:'Old name'}};
 let shareSheet=null;const copyInput={select(){this.selected=true;},selected:false};
 c.appBase=()=> 'https://example.test';let shared=null,copied='';c.navigator={share:async data=>{shared=data;},clipboard:{writeText:async data=>{copied=data;}}};
 c.sheet=(title,html,mount)=>{const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{textContent:'',disabled:false,hidden:true}]));const box={nodes,isConnected:true};shareSheet={title,html,box};mount(box,()=>{box.isConnected=false;});};
 c.$=(sel,box)=>sel==='input'?copyInput:box?.nodes[sel]||null;
 vm.runInContext(source.slice(source.indexOf('async function inviteFriends()'),source.indexOf("route(/^\\/me\\/friends$/")),c);
 c.ShareSheet={open(options){shareSheet=options;}};c.loadShareArt=async()=>{};c.ShareArt={friendInvitationPicture:async()=>({blob:new Blob(['fictional'])})};
 c.api=async()=>({url:'/add/fictional-invitation'});await c.inviteFriends();assert.equal(shareSheet.title,'Invite friends');assert.equal(shareSheet.mode,'story');assert.equal(shareSheet.items[0].label,'Friend invitation');assert.equal(shareSheet.items[0].link,'https://example.test/add/fictional-invitation');assert.equal(shareSheet.items[0].copyText,'Connect with me on Kinetta, the workout and food app. This friendship invite lasts 30 days: https://example.test/add/fictional-invitation');assert.equal(shareSheet.actions[0].label,'Make a new link');assert(await shareSheet.items[0].build(),'friend invitation exposes its no-identity Story artwork');
 // Group invites open the friend picker; sharing reuses the current link and has a clipboard fallback.
 const groupClasses=new Set(),groupReads=[];let groupBox,groupMarkup;
 const search={value:''},results={innerHTML:'',setAttribute(){}},share={disabled:false};
 c.sheet=(title,html,mount)=>{groupMarkup=html;groupBox={isConnected:true,closest:()=>({classList:{add:name=>groupClasses.add(name)}}),nodes:{'#group-friend-search':search,'.group-friend-results':results,'[data-group-share]':share}};mount(groupBox,()=>{});};
 c.$=(selector,box)=>box?.nodes?.[selector]||null;c.$$=()=>[];
 c.api=async path=>{groupReads.push(path);return{friends:[],can_invite:true};};
 vm.runInContext(source.slice(source.indexOf('function groupInviteSheet('),source.indexOf('function groupCreateSheet('))+'\nglobalThis.groupInviteSheetTest=groupInviteSheet;',c);
 c.groupInviteSheetTest({id:'fictional-group',title:'Fictional Trail Group'},'https://example.test/group-invite/fictional-token');await tick();
 assert(groupClasses.has('group-friend-sheet'));assert(groupMarkup.includes('Search friends'));assert(!groupMarkup.includes('data-group-copy'),'raw link/copy controls are replaced by the picker');
 assert.deepEqual(groupReads,['/api/groups/fictional-group/friends'],'opening Invite reads friends without creating or rotating a link');
 await share.onclick();assert.equal(shared.text,"You’re invited to ‘Fictional Trail Group’ on Kinetta, the workout and food app: https://example.test/group-invite/fictional-token");assert.equal(shared.url,undefined);
 c.navigator.share=null;await share.onclick();assert.equal(copied,shared.text,'native share and clipboard fallback carry the same invite text');assert.equal(share.disabled,false);
 assert.deepEqual(groupReads,['/api/groups/fictional-group/friends'],'sharing an existing link does not rotate it');
 let resolveInvite;c.api=()=>new Promise(resolve=>resolveInvite=resolve);shareSheet=null;const oldInvite=c.inviteFriends();editorOwner='third';resolveInvite({url:'/add/old-account-link'});await oldInvite;assert.equal(shareSheet,null,'an old account’s delayed invite link cannot appear after login changes');
 console.log('Social profiles: own tab, Find friends shell, unified editor entry, invite controls and account fences PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
