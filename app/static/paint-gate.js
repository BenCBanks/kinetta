// Keep the route-shaped loading shell visible while the first screen reads settle.
// Screen payload caching remains in app.js, where requests are scoped to its owner session.
(() => {
  const pending = new WeakMap();
  const active = new Set();
  let generation = 0;
  const owner = () => JSON.stringify([Native.base || location.origin, App.me?.id ?? null]);
  const route = () => location.pathname + location.search;

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

  function show(el, state) {
    if (state.done) return;
    state.done = true;
    clearTimeout(state.timer);
    const current = pending.get(el) === state;
    active.delete(state);
    if (current) {
      pending.delete(el);
      delete el.dataset.paintGate;
      el.removeAttribute('aria-busy');
    }
    state.node.remove();
    if (!current || !el.isConnected || owner() !== state.account || route() !== state.route) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (el.isConnected && owner() === state.account && route() === state.route)
        el.dispatchEvent(new CustomEvent('kinetta:screen-painted', {bubbles:true,detail:{screen:state.kind, waitedMs:Math.round(performance.now()-state.startedAt)}}));
    }));
  }
  function clearAll() {
    for (const state of [...active]) show(state.el, state);
  }
  function routeChanged(href=route()) {
    const currentOwner=owner();
    for (const state of [...active]) if (state.route !== href || state.account !== currentOwner) show(state.el, state);
  }
  function begin(el, kind, {cached=false}={}) {
    const passthrough = promise => Promise.resolve(promise).finally(() => {});
    if (!el || typeof readOwner !== 'function' || !App.me) return {finish:passthrough};
    if(cached)return {finish:passthrough};
    const id = ++generation, account = owner(), placeholder = document.createElement('div');
    placeholder.innerHTML = shell(kind);
    const node = placeholder.firstElementChild;
    el.dataset.paintGate = String(id);
    el.setAttribute('aria-busy', 'true');
    el.append(node);
    const state = {id, el, kind, account, route:route(), node, startedAt:performance.now(), done:false, timer:null};
    pending.set(el, state);
    active.add(state);
    state.timer = setTimeout(() => show(el,state), 1500);
    return {
      finish: promise => Promise.resolve(promise).finally(() => show(el,state))
    };
  }

  globalThis.PaintGate = {begin, clearAll, routeChanged};
})();
