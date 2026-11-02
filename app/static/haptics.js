// Reaction feedback uses the existing UIKit bridge. UIKit honors the system haptics setting.
'use strict';
globalThis.Haptics = (() => {
  async function emit(kind) {
    try {
      const capacitor = globalThis.Capacitor;
      if (!capacitor?.isNativePlatform?.() || capacitor.getPlatform?.() !== 'ios') return;
      if (capacitor.isPluginAvailable && !capacitor.isPluginAvailable('KinettaHaptics')) return;
      const plugin = capacitor.Plugins?.KinettaHaptics;
      if (typeof plugin?.tap === 'function') await plugin.tap({kind});
    } catch (_) { /* Feedback must never interrupt the action or fall back to browser vibration. */ }
  }
  return Object.freeze({react: () => emit('light'), tick: () => emit('selection')});
})();
