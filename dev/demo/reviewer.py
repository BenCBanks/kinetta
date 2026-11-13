"""Create NEW fictional reviewer/friend accounts through authenticated APIs on an explicitly confirmed server.

No default server, existing-account edits, visibility-rule changes, SQL access, real-person data or model calls.
Passwords and MFA codes are read privately. Use a separate review server; Everyone on a shared server stays visible.
"""
import argparse
import datetime as dt
import getpass
import http.cookiejar
import json
import math
import re
import secrets
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor, HTTPRedirectHandler


class Refused(Exception): pass


def server_origin(value):
    try:
        u=urlsplit(value)
        valid=(u.scheme in ('https','http') and u.hostname and not u.username and not u.password and
               u.path in ('','/') and not u.query and not u.fragment and u.port!=0)
        if not valid or (u.scheme=='http' and u.hostname not in ('localhost','127.0.0.1','::1')):raise ValueError()
        return u.scheme+'://'+u.netloc
    except ValueError:raise Refused('Use an explicit HTTPS server origin, or HTTP loopback for a throwaway test.')


def validate(server,reviewer,confirmation):
    server=server_origin(server)
    if not re.fullmatch(r'(?:review_[a-z0-9_]{1,12}|zz_test_review_[a-z0-9]{1,8})',reviewer):
        raise Refused('Choose a new review_ name (up to12 suffix characters), or zz_test_review_ test name.')
    expected=f'CREATE REVIEW DEMO ON {server} FOR {reviewer}'
    if confirmation!=expected:raise Refused('Confirmation did not match this server and reviewer. No credentials or request were sent.')
    return server,reviewer,reviewer+'_friend'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None


class API:
    def __init__(self,server):
        self.server=server;self.csrf=None
        self.opener=build_opener(NoRedirect(),HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self,method,path,body=None,*,raw=None,content_type='application/json'):
        if not path.startswith('/api/') or path.startswith('//') or '://' in path:
            raise Refused('Unexpected API path.')
        headers={'Origin':self.server,'Content-Type':content_type}
        if self.csrf:headers['X-Admin-CSRF']=self.csrf
        data=raw if raw is not None else json.dumps(body if body is not None else {}).encode() if method!='GET' else None
        try:
            with self.opener.open(Request(self.server+path,data=data,headers=headers,method=method),timeout=45) as r:
                return json.load(r)
        except HTTPError as e:
            # Responses can contain submitted data: print only a fixed path and status, never bodies/passwords.
            raise Refused(f'{method} request returned HTTP{e.code}. No existing account was reset or removed.') from None
        except (URLError,TimeoutError):raise Refused('Server request failed. No credentials or response content printed.') from None

    def get(self,path):return self.request('GET',path)
    def post(self,path,body=None):return self.request('POST',path,body)
    def put(self,path,body):return self.request('PUT',path,body)
    def patch(self,path,body):return self.request('PATCH',path,body)


def admin_signin(api,login,password,code_reader):
    challenge=api.post('/api/admin/login',{'login':login,'password':password})
    if challenge.get('enrollment'):raise Refused('Complete administrator MFA enrollment in the portal first. This script does not enroll or change it.')
    if not challenge.get('signed_in'):api.post('/api/admin/verify',{'code':code_reader()})
    api.csrf=api.get('/api/admin/me')['csrf']


def fictional_gpx(day,index):
    # A synthetic loop near0°,0° in open water, away from homes, streets and real-person routes.
    start=dt.datetime.combine(day,dt.time(8),dt.timezone.utc);points=[]
    for i in range(241):
        angle=2*math.pi*i/240
        lat=.008*math.sin(angle)+index*.0002;lon=.008*(1-math.cos(angle))
        stamp=(start+dt.timedelta(seconds=i*8)).isoformat()
        points.append(f'<trkpt lat="{lat:.7f}" lon="{lon:.7f}"><ele>{10+3*math.sin(angle):.1f}</ele><time>{stamp}</time></trkpt>')
    return ('<?xml version="1.0"?><gpx version="1.1" creator="Kinetta fictional reviewer" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Fictional demo loop</name><type>running</type><trkseg>'+''.join(points)+'</trkseg></trk></gpx>').encode()


def upload_gpx(api,data,index):
    boundary='KinettaReview'+secrets.token_hex(12)
    payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="fictional-review-{index}.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n'.encode()+data+f'\r\n--{boundary}--\r\n'.encode())
    job=api.request('POST','/api/import',raw=payload,content_type='multipart/form-data; boundary='+boundary)['job']
    for _ in range(90):
        row=next((r for r in api.get('/api/imports') if r['id']==job),None)
        if row and row['finished']:
            if row['failed'] or row['added']!=1:raise Refused('Fictional route import did not complete. Inspect only the new reviewer account before retrying.')
            return
        time.sleep(1)
    raise Refused('Fictional route import is still pending; no retry or deletion was sent.')


def seed(admin,server,reviewer,friend,password,*,api_factory=API):
    # Preflight BOTH names before the first write. Existing members are never reused, reset or deleted.
    for name in (reviewer,friend):
        matches=admin.get('/api/admin/people?'+urlencode({'q':name,'tests':'true'}))
        if matches.get('pages',1)>1:raise Refused('Demo namespace is already crowded. Choose a more specific unused name.')
        if any(r['login'].lower()==name.lower() for r in matches['rows']):
            raise Refused('A requested demo name already exists. Choose a new name; no existing account was changed.')
    friend_password=secrets.token_urlsafe(30)
    for name,pw,label in ((reviewer,password,'Fictional Reviewer'),(friend,friend_password,'Fictional Friend')):
        admin.post('/api/admin/people',{'login':name,'name':label,'password':pw})
    clients=[]
    for name,pw in ((reviewer,password),(friend,friend_password)):
        api=api_factory(server);api.post('/api/login',{'login':name,'password':pw})
        me=api.get('/api/me')
        if me['login']!=name or me.get('is_admin'):raise Refused('New demo identity did not match an ordinary member. Stopped before seeding.')
        api.put('/api/profile',{'tz':'UTC','ai_ok':False,'birth_year':1992,'weight_kg':70,'height_cm':174,'sex':'female','activity_factor':1.3})
        api.put('/api/sharing',{'default':'me','trim_m':400});clients.append(api)
    person,pal=clients;today=dt.datetime.now(dt.timezone.utc).date()
    for index in range(8):upload_gpx(person,fictional_gpx(today-dt.timedelta(days=index*4+1),index),index)
    rows=[]
    for i in range(14):
        day=str(today-dt.timedelta(days=i))
        for meal,name,kcal,protein,carbs,fat in [('breakfast','Oats and yogurt',420,26,52,12),('lunch','Rice bowl',600,40,75,16),('dinner','Lentil pasta',650,36,90,16),('snacks','Fruit and nuts',220,7,25,12)]:
            rows.append({'day':day,'meal':meal,'name':name,'kcal':kcal,'protein_g':protein,'carbs_g':carbs,'fat_g':fat})
    person.post('/api/food/entries',rows)
    person.put('/api/food/targets',{'kcal_target':2100,'protein_target':110,'carbs_target':None,'fat_target':None})
    for i in range(0,28,3):person.put('/api/food/weights',{'day':str(today-dt.timedelta(days=i)),'kg':70+i*.01})
    recipe=person.post('/api/dishes',{'name':'Lentil bowl'})
    person.patch('/api/dishes/'+str(recipe['id']),{'known_kcal':520,'known_protein_g':25,'known_carbs_g':70,'known_fat_g':15})
    person.post('/api/friends',{'login':friend});pal.post('/api/friends/'+reviewer+'/accept')
    activity=pal.post('/api/activities/manual',{'sport':'walk','start':str(today-dt.timedelta(days=1))+'T12:00:00+00:00','duration_s':1800,'distance_m':2200,'name':'Fictional friend walk'})
    pal.put('/api/activities/'+str(activity['id'])+'/sharing',{'visibility':'friends'})
    return {'reviewer':reviewer,'friend':friend,'activities':8,'food_days':14,'recipe':True}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server',required=True);parser.add_argument('--reviewer',required=True);parser.add_argument('--confirm',required=True);parser.add_argument('--admin',required=True)
    args=parser.parse_args(argv)
    try:
        server,reviewer,friend=validate(args.server,args.reviewer,args.confirm)
        password=getpass.getpass('New reviewer password (never printed or saved locally): ')
        if len(password)<12:raise Refused('Use a reviewer password of at least12 characters.')
        admin=API(server);admin_signin(admin,args.admin,getpass.getpass('Administrator password: '),lambda:getpass.getpass('Current administrator MFA or unused recovery code: '))
        seed(admin,server,reviewer,friend,password)
        print('Created fictional reviewer and friend accounts with 8 synthetic routes,14 food days, weigh-ins and a recipe. Credentials were not printed. Everyone on a shared server is still visible; use the owner-approved review server.')
        return 0
    except Refused as e:
        print('Stopped: '+str(e));return 1


if __name__=='__main__':raise SystemExit(main())
