/* Observes real calls in the disposable Simulator bundle. Never supplies display flags or retries a call. */
'use strict';
(function () {
  function install(cfg, env = globalThis) {
    const now = () => env.performance.now(), started = now(), events = [], pending = new Map(), views = new WeakMap();
    let calls = 0, dropped = 0;
    const at = () => Math.max(0, Math.round(now() - started));
    const record = (event, fields = {}) => {
      if (events.length < 64) events.push({event, at: at(), ...fields}); else dropped++;
    };
    const types = state => ({reduceTransparencyType: typeof state?.reduceTransparency, increaseContrastType: typeof state?.increaseContrast});
    const failure = error => ({
      errorName: ['Error', 'TypeError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error',
      errorCode: ['UNIMPLEMENTED', 'UNAVAILABLE', 'ERROR'].includes(error?.code) ? error.code : 'other',
    });
    const classes = () => {
      const root = env.document?.documentElement;
      return {ready: !!root?.classList.contains('native-display-ready'), transparency: !!root?.classList.contains('native-reduce-transparency'), contrast: !!root?.classList.contains('native-increase-contrast')};
    };
    const presence = () => {
      try {
        const cap = env.Capacitor, plugin = cap?.Plugins?.KinettaDisplayPreferences;
        const header = cap?.PluginHeaders?.find?.(item => item.name === 'KinettaDisplayPreferences');
        return {native: !!cap?.isNativePlatform?.(), registry: !!cap?.Plugins, plugin: !!plugin, method: typeof plugin?.getState === 'function', header: !!header, headerMethod: !!header?.methods?.some(item => item.name === 'getState')};
      } catch { return {presenceError: true}; }
    };
    cfg.displayDiagnostics = () => ({calls, dropped, events: events.map(value => ({...value})), pending: [...pending].map(([call, began]) => ({call, elapsed: at() - began})), presence: presence(), classes: classes()});
    function observe(plugin, name) {
      if (!plugin || !['object', 'function'].includes(typeof plugin)) return plugin;
      let byName = views.get(plugin);
      if (!byName) { byName = new Map(); views.set(plugin, byName); }
      if (byName.has(name)) return byName.get(name);
      const methods = new Map();
      const view = new Proxy(plugin, {get(target, key, receiver) {
        const original = Reflect.get(target, key, receiver);
        const state = name === 'KinettaDisplayPreferences' && key === 'getState';
        const listener = key === 'addListener';
        if (typeof original !== 'function' || (!state && !listener)) return original;
        const old = methods.get(key);
        if (old?.original === original) return old.wrapper;
        const wrapper = function (...args) {
          if (!state) {
            const event = args[0], callback = args[1];
            const observed = name === 'App' && event === 'appStateChange' || name === 'KinettaDisplayPreferences' && event === 'changed';
            if (observed && typeof callback === 'function') {
              record('listener', {source: name, kind: event});
              args[1] = function (...values) {
                try { record('event', name === 'App' ? {source: name, active: values[0]?.isActive === true} : {source: name, ...types(values[0])}); } catch { /* Observation cannot change delivery. */ }
                return callback.apply(this, values);
              };
            }
            return original.apply(target, args);
          }
          const call = ++calls, began = at();
          record('read-start', {call});
          if (pending.size < 64) pending.set(call, began);
          let result;
          try { result = original.apply(target, args); }
          catch (error) { pending.delete(call); try { record('read-throw', {call, ...failure(error)}); } catch { record('read-throw', {call}); } throw error; }
          // Observe settlement separately; preserve the caller's exact return value/promise.
          Promise.resolve(result).then(value => {
            pending.delete(call);
            try { record('read-end', {call, elapsed: at() - began, ...types(value)}); } catch { record('read-end', {call, elapsed: at() - began, invalidFields: true}); }
          }, error => {
            pending.delete(call);
            try { record('read-reject', {call, elapsed: at() - began, ...failure(error)}); } catch { record('read-reject', {call, elapsed: at() - began}); }
          });
          return result;
        };
        methods.set(key, {original, wrapper});
        return wrapper;
      }});
      byName.set(name, view);return view;
    }
    const cap = env.Capacitor;
    if (cap?.Plugins) {
      const registry = cap.Plugins;
      try {
        cap.Plugins = new Proxy(registry, {get(target, key, receiver) {
          const plugin = Reflect.get(target, key, receiver);
          return key === 'KinettaDisplayPreferences' || key === 'App' ? observe(plugin, key) : plugin;
        }});
      } catch { record('registry-unavailable'); }
    }
    record('install', presence());
    let previous = JSON.stringify(classes());
    record('classes', classes());
    if (env.MutationObserver && env.document?.documentElement) {
      new env.MutationObserver(() => {
        const state = classes(), key = JSON.stringify(state);
        if (key !== previous) { previous = key; record('classes', state); }
      }).observe(env.document.documentElement, {attributes: true, attributeFilter: ['class']});
    }
    for (const event of ['pagehide', 'pageshow']) env.addEventListener?.(event, () => record(event));
    env.document?.addEventListener?.('visibilitychange', () => record('visibility', {visible: env.document.visibilityState === 'visible'}));
    return cfg.displayDiagnostics;
  }
  if (typeof module === 'object' && module.exports) module.exports = install;
  else install(globalThis.KinettaUIFixture);
})();
