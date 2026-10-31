// Fictional read-only people for isolated native layout evidence.
'use strict';
module.exports=(state='empty')=>{
 const person=(kind,i)=>({login:`zz_test_native_${kind}${i}`,name:`Fictional ${kind} ${i+1}`,photo:null});
 return {
  friends:Array.from({length:state==='heavy'?40:state==='typical'?1:0},(_,i)=>person('Friend',i)),
  incoming:Array.from({length:state==='heavy'?3:state==='typical'?1:0},(_,i)=>({...person('Request',i),via_card:i===0})),
  outgoing:state==='empty'?[]:Array.from({length:2},(_,i)=>person('Sent',i)),
  suggested:Array.from({length:3},(_,i)=>({...person('Suggestion',i),why:'A mutual friend'}))
 };
};
