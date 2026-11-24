// Small state additions for the shared Comments sheet. Kept outside social.js so
// each Comments PR can land without sharing its code diff with the footer work.
(() => {
  'use strict';
  const SHEET = '.social-sheet';
  function apply(root) {
    const boxes = root.matches?.(SHEET) ? [root] : [...(root.querySelectorAll?.(SHEET) || [])];
    for (const box of boxes) {
      const list = box.querySelector('.comments');
      const status = box.querySelector('.social-read-status');
      if (!list || !status) continue;

      const busy = list.getAttribute('aria-busy') === 'true';
      const skeleton = list.querySelector('.comments-skeleton');
      if (busy && skeleton) {
        const rows = skeleton.querySelectorAll('.comment-skeleton-row');
        while (skeleton.querySelectorAll('.comment-skeleton-row').length < 3) {
          const row = skeleton.querySelector('.comment-skeleton-row');
          if (!row) break;
          skeleton.append(row.cloneNode(true));
        }
        while (skeleton.querySelectorAll('.comment-skeleton-row').length > 3) skeleton.lastElementChild.remove();
      }

      const retry = status.querySelector('[data-retry]');
      if (retry) {
        const first = status.firstChild;
        if (!status.dataset.commentsLoadError || first?.nodeType !== Node.TEXT_NODE || first.textContent.trim() !== "Couldn't load comments") {
          status.replaceChildren(document.createTextNode("Couldn't load comments "), retry);
          status.dataset.commentsLoadError = '1';
        }
      } else delete status.dataset.commentsLoadError;

      let empty = box.querySelector('.comments-empty-state-message');
      const hasComments = !!list.querySelector('.comment[data-comment-id]');
      const hasCommentError = !!status.querySelector('.comment-retry');
      const showEmpty = !busy && !retry && !hasCommentError && !box._denied && !hasComments;
      if (showEmpty) {
        if (!empty) {
          empty = document.createElement('p');
          empty.className = 'comments-empty-state-message';
          empty.setAttribute('role', 'status');
          empty.textContent = 'No comments yet';
          list.after(empty);
        }
        empty.hidden = false;
        box.classList.add('comments-empty-state');
        const quick = box.querySelector('.c-quick');
        const draftEmpty = !box.querySelector('.c-form textarea')?.value.trim();
        if (quick && draftEmpty) quick.hidden = false;
      } else {
        empty?.remove();
        box.classList.remove('comments-empty-state');
      }

      if (!busy && !retry && !box._denied && !box.dataset.openedAtNewest) {
        if (hasComments) list.scrollTop = list.scrollHeight;
        box.dataset.openedAtNewest = '1';
      }
    }
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (target) apply(target.closest?.(SHEET) || target);
      for (const node of record.addedNodes || []) if (node.nodeType === Node.ELEMENT_NODE) apply(node);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'], characterData: true });
  apply(document);
})();
