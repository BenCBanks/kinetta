// Notification rows: bold name, quoted comment on its own line, new-dot, short times (no browser).
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('app/static/social.js','utf8'),a=src.indexOf('function noteRow('),b=src.indexOf('route(/^\\/notifications$/');
const c={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),avatar:p=>`<span class="av">${p?.name?.[0]||'?'}</span>`,svg:k=>`<svg data-k="${k}"></svg>`,when:()=>'Mon at 9:00 AM',NOTE_ICON:{comment:'comment',cheer:'cheer'},Date};
vm.createContext(c);vm.runInContext(src.slice(a,b),c);
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const comment=c.noteRow({kind:'comment',read:false,link:'/activity/1',created:ago(5),who:{name:'Sam Fictional'},text:'Sam Fictional commented on your Easy Run: "Great <pace>!"'});
assert(comment.includes('<b>Sam Fictional</b> commented on your Easy Run<'),'name is bold, the action is plain text');
assert(comment.includes('<span class="note-q">“Great &lt;pace&gt;!”</span>'),'the comment is quoted on its own line and escaped');
assert(comment.includes('note-dot')&&comment.includes('class="note unread"'),'new notifications have a dot');
assert(comment.includes('5 min ago')&&comment.includes('data-kind="comment"'));
const old=c.noteRow({kind:'cheer',read:true,link:'/a',created:ago(60*30),who:{name:'Jo'},text:'Someone else cheered'});
assert(!old.includes('note-dot')&&!old.includes('<b>')&&old.includes('Mon at 9:00 AM'),'read rows lose the dot; a name that does not lead stays plain; older times use the date');
assert.equal(c.noteAgo(ago(0)),'Just now');assert.equal(c.noteAgo(ago(180)),'3 hr ago');
console.log('Notification rows: bold name, escaped quoted comment, new dot, kind colour hook and short times PASS');
