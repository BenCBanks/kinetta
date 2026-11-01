// Serialized into the browser by Playwright; keep this function independent of Node globals.
'use strict';
function collectSpacing({screen,rules=[]}){
 const rootFont=parseFloat(getComputedStyle(document.documentElement).fontSize),targets=[],texts=[],containers=[];
 const selector=el=>{
  if(el.id)return '#'+CSS.escape(el.id);
  const parts=[];for(let n=el;n&&n!==document.body&&parts.length<5;n=n.parentElement){if(n.id){parts.unshift('#'+CSS.escape(n.id));break;}let p=n.tagName.toLowerCase();const classes=[...n.classList].filter(c=>!['on','active','selected','ready','has-before','has-after','picked'].includes(c)).slice(0,2);if(classes.length)p+='.'+classes.map(CSS.escape).join('.');const siblings=n.parentElement?[...n.parentElement.children].filter(s=>s.tagName===n.tagName):[];if(siblings.length>1)p+=`:nth-of-type(${siblings.indexOf(n)+1})`;parts.unshift(p);}return parts.join(' > ');
 };
 const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 const visible=el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(!r.width||!r.height||s.visibility==='hidden'||s.display==='none'||+s.opacity===0)return false;
  if((r.width<=1&&r.height<=1)||el.closest('[hidden],[inert]'))return false;
  for(let p=el;p;p=p.parentElement)if(p.matches('details:not([open])')&&!p.querySelector(':scope > summary')?.contains(el))return false;
  let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(+c.opacity===0||c.contentVisibility==='hidden')return false;if(/hidden|clip|auto|scroll/.test(c.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/hidden|clip|auto|scroll/.test(c.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
  return right-left>.02&&bottom-top>.02;
 };
 const exceptions=el=>rules.filter(r=>el.matches(r.selector)).map(r=>r.id);
 const modal=[...document.querySelectorAll('.scrim')].filter(visible).at(-1),scope=modal||document.body;
 const targetSelector='button,a[href],summary,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox]';
 const effective=el=>{if(el.matches('input[type=checkbox],input[type=radio]')){const label=el.closest('label')||el.labels?.[0];if(label&&visible(label))return label;}return el;};
 const nodes=new Set([...scope.querySelectorAll(targetSelector)].map(effective).filter(visible));
 const layer=el=>{if(el.closest('nav.tabs'))return'navigation';if(modal)return'dialog';for(let p=el;p&&p!==document.body;p=p.parentElement)if(['fixed','sticky'].includes(getComputedStyle(p).position))return'chrome';return'page';};
 for(const el of nodes){
  const original=el.matches('label')?el.querySelector('input'):el,key=selector(el),input=original?.matches('textarea,select,input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file])');
  const sentence=el.closest('p,li'),inlineLink=el.matches('a')&&getComputedStyle(el).display==='inline'&&!!sentence&&sentence.textContent.trim()!==el.textContent.trim();
  const box=rect(el);
  let left=Math.max(0,box.x),right=Math.min(innerWidth,box.x+box.width),top=Math.max(0,box.y),bottom=Math.min(innerHeight,box.y+box.height);
  for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}if(/hidden|clip|auto|scroll/.test(s.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}}
  const usableRect={x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)},fullyVisible=usableRect.width>=box.width-.02&&usableRect.height>=box.height-.02;
  // Sample the visible region, including the space between overlaid photo tools and fixed page chrome.
  const points=[.15,.5,.85].flatMap(x=>[.15,.5,.85].map(y=>[x,y])),hits=points.map(([x,y])=>document.elementFromPoint(usableRect.x+usableRect.width*x,usableRect.y+usableRect.height*y));
  const hit=hits.some(n=>n&&(el===n||el.contains(n))),hitOwner=hits.map(n=>n?selector(n):null);
  const pairedExceptions=Object.fromEntries(rules.filter(r=>r.withSelector&&el.matches(r.selector)).map(r=>[r.id,[...nodes].filter(n=>n!==el&&n.matches(r.withSelector)&&(!r.within||el.closest(r.within)&&el.closest(r.within)===n.closest(r.within))).map(selector)]));
  targets.push({key,selector:key,rect:box,usableRect,hit,hitOwner,fullyVisible,disabled:!!original?.disabled,pairedExceptions,font:parseFloat(getComputedStyle(original||el).fontSize),input:!!input,hero:!!el.closest('[data-hero],.hero-number,[data-type=hero]'),inlineLink,layer:layer(el),ancestors:[],exceptions:exceptions(el)});
 }
 const walker=document.createTreeWalker(scope,NodeFilter.SHOW_ELEMENT);
 for(let el=walker.nextNode();el;el=walker.nextNode()){
  if(!visible(el)||el.matches('script,style,option,title'))continue;
  const direct=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()),input=el.matches('input:not([type=checkbox]):not([type=radio]),textarea');
  if(!direct.length&&!(input&&(el.value||el.placeholder))){
   // A label may contain only nested spans/bold text. Its inline child has no clientWidth of its own.
   if(el.matches('h1,h2,h3,h4,p,span,label,b,strong,small,time')&&el.textContent.trim()&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+1&&!/auto|scroll/.test(getComputedStyle(el).overflowX))containers.push({key:selector(el),selector:selector(el),rect:rect(el),clipped:'Text container scrollWidth exceeds clientWidth',exceptions:exceptions(el)});
   continue;
  }
  const s=getComputedStyle(el),key=selector(el),content=(input?(el.value||el.placeholder):direct.map(n=>n.textContent).join(' ')).trim(),font=parseFloat(s.fontSize);
  let role=/[a-z0-9]/i.test(content)?'body':'text';
  const explicit=el.closest('[data-type]')?.dataset.type;
  if(el.matches('i,small')&&el.closest('[data-hero],.hero-number,.hero-num,[data-type=hero]'))role='secondary';
  else if(['title','section','card','body','secondary','stat','hero','glyph'].includes(explicit))role=explicit;
  else if(el.matches('.me-card-avatar > span.av[aria-hidden=true],.person-link > span.av[aria-hidden=true],.pym-who > span.av[aria-hidden=true]'))role='glyph';
  else if(el.matches('.chartbox > svg > text.yl'))role='chart';
  else if(el.closest('nav.tabs'))role='secondary';
  else if(el.matches('button,a.more,[role=button],[role=tab],[role=switch]'))role='body';
  else if(el.matches('small,time,.small,.badge,.bell-dot,.achievement,.me-card-name > span,.me-card-label > span,.me-card-note > span,.me-divider > span,.me-sport-chip,.lift-prev > span,.gps-chip,.detail-date,.zone-name,.chartbox .lbl > span:last-child:not(:first-child),.chartbox .readout > span,.lift-row.lh > span,.lift-pr,.insights-chart-heading > span,.insights-chart-note,.insights-figure > span,.insights-coverage p,.insights-coverage p > b,.insights-coverage p > span,.zone > .num,.library-recipe > span.num,.macro-line > span.num')||el.closest('.readout,.chartbox .lbl > span:last-child:not(:first-child),small,.small,.meta,.card-meta,.stat i,.hero-number i,.hero-num i,.today-macro i,.day-balance-detail i'))role='secondary';
  else if(el.matches('.chartbox .lbl > span:first-child'))role='card';
  else if(el.matches('.count'))role='body';
  else if(el.closest('button,[role=button],[role=tab],[role=switch]'))role='body';
  else if(el.closest('h1'))role='title';
  else if(el.matches('#fd-meals .meal > h2 > span:first-child'))role='card';
  else if(el.closest('h2'))role=el.closest('.card')?'card':'section';
  else if(el.matches('.pt-w > b'))role='card';
  else if(el.matches('.me-form .status-word'))role='section';
  else if(el.closest('h3,h4'))role=el.closest('.card')?'card':'section';
  const numeric=/\d/.test(content)&&!/[a-z]{3}/i.test(content)&&!!el.closest('b,strong,.num,[data-hero],.hero-number,.hero-num,[data-type=hero]');
  if(numeric&&!explicit&&role!=='secondary'&&el.matches('.stat > b,.hero-num,.insights-figure > b,.me-form-nums b,.me-insight-top > b,.today-macro > b,.pred > div > b'))role='stat';
  const group=el.closest('.card,.me-card,.recap-sheet,.sheet,[data-stat-card]'),heroNode=el.closest('[data-hero],.hero-number,.hero-num,[data-type=hero]'),hero=numeric&&role!=='secondary'&&!!heroNode;
  let clipped=null;
  if((el.scrollWidth>el.clientWidth+1&&el.clientWidth>0)&&(/hidden|clip/.test(s.overflowX)||s.textOverflow==='ellipsis'||input))clipped='scrollWidth exceeds clientWidth';
  if(el.scrollHeight>el.clientHeight+1&&el.clientHeight>0&&/hidden|clip/.test(s.overflowY))clipped='scrollHeight exceeds clientHeight';
  if(!input){for(const text of direct){const range=document.createRange();range.selectNodeContents(text);for(const r of range.getClientRects()){let left=r.left,right=r.right,top=r.top,bottom=r.bottom;for(let p=el;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip/.test(c.overflowX)&&(left<b.left-1||right>b.right+1))clipped='Text extends through '+selector(p);if(/hidden|clip/.test(c.overflowY)&&(top<b.top-1||bottom>b.bottom+1))clipped='Text extends through '+selector(p);if(/auto|scroll/.test(c.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/auto|scroll/.test(c.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}}}}
  texts.push({key,selector:key,rect:rect(el),font,role,numeric,hero,heroKey:hero?selector(heroNode):null,group:group?selector(group):null,groupExceptions:group?exceptions(group):[],exceptions:exceptions(el),clipped,text:content.slice(0,90)});
 }
 return {screen,rootFont,viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,targets,texts,containers,exceptions:exceptions(document.documentElement)};
}
module.exports={collectSpacing};
