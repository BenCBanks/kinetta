// Keep the route-shaped loading shell visible while the first screen reads settle.
// Screen payload caching remains in app.js, where requests are scoped to its owner session.
(() => {
  const pending = new WeakMap();
  let generation = 0;
  const owner = () => JSON.stringify([Native.base || location.origin, App.me?.id ?? null]);

  const shell = kind => kind === 'progress'
    ? `<div class="paint-gate-placeholder paint-gate-progress" aria-hidden="true">
        <div class="paint-gate-heading"><i></i><span><i></i><i></i></span></div>
        <div class="paint-gate-summary"><i></i><i></i></div>
        <div class="paint-gate-chart"><div><i></i><i></i><i></i></div><div class="paint-gate-bars">${[1,2,3,4,5,6,7,8].map(n=>`<i class="bar-${n}"></i>`).join('')}</div></div>
        <div class="paint-gate-rows">${[1,2,3,4,5].map(()=>'<i></i>').join('')}</div>
      </div>`
    : `<div class="paint-gate-placeholder paint-gate-home" aria-hidden="true">
        <div class="paint-gate-heading"><i></i><span><i></i><i></i></span></div>
        <div class="paint-gate-switch"><i></i><i></i></div>
        <div class="paint-gate-feed-card"><i></i><i></i><i></i><span><i></i><i></i><i></i></span></div>
        <div class="paint-gate-feed-card"><i></i><i></i><span><i></i><i></i><i></i></span></div>
      </div>`;

  function begin(el, kind, {cached=false}={}) {
    if (!el || typeof readOwner !== 'function' || !App.me) return {finish: promise => promise};
    if(cached)return {finish:()=>Promise.resolve()};
    const id = ++generation, account = owner(), placeholder = document.createElement('div');
    placeholder.innerHTML = shell(kind);
    const node = placeholder.firstElementChild;
    el.dataset.paintGate = String(id);
    el.setAttribute('aria-busy', 'true');
    el.append(node);
    let reveal;
    const timeout = new Promise(resolve => { reveal = resolve; });
    const startedAt=performance.now(), state = {id, account, node, done: false, timer: null, reveal};
    pending.set(el, state);
    const show = () => {
      if (state.done) return;
      state.done = true;
      clearTimeout(state.timer);
      if (pending.get(el) !== state || !el.isConnected || owner() !== account) return;
      delete el.dataset.paintGate;
      el.removeAttribute('aria-busy');
      node.remove();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(el.isConnected&&owner()===account)el.dispatchEvent(new CustomEvent('kinetta:screen-painted', {bubbles:true,detail:{screen:kind, waitedMs:Math.round(performance.now()-startedAt)}}));
      }));
    };
    state.timer = setTimeout(() => { show(); reveal(); }, 1500);
    return {
      finish(promise) {
        const work = Promise.resolve(promise);
        return Promise.race([work, timeout]).finally(() => { show(); reveal(); });
      }
    };
  }

  globalThis.PaintGate = {begin};
})();
