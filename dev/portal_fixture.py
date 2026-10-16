"""MFA/session fixture for isolated localhost demo installations only. Never production bypass code."""
import base64, hashlib, hmac, http.cookiejar, json, os, pathlib, struct, tempfile, time, urllib.parse, urllib.request, urllib.error


def admin_headers(base):
    url=urllib.parse.urlsplit(base)
    if url.hostname not in ('localhost','127.0.0.1') or not url.port or url.port<8798:
        raise RuntimeError('Admin demo fixture requires an isolated loopback test port >=8798')
    path=pathlib.Path(tempfile.gettempdir())/('kinetta-admin-demo-'+hashlib.sha256(base.encode()).hexdigest()[:16]+'.json')
    state={}
    try:state=json.loads(path.read_text())
    except (OSError,ValueError):pass
    def req(route,body=None,token=None):
        headers={'Origin':base,'Content-Type':'application/json'}
        if token:headers['Cookie']='kinetta_admin='+token
        r=urllib.request.Request(base+'/api/admin'+route,headers=headers,data=json.dumps(body).encode() if body is not None else None)
        with op.open(r) as response:return json.loads(response.read()),response
    jar=http.cookiejar.CookieJar();op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    if state.get('token'):
        try:
            r,_=req('/me',token=state['token']);return {'Cookie':'kinetta_admin='+state['token'],'X-Admin-CSRF':r['csrf']}
        except urllib.error.HTTPError:pass
    r,_=req('/login',{'login':'alex','password':'blue kettle morning run'})
    if r['enrollment']:
        seed=base64.b32decode(r['setup_key']);counter=int(time.time()//30);d=hmac.new(seed,struct.pack('>Q',counter),hashlib.sha1).digest();o=d[-1]&15;code=f'{(struct.unpack(">I",d[o:o+4])[0]&0x7fffffff)%1000000:06}'
    else:
        codes=state.get('codes',[])
        if not codes:raise RuntimeError('Recreate the isolated demo server: test MFA recovery codes exhausted.')
        code=codes.pop(0);state['codes']=codes
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f:json.dump(state,f)
    r,_=req('/verify',{'code':code})
    token=next(c.value for c in jar if c.name=='kinetta_admin')
    state={'token':token,'codes':r.get('recovery_codes') or state.get('codes',[])}
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(state,f)
    r,_=req('/me',token=token)
    return {'Cookie':'kinetta_admin='+token,'X-Admin-CSRF':r['csrf']}


def is_admin_path(path):
    import re
    return bool(re.match(r'^/api/admin/(people(?:$|/[^/?]+/(?:password|remove)$)|invites(?:/|$)|beta-requests(?:/|$)|reports(?:/|$))',path))
