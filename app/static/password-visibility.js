// Shared app/admin password control. Keep the original input and its autofill identity.
// Only visibility and selection are handled here; password values never enter helper state.
'use strict';
(() => {
  const controls=new WeakMap(),inputs=new Set();
  const paths={eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':'<path d="m3 3 18 18M10.6 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.1 3.8M6.2 6.2A22 22 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'};
  if(typeof IC!=='undefined')for(const [name,path] of Object.entries(paths))IC[name]??=path;
  const icon=name=>typeof svg==='function'?svg(name):`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  const selection=input=>[input.selectionStart,input.selectionEnd,input.selectionDirection];
  function restore(input,range) {
    if(range[0]!==null)try{input.setSelectionRange(...range);}catch{/* Older web views retain their own caret. */}
  }
  function visibility(input,shown,focus=false) {
    const button=controls.get(input);if(!button)return;
    const range=selection(input);input.type=shown?'text':'password';
    button.setAttribute('aria-label',shown?'Hide password':'Show password');
    button.setAttribute('aria-pressed',String(shown));button.title=shown?'Hide password':'Show password';
    button.innerHTML=icon(shown?'eye-off':'eye');
    if(focus&&input.isConnected){input.focus({preventScroll:true});restore(input,range);
    }else if(document.activeElement===input)restore(input,range);
  }
  function enhance(input) {
    if(controls.has(input)){inputs.add(input);return;}
    const focused=document.activeElement===input,range=selection(input);
    const wrapper=document.createElement('span');wrapper.className='password-field';
    const button=document.createElement('button');button.type='button';button.className='password-visibility-button';
    input.classList.add('password-input');input.setAttribute('autocapitalize','off');
    input.setAttribute('autocorrect','off');input.setAttribute('spellcheck','false');
    input.before(wrapper);wrapper.append(input,button);controls.set(input,button);inputs.add(input);
    button.disabled=input.disabled;visibility(input,false);
    if(focused&&input.isConnected){input.focus({preventScroll:true});restore(input,range);}
    button.addEventListener('pointerdown',event=>{if(event.isPrimary!==false&&event.button===0)event.preventDefault();});
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();
      if(input.isConnected&&!input.disabled)visibility(input,input.type==='password',true);
    });
  }
  function scan(node) {
    if(node.nodeType!==1&&node.nodeType!==9)return;
    if(node.matches?.('input[type="password"]'))enhance(node);
    for(const input of node.querySelectorAll('input[type="password"]'))enhance(input);
  }
  function hideIn(node) {
    for(const input of inputs)if(input===node||node.contains?.(input))visibility(input,false);
  }
  document.addEventListener('submit',event=>{
    for(const input of inputs)if(input.form===event.target)visibility(input,false);
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hideIn(document);});
  addEventListener('pagehide',()=>hideIn(document));
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='childList'){
        for(const node of record.removedNodes)hideIn(node);
        for(const node of record.addedNodes)scan(node);
      }else{
        const node=record.target;
        if(record.attributeName==='disabled'&&controls.has(node))controls.get(node).disabled=node.disabled;
        if(node.hidden||node.inert||node.getAttribute('aria-hidden')==='true'||node.tagName==='DIALOG'&&!node.open)hideIn(node);
      }
    }
    for(const input of inputs)if(!input.isConnected)inputs.delete(input);
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-hidden','hidden','inert','open','disabled']});
  scan(document);
})();
