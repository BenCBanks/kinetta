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
    def totp_code(seed,counter):
        digest=hmac.new(seed,struct.pack('>Q',counter),hashlib.sha1).digest();offset=digest[-1]&15
        return f'{(struct.unpack(">I",digest[offset:offset+4])[0]&0x7fffffff)%1000000:06}'
    jar=http.cookiejar.CookieJar();op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    if state.get('token'):
        try:
            r,_=req('/me',token=state['token']);return {'Cookie':'kinetta_admin='+state['token'],'X-Admin-CSRF':r['csrf']}
        except urllib.error.HTTPError:pass
    r,_=req('/login',{'login':'alex','password':'blue kettle morning run'})
    setup_key=None;counter=None
    if r['enrollment']:
        setup_key=r['setup_key'];seed=base64.b32decode(setup_key);counter=int(time.time()//30);code=totp_code(seed,counter)
    elif state.get('totp_seed'):
        seed=base64.b32decode(state['totp_seed']);last_counter=int(state.get('last_counter',-1));counter=int(time.time()//30)
        while counter<=last_counter:
            time.sleep(max(0.05,(last_counter+1)*30-time.time()+0.05));counter=int(time.time()//30)
        code=totp_code(seed,counter)
    else:
        codes=state.get('codes',[])
        if not codes:raise RuntimeError('Recreate the isolated demo server: test MFA recovery codes exhausted.')
        code=codes.pop(0);state['codes']=codes
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f:json.dump(state,f)
    r,_=req('/verify',{'code':code})
    token=next(c.value for c in jar if c.name=='kinetta_admin')
    saved_seed=setup_key or state.get('totp_seed')
    state={'token':token,'codes':state.get('codes',[])}
    if saved_seed:state['totp_seed']=saved_seed
    if counter is not None:state['last_counter']=counter
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(state,f)
    r,_=req('/me',token=token)
    return {'Cookie':'kinetta_admin='+token,'X-Admin-CSRF':r['csrf']}


def is_admin_path(path):
    import re
    return bool(re.match(r'^/api/admin/(people(?:$|/[^/?]+/(?:password|remove)$)|invites(?:/|$)|beta-requests(?:/|$)|reports(?:/|$)|review(?:/|$))',path))
