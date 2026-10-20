// One keyboard state for every screen, sheet and newly rendered navigation bar.
'use strict';
(() => {
  // Both food conversations fit the visible viewport, rather than a document that
  // iOS can pan sideways or leave underneath the keyboard. Preserve pinch zoom.
  const viewport = window.visualViewport;
  const fitChat = () => {
    if (viewport && Math.abs(viewport.scale - 1) > .05) return;
    const style = document.documentElement.style;
    style.setProperty('--chat-height', `${viewport?.height ?? innerHeight}px`);
    style.setProperty('--chat-top', `${viewport?.offsetTop ?? 0}px`);
  };
  viewport?.addEventListener('resize', fitChat);
  viewport?.addEventListener('scroll', fitChat);
  addEventListener('resize', fitChat);
  fitChat();
  const native = !!window.Capacitor?.isNativePlatform?.();
  const setOpen = (open) => document.documentElement.classList.toggle('keyboard-open', open);
  if (native) {
    // The WebView keeps its full size (Keyboard resize "none", capacitor.config.json). When iOS announces the
    // keyboard we shrink the chat by its height with the same timing, so the text box rides up together with
    // the keyboard instead of jumping after it lands (owner, 19 Oct 2026).
    const root = document.documentElement.style;
    let keyboard = 0;
    // Share the keyboard height: sheets and ordinary pages lift by it too, since the WebView no longer shrinks.
    window.KinettaKeyboard = {height: 0};
    const fitNative = () => { root.setProperty('--chat-height', `${innerHeight - keyboard}px`); root.setProperty('--chat-top', '0px');
      root.setProperty('--kb', `${keyboard}px`); window.KinettaKeyboard.height = keyboard;
      try { dispatchEvent(new CustomEvent('kinetta:keyboard', {detail: {height: keyboard}})); } catch (e) {} };
    viewport?.removeEventListener?.('resize', fitChat); viewport?.removeEventListener?.('scroll', fitChat); window.removeEventListener?.('resize', fitChat);
    addEventListener('resize', fitNative);
    // iOS may still pan the page toward a focused field under the keyboard; the chat is fixed, so undo that pan.
    viewport?.addEventListener('scroll', () => { if (keyboard && scrollY && document.querySelector('.shell.food-thread, .shell.recipe-page')) scrollTo(0, 0); });
    addEventListener('keyboardWillShow', (e) => { keyboard = Number(e?.keyboardHeight) || 0; setOpen(true);
      document.documentElement.classList.toggle('keyboard-moving', true); fitNative(); requestAnimationFrame(keepVisible); });
    addEventListener('keyboardDidShow', (e) => { keyboard = Number(e?.keyboardHeight) || keyboard; setOpen(true); fitNative(); requestAnimationFrame(keepVisible);
      document.documentElement.classList.toggle('keyboard-moving', false); });
    addEventListener('keyboardWillHide', () => { keyboard = 0; document.documentElement.classList.toggle('keyboard-moving', true); fitNative(); });
    addEventListener('keyboardDidHide', () => { keyboard = 0; setOpen(false); fitNative(); document.documentElement.classList.toggle('keyboard-moving', false); });
    fitNative();
    // No accessory strip: the focused field uses the full visible WebView.
    const keepVisible = () => { const el = document.activeElement; if (!el || el === document.body) return;
      const r = el.getBoundingClientRect(); if (r.bottom > innerHeight - keyboard - 8) el.scrollIntoView({block: 'nearest'}); };
    return;
  }
  const vv = window.visualViewport;
  if (!vv) return;
  let fullHeight = innerHeight, open = false;
  const editable = () => {
    const el = document.activeElement;
    return el && !el.disabled && !el.readOnly && el.inputMode !== 'none' &&
      (el.isContentEditable || el.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="hidden"])'));
  };
  const update = () => {
    // Focus alone isn't a software keyboard (desktop/external keyboards).
    // Ignore pinch zoom and browser chrome changes; retain state until the viewport
    // recovers even when blur precedes the keyboard's closing animation.
    if (!matchMedia('(pointer: coarse)').matches) { setOpen(false); return; }
    if (Math.abs(vv.scale - 1) > .05) return;
    fullHeight = Math.max(fullHeight, innerHeight);
    const covered = fullHeight - vv.height - vv.offsetTop > 120;
    open = covered && (open || !!editable());
    setOpen(open);
    if (!open && !editable()) fullHeight = innerHeight;
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  addEventListener('resize', update);
  addEventListener('orientationchange', () => { fullHeight = innerHeight; update(); });
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => requestAnimationFrame(update));
  update();
})();
