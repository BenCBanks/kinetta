// Local pre-save pixels and the exact confirmed request stay separate from frequent GPS checkpoints.
// Keys contain server/account/recording identity, never login tokens. A transaction must commit before UI success.
'use strict';
const TrackReviewStore = (() => {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const r = indexedDB.open('kinetta-track-review', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts', {keyPath:'key'}).createIndex('owner','owner');
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); opening = null; }; resolve(r.result); };
      r.onerror = () => { opening = null; reject(Error('Photo storage unavailable. Try again on this device.')); };
      r.onblocked = () => { opening = null; reject(Error('Close other Kinetta windows and try again.')); };
    });
    return opening;
  }
  async function transaction(action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('drafts', 'readwrite'); let value;
      t.oncomplete = () => resolve(value);
      t.onabort = t.onerror = () => reject(Error('Could not save this review on your device. Free some storage and retry.'));
      try { action(t.objectStore('drafts'), v => { value = v; }); } catch (_) { t.abort(); }
    });
  }
  const identity = (owner,id) => JSON.stringify([owner,id]);
  const change = (owner,id,fn) => transaction((s,done) => {
    const key=identity(owner,id),r=s.get(key);
    r.onsuccess=()=>{try { const next=fn(r.result || {owner,id,key,photos:[]});s.put(next);done(next); } catch (_) { r.transaction.abort(); }};
  });
  return {
    read:(owner,id)=>transaction((s,done)=>{const r=s.get(identity(owner,id));r.onsuccess=()=>done(r.result || {photos:[]});}),
    pending:owner=>transaction((s,done)=>{const r=s.index('owner').getAll(owner);r.onsuccess=()=>done(r.result.find(d=>d.request) || null);}),
    photos:(owner,id,photos)=>change(owner,id,d=>{if(d.request)throw Error('Save is not confirmed. Retry it first.');return {...d,photos};}),
    confirm:(owner,id,request,recording={})=>change(owner,id,d=>d.request?d:{...d,recording,photos:request.photos,request}),
    reopen:(owner,id)=>change(owner,id,d=>{const {request,...rest}=d;return rest;}),
    remove:(owner,id)=>transaction(s=>s.delete(identity(owner,id))),
    erase:owner=>transaction(s=>{const r=s.index('owner').openCursor(IDBKeyRange.only(owner));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue();}};})
  };
})();

const TrackReviewMath = {
  samples(session, math) {
    const points=session.points || [],stride=Math.max(1,Math.ceil(points.length/400)),out={t:[],speed:[],alt:[]};
    let anchor=null,lastSegment=null,distance=0,window=[],gap=false,speed=null;
    for(let i=0;i<points.length;i++) {
      const p=points[i];
      if(lastSegment!==null && p.segment!==lastSegment){anchor=null;window=[];gap=true;}
      lastSegment=p.segment;
      const step=math.step(anchor,p),seconds=Number.isFinite(p.active)?p.active:p.t;
      speed=null;
      if(step!==null) {
        distance+=step;anchor=p;
        window.push({seconds,distance});while(window.length>1 && seconds-window[0].seconds>30)window.shift();
        const first=window[0],dt=seconds-first.seconds,dm=distance-first.distance;
        if(dt>=5 && dm>=10)speed=dm/dt;
      } else if(p.accuracy>25)window=[];
      if(i%stride===0 || i===points.length-1) {
        out.t.push(p.t);out.speed.push(gap?null:speed);
        out.alt.push(!gap && Number.isFinite(p.alt) && p.valt>0 && p.valt<=15 ? p.alt:null);
        gap=false;
      }
    }
    return out;
  }
};
