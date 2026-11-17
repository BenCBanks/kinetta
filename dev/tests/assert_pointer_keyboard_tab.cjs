'use strict';
const assert=require('node:assert/strict');

module.exports=async function assertPointerKeyboardTab(page,selector,label,{preventAction=false}={}){
 const target=page.locator(selector).first();
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();
 assert(box&&box.width>0&&box.height>=44,`${label} tab is a visible 44px target`);
 const x=box.x+box.width/2,y=box.y+box.height/2;
 if(preventAction)await target.evaluate(node=>{const stop=event=>event.stopImmediatePropagation();node.__focusTestStopClick=stop;node.addEventListener('click',stop,{capture:true,once:true});});
 await page.touchscreen.tap(x,y);
 if(preventAction)await target.evaluate(node=>{if(node.__focusTestStopClick){node.removeEventListener('click',node.__focusTestStopClick,true);delete node.__focusTestStopClick;}}).catch(()=>{});
 const pointer=await target.evaluate(node=>({outline:getComputedStyle(node).outlineStyle,shadow:getComputedStyle(node).boxShadow}));
 assert.equal(pointer.outline,'none',`${label} pointer tap has no focus box`);
 assert.equal(pointer.shadow,'none',`${label} pointer tap has no focus shadow`);
 await target.focus();
 await page.keyboard.press('Tab');
 await page.keyboard.press('Shift+Tab');
 const keyboard=await target.evaluate(node=>({active:node===document.activeElement,visible:node.matches(':focus-visible'),outline:getComputedStyle(node).outlineStyle,width:getComputedStyle(node).outlineWidth}));
 assert.equal(keyboard.active,true,`${label} keyboard navigation returns focus to the tab`);
 assert.equal(keyboard.visible,true,`${label} keyboard focus matches :focus-visible`);
 assert.equal(keyboard.outline,'solid',`${label} keyboard focus shows a ring`);
 assert.equal(keyboard.width,'2px',`${label} keyboard ring is 2px`);
};
