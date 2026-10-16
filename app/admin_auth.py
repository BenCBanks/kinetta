"""Separate, short-lived administrator sessions. Ordinary app tokens never elevate."""
import base64, hashlib, hmac, os, secrets, struct, time
from urllib.parse import urlsplit
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, ConfigDict
from . import auth, db

router = APIRouter(prefix='/api/admin')
COOKIE = 'kinetta_admin'
PENDING = 'kinetta_admin_pending'
LIFETIME = 1800


def cipher():
    try: return Fernet(db.secret('KINETTA_ADMIN_KEY').encode())
    except (ValueError, TypeError): raise HTTPException(503, 'Admin setup required: configure KINETTA_ADMIN_KEY on the server.')


def seal(value): return cipher().encrypt(value.encode()).decode()
def unseal(value):
    try: return cipher().decrypt(value.encode()).decode()
    except InvalidToken: raise HTTPException(503, 'Admin encryption key does not match. Use the documented server recovery procedure.')


def attempt(request, name, limit):
    # Durable across workers/restarts; store only a keyed hash of the visitor/group.
    digest=hmac.new(db.secret('KINETTA_ADMIN_KEY').encode(),(auth.client_ip(request)+':'+name).encode(),hashlib.sha256).hexdigest()
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('admin-attempt:'+digest,))
        c.execute("DELETE FROM admin_attempts WHERE created<now()-interval '15 minutes'")
        count=c.execute('SELECT count(*) AS n FROM admin_attempts WHERE key=%s',(digest,)).fetchone()['n']
        if count>=limit:raise HTTPException(429,'Too many attempts. Try again in 15 minutes.')
        c.execute('INSERT INTO admin_attempts (key) VALUES (%s)',(digest,))


def audit(c, uid, action, target=None):
    c.execute('INSERT INTO admin_audit (actor_id, action, target) VALUES (%s,%s,%s)', (uid, action, str(target)[:120] if target is not None else None))


def origin(request):
    value = request.headers.get('origin')
    expected = str(request.base_url).rstrip('/')
    if value and value != expected: raise HTTPException(403, 'Use this site’s admin portal.')
    if request.method not in ('GET','HEAD') and value != expected: raise HTTPException(403, 'Same-origin admin request required.')


def csrf(token): return hmac.new(db.secret('KINETTA_ADMIN_KEY').encode(), ('csrf:'+token).encode(), hashlib.sha256).hexdigest()


def cookie(response, name, token, request, seconds):
    response.set_cookie(name, token, httponly=True, secure=request.url.scheme == 'https', samesite='strict', path='/api', max_age=seconds)


def issue_session(c, uid):
    token = secrets.token_urlsafe(32)
    c.execute("INSERT INTO admin_sessions (token_hash,user_id,expires) VALUES (%s,%s,now()+interval '30 minutes')", (auth.token_hash(token),uid))
    return token


def admin_user(request: Request):
    origin(request)
    token = request.cookies.get(COOKIE,'')
    with db.connect() as c:
        u = c.execute('''SELECT u.id,u.login::text AS login,u.name,u.is_admin FROM admin_sessions s JOIN users u ON u.id=s.user_id
                         WHERE s.token_hash=%s AND s.expires>now() AND u.is_admin''', (auth.token_hash(token),)).fetchone()
    if not u:
        try: auth.current_user(request)
        except HTTPException: raise HTTPException(401, 'Sign in to the admin portal.')
        raise HTTPException(403, 'Separate admin sign-in required.')
    if request.method not in ('GET','HEAD') and not hmac.compare_digest(request.headers.get('x-admin-csrf',''),csrf(token)):
        raise HTTPException(403,'Refresh the admin portal before trying again.')
    return {**u,'_portal':True}


def totp(secret, counter):
    key = base64.b32decode(secret+'='*((-len(secret))%8))
    value = hmac.new(key,struct.pack('>Q',counter),hashlib.sha1).digest(); offset=value[-1]&15
    return f'{(struct.unpack(">I",value[offset:offset+4])[0]&0x7fffffff)%1000000:06}'


class Credentials(BaseModel):
    model_config=ConfigDict(extra='forbid')
    login: str=Field(min_length=1,max_length=60)
    password: str=Field(min_length=1,max_length=200)


@router.post('/login')
def login(body: Credentials, request: Request, response: Response):
    origin(request); cipher(); attempt(request,"password",12)
    key='admin:'+body.login.strip().lower(); ip=auth.client_ip(request)
    if auth.too_many(ip,key): raise HTTPException(429,'Too many attempts. Try again in 15 minutes.')
    with db.connect() as c:
        u=c.execute('SELECT id,is_admin,pw_hash FROM users WHERE login=%s',(body.login.strip(),)).fetchone()
        if not auth.check_pw(u['pw_hash'] if u else None,body.password) or not u or not u['is_admin']:
            auth.failed(ip,key); raise HTTPException(401,'Admin sign-in failed.')
        m=c.execute('SELECT 1 FROM admin_mfa WHERE user_id=%s',(u['id'],)).fetchone()
        seed=base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=') if not m else None
        token=secrets.token_urlsafe(32)
        c.execute('DELETE FROM admin_challenges WHERE expires<now() OR user_id=%s',(u['id'],))
        c.execute("INSERT INTO admin_challenges (token_hash,user_id,seed,expires) VALUES (%s,%s,%s,now()+interval '5 minutes')",(auth.token_hash(token),u['id'],seal(seed) if seed else None))
    cookie(response,PENDING,token,request,300)
    response.headers['Cache-Control']='no-store'
    return {'enrollment':bool(seed),'setup_key':seed}


class Verify(BaseModel):
    model_config=ConfigDict(extra='forbid')
    code: str=Field(min_length=6,max_length=80)


@router.post('/verify')
def verify(body: Verify, request: Request, response: Response):
    origin(request); cipher(); attempt(request,'mfa',12); ip=auth.client_ip(request)
    if auth.too_many(ip,'admin-mfa'): raise HTTPException(429,'Too many attempts. Try again in 15 minutes.')
    # Count every attempt before the transaction so failed codes cannot roll back their rate limit.
    auth.failed(ip,'admin-mfa')
    recovery=None
    with db.connect() as c:
        row=c.execute('''SELECT q.*,u.is_admin FROM admin_challenges q JOIN users u ON u.id=q.user_id
                         WHERE q.token_hash=%s AND q.expires>now() FOR UPDATE OF q,u''',(auth.token_hash(request.cookies.get(PENDING,'')),)).fetchone()
        if not row or not row['is_admin']: raise HTTPException(401,'Sign in again.')
        m=c.execute('SELECT * FROM admin_mfa WHERE user_id=%s FOR UPDATE',(row['user_id'],)).fetchone()
        seed=unseal(row['seed'] if row['seed'] else m['secret']) if row['seed'] or m else None
        counter=int(time.time()//30)
        matched=next((i for i in (counter-1,counter,counter+1) if seed and hmac.compare_digest(totp(seed,i),body.code)),None)
        valid=matched is not None and (not m or matched>m['last_counter'])
        if not valid and m and not row['seed']:
            used=c.execute('DELETE FROM admin_recovery WHERE user_id=%s AND code_hash=%s RETURNING user_id',(row['user_id'],auth.token_hash(body.code))).fetchone()
            valid=bool(used)
        if not valid: raise HTTPException(401,'Code not accepted. Try a fresh authenticator code or unused recovery code.')
        if row['seed']:
            if m: raise HTTPException(409,'MFA is already configured. Sign in again.')
            c.execute('INSERT INTO admin_mfa (user_id,secret,last_counter) VALUES (%s,%s,%s)',(row['user_id'],row['seed'],matched))
            recovery=[secrets.token_hex(12) for _ in range(10)]
            for code in recovery:c.execute('INSERT INTO admin_recovery (user_id,code_hash) VALUES (%s,%s)',(row['user_id'],auth.token_hash(code)))
            audit(c,row['user_id'],'mfa.enroll')
        elif matched is not None:c.execute('UPDATE admin_mfa SET last_counter=%s WHERE user_id=%s',(matched,row['user_id']))
        c.execute('DELETE FROM admin_challenges WHERE user_id=%s',(row['user_id'],))
        token=issue_session(c,row['user_id']);audit(c,row['user_id'],'session.login')
    cookie(response,COOKIE,token,request,LIFETIME);response.delete_cookie(PENDING,path='/api')
    return {'ok':True,'recovery_codes':recovery}


@router.get('/me')
def me(request: Request,user=Depends(admin_user)):
    return {'login':user['login'],'name':user['name'],'csrf':csrf(request.cookies[COOKIE]),'session_minutes':30}


@router.post('/logout')
def logout(request: Request,response: Response,user=Depends(admin_user)):
    with db.connect() as c:
        c.execute('DELETE FROM admin_sessions WHERE token_hash=%s',(auth.token_hash(request.cookies.get(COOKIE,'')),));audit(c,user['id'],'session.logout')
    response.delete_cookie(COOKIE,path='/api');return {'ok':True}
