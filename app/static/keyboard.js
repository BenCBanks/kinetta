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
    // Capacitor forwards these events to window. Hide before the WebView shrinks,
    // and keep tabs hidden throughout interactive dismissal and field changes.
    addEventListener('keyboardWillShow', () => setOpen(true));
    addEventListener('keyboardDidShow', () => { setOpen(true); fitChat(); requestAnimationFrame(keepVisible); });
    addEventListener('keyboardDidHide', () => { setOpen(false); fitChat(); });
    // No accessory strip: the focused field uses the full visible WebView.
    const keepVisible = () => { const el = document.activeElement; if (!el || el === document.body) return;
      const r = el.getBoundingClientRect(); if (r.bottom > innerHeight - 8) el.scrollIntoView({block: 'nearest'}); };
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
