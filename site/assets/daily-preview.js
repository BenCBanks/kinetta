// Refresh real screenshots without replacing a usable picture with a failed download.
(() => {
  let version, busy=false, retry=false;
  const handlers=new WeakMap();
  function ready(url){
    return new Promise(resolve=>{
      const image=new Image();let finished=false;
      const done=ok=>{if(finished)return;finished=true;clearTimeout(timer);resolve(ok);};
      const timer=setTimeout(()=>done(false),5000);
      image.onload=()=>done(true);image.onerror=()=>done(false);image.src=url;
    });
  }
  async function refresh() {
    if(busy)return;busy=true;
    try {
      const url=new URL('assets/shots/manifest.json',document.baseURI);
      const response=await fetch(url,{cache:'no-store'});
      if(!response.ok)return;
      const manifest=await response.json(),next=manifest.generated_at;
      if(!next||next===version&&!retry)return;
      retry=false;let failed=false;
      const stamped=value=>{const image=new URL(value,document.baseURI);image.searchParams.set('capture',next);return image.href;};
      await Promise.all([...document.querySelectorAll('img[src*="assets/shots/"]')].map(async img=>{
        // Fetch only the displayed theme/density; other candidates stay lazy.
        if(!await ready(stamped(img.currentSrc||img.src))){failed=true;return;}
        const elements=[...(img.closest('picture')?.querySelectorAll('source[srcset*="assets/shots/"]')||[]),img];
        const previous=elements.map(el=>[el,...['src','srcset'].filter(attr=>el.hasAttribute(attr)).map(attr=>[attr,el.getAttribute(attr)])]);
        if(handlers.has(img))img.removeEventListener('error',handlers.get(img));
        const restore=()=>{
          img.removeEventListener('error',restore);handlers.delete(img);retry=true;
          for(const [el,...attrs] of previous)for(const [attr,value] of attrs)el.setAttribute(attr,value);
        };
        handlers.set(img,restore);img.addEventListener('error',restore,{once:true});
        for(const el of elements){
          if(el.hasAttribute('src'))el.setAttribute('src',stamped(el.getAttribute('src')));
          if(el.hasAttribute('srcset'))el.setAttribute('srcset',el.getAttribute('srcset').split(',').map(candidate=>{
            const [url,...descriptor]=candidate.trim().split(/\s+/);return [stamped(url),...descriptor].join(' ');
          }).join(', '));
        }
      }));
      if(failed)retry=true;else version=next;
    } catch (_) { /* Keep the last usable pictures while offline. */ }
    finally{busy=false;}
  }
  refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
