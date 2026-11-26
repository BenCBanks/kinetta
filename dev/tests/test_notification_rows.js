// Notification rows: bold name, quoted comment on its own line, new-dot, short times (no browser).
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('app/static/social-notifications.js','utf8'),opened=[],navigated=[],routes=[];
const fixtureInstant=new Date(require('../screenshots/fixture-time.json').instant);
class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[fixtureInstant]));}static now(){return fixtureInstant.valueOf();}}
const c={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),avatar:p=>`<span class="av">${p?.name?.[0]||'?'}</span>`,svg:k=>`<svg data-k="${k}"></svg>`,when:()=>'Mon at 9:00 AM',App:{me:{tz:'America/New_York'}},Recaps:{today:()=> '2026-11-05',open(...args){opened.push(args);}},go:path=>navigated.push(path),notificationEntryTab:()=> 'activity',route:(re,tab,fn)=>routes.push({re,tab,fn}),Date:FixtureDate};
vm.createContext(c);vm.runInContext(src,c);
assert(src.includes('Recaps.today(')&&src.includes('Recaps.open('),'notification summaries use the eager recap shell facade');
assert(!src.includes('RecapEditor')&&!src.includes('loadRecapEditor'),'notification leaf does not own the deferred recap editor');
assert.deepEqual(routes.map(({re,tab})=>[re.toString(),typeof tab==='function'?tab():tab]),[['/^\\/notifications$/','activity'],['/^\\/me\\/notifications$/','me']],'the real extracted module registers both notification routes');
const ago=m=>new Date(fixtureInstant.valueOf()-m*60000).toISOString();
const comment=c.noteRow({kind:'comment',read:false,link:'/activity/1',created:ago(5),who:{name:'Sam Fictional'},text:'Sam Fictional commented on your Easy Run: "Great <pace>!"'});
assert(comment.includes('<b>Sam Fictional</b> commented on your Easy Run:'),'name is bold, the action is plain text');
assert(comment.includes('&quot;Great &lt;pace&gt;!&quot;'),'the comment remains in the accessible two-line text block and is escaped');
assert(!comment.includes('note-dot')&&comment.includes('class="note unread"')&&comment.includes('. New.'),'new notifications use a row state without a gutter');
assert(comment.includes('5 min ago')&&comment.includes('data-kind="comment"'));
const old=c.noteRow({kind:'cheer',read:true,link:'/a',created:ago(60*30),who:{name:'Jo'},text:'Someone else cheered'});
assert(!old.includes('note-dot')&&!old.includes('. New.')&&!old.includes('<b>')&&old.includes('Yesterday'),'read rows have no dot slot; non-leading names stay plain and times stay compact');
assert(old.includes('class="note-time"'),'notification time has its right-aligned row target');
const summary=c.noteRow({kind:'monthly_summary',period_type:'month',period:'2026-10',read:false,link:'/notifications?summary=2026-10',created:ago(2),who:{name:'Kinetta'},text:'Your October summary is ready',detail:'112 mi · 18 workouts'});
assert(summary.includes('data-summary-type="month" data-summary-period="2026-10"')&&summary.includes('112 mi · 18 workouts'),'monthly summaries expose a period link and private computed detail');
c.openSummary('month','2026-10');assert.equal(JSON.stringify(opened.pop()),'[{"period":"month","offset":1}]','a recent monthly item opens its exact month');
c.openSummary('month','2024-11');assert.equal(JSON.stringify(opened.pop()),'[{"period":"month","offset":24}]','the oldest supported month stays exact');
c.openSummary('month','2024-10');assert.deepEqual(navigated,['/progress']);assert.equal(JSON.stringify(opened.pop()),'[]','older monthly items open Progress → Share instead of a capped month');
const year=c.noteRow({kind:'monthly_summary',period_type:'year',period:'2024',read:true,link:'/notifications?year=2024',created:ago(2),who:{name:'Kinetta'},text:'Your 2024 summary is ready'});
assert(year.includes('data-summary-type="year" data-summary-period="2024"'),'year summaries expose their period link');
c.openSummary('year','2024');assert.equal(JSON.stringify(opened.pop()),'[{"period":"year","offset":2}]','year links open their exact year');
assert.equal(c.noteAgo(ago(0)),'Just now');assert.equal(c.noteAgo(ago(180)),'3 hr ago');
const dayGroups=c.notificationDayGroups([
 {created:'2026-11-09T22:00:00Z',read:true},
 {created:'2026-11-09T04:00:00Z',read:false}
]);
assert.equal(dayGroups.today.length,1,'Today uses the account timezone and groups by date, regardless of read state');
assert.equal(dayGroups.earlier.length,1,'earlier notifications use their account-local date');
assert(src.includes("You're all caught up"),'the empty notification state is a calm one-line message');
console.log('Notification rows: both routes, comments, new dot, month/year summary links, 24-month fallback and short times PASS');

const reaction=(over={})=>({kind:'cheer',reaction_kind:'strong',activity:'Morning Run',link:'/activity/1',created:ago(5),read:false,who:{name:'Sam Example',login:'sam'},compact_text:'Sam Example reacted 💪 to Morning Run',...over});
const grouped=c.groupNotificationReactions([reaction(),reaction({who:{name:'Jo Sample',login:'jo'}}),reaction({who:{name:'Third Person',login:'third'}}),reaction({link:'/activity/2'}),reaction({read:true}),reaction({reaction_kind:'thumbsup'}),reaction({created:ago(60*48)})]);
assert.equal(grouped.length,5,'different target, read state, emoji and local day remain separate');
assert.equal(grouped[0].compact_text,'Sam Example and 2 others reacted 💪 to Morning Run');
assert.equal(c.groupNotificationReactions([reaction(),reaction()])[0].compact_text,'Sam Example reacted 💪 to Morning Run','duplicate actor is never counted twice');
const compact=c.noteRow({...reaction(),text:'Old verbose wording'});assert(compact.includes('reacted 💪 to Morning Run')&&!compact.includes('Old verbose wording'));
assert(compact.includes('href="/activity/1"'),'grouped notification retains the same destination');
const shell=fs.readFileSync('app/static/app.js','utf8');
vm.runInContext(shell.slice(shell.indexOf('function notificationEntryTab()'),shell.indexOf('function sectionReturnOverlayOpen(')),c);
c.history={state:{},length:3};c.readOwner=()=>1;c.location={href:'https://example.test/notifications'};c.URL=URL;
for(const [parent,tab] of [['Home','activity'],['Me','me'],['Progress','progress'],['Nutrition','food'],['Track','track']]){c.BackNavigation={destination:()=>({path:'/origin'}),parent:()=>parent};assert.equal(c.notificationEntryTab(),tab);}
c.sectionTabForPath=()=> 'activity';assert.equal(c.sectionReturnPathAllowed('activity','/notifications'),false,'inbox never replaces Home root');
console.log('Compact inbox: grouping boundaries, unchanged targets, source copy, entry tab and tab root PASS');
