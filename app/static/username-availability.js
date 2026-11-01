/* Check a matching copy after typing; keep the actual input and its draft intact. */
globalThis.UsernameAvailability = (() => {
  let serial = 0;
  function watch(input) {
    const owner = readOwner(), status = document.createElement('p');
    status.className = 'small username-status'; status.id = 'username-status-' + (++serial);
    status.setAttribute('aria-live', 'polite'); status.setAttribute('role', 'status');
    input.closest('label').after(status);
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'),status.id].filter(Boolean).join(' '));
    let generation = 0, timer = null, request = null;
    const live = revision => revision === generation && input.isConnected && status.isConnected && owner === readOwner();
    function changed() {
      const revision = ++generation, value = input.value.trim();
      clearTimeout(timer); request?.abort(); status.textContent = ''; status.classList.remove('ok');
      if (!value) return;
      timer = setTimeout(async () => {
        if (!live(revision)) return;
        request = new AbortController();
        try {
          const answer = await api('/api/account/username-availability?login=' + encodeURIComponent(value), {signal:request.signal});
          if (!live(revision)) return;
          status.textContent = answer.available ? '✓ Available as @' + answer.login : answer.reason === 'taken' ? 'Taken. Try @' + answer.suggestion + '.' : answer.message;
          status.classList.toggle('ok', answer.available);
        } catch (error) { if (live(revision)) status.textContent = error.message; }
      }, 400);
    }
    input.addEventListener('input',changed);
    viewResources.set(status,()=>{generation++;clearTimeout(timer);request?.abort();input.removeEventListener('input',changed);});
    return {changed, error: message => {generation++;clearTimeout(timer);request?.abort();status.textContent=message;status.classList.remove('ok');}};
  }
  return {watch};
})();
