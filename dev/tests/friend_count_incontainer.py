"""Visible profile counts never expose another person's friends list. Fictional isolated accounts only."""
import unittest,uuid
import datetime as dt
from fastapi.testclient import TestClient
from app import auth,db
from app.main import app

class Counts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pw=auth.hash_pw('fictional friendship password')
    def setUp(self):
        self.ids={};self.logins={};self.clients={}
        with db.connect() as c:
            for who in ('owner','friend','pending','stranger'):
                login='zz_test_count_'+uuid.uuid4().hex[:10]+'_'+who
                uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional '+who,self.pw)).fetchone()['id']
                c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));self.ids[who]=uid;self.logins[who]=login
                client=TestClient(app);client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});self.clients[who]=client
            c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.ids['owner'],self.ids['friend']))
            c.execute("INSERT INTO friendships(requester,addressee,status) VALUES(%s,%s,'pending')",(self.ids['pending'],self.ids['owner']))
    def tearDown(self):
        from app.api_account import erase,erase_files
        with db.connect() as c:
            for uid in self.ids.values():erase(c,{'id':uid,'sql_role':None})
        for uid in self.ids.values():erase_files(uid)
    def profile(self,viewer='owner',target='owner',want=200):
        r=self.clients[viewer].get('/api/people/'+self.logins[target]+'/profile');self.assertEqual(r.status_code,want,r.text)
        return r.json()
    def test_owner_friend_and_stranger_see_count_only(self):
        for who in ('owner','friend','stranger'):
            p=self.profile(who);self.assertEqual(p['friend_count'],1)
            self.assertNotIn('friends',p);self.assertNotIn('mutual_friends',p)
            self.assertNotIn(self.logins['friend'],str(p),'accepted friend identity not included in owner profile')
        rows=self.clients['owner'].get('/api/friends').json();self.assertEqual(len(rows['friends']),1);self.assertEqual(len(rows['incoming']),1)
        rows=self.clients['stranger'].get('/api/friends',params={'user_id':self.ids['owner']}).json();self.assertEqual(rows['friends'],[])
        self.assertEqual(TestClient(app).get('/api/people/'+self.logins['owner']+'/profile').status_code,401)
    def test_remove_updates_both_sides_and_public_count(self):
        r=self.clients['owner'].delete('/api/friends/'+self.logins['friend']);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.profile('stranger')['friend_count'],0)
        self.assertEqual(self.profile('friend','friend')['friend_count'],0)
        self.assertEqual(self.clients['friend'].get('/api/friends').json()['friends'],[])
    def test_block_and_account_visibility_are_preserved(self):
        r=self.clients['owner'].post('/api/people/'+self.logins['friend']+'/block',json={});self.assertEqual(r.status_code,200,r.text)
        self.profile('friend',want=404);self.profile('owner','friend',want=404)
        self.assertEqual(self.profile('stranger')['friend_count'],0)
        with db.connect() as c:c.execute('UPDATE users SET suspended_at=now() WHERE id=%s',(self.ids['owner'],))
        self.profile('stranger',want=404)
    def test_ineligible_friends_are_excluded_from_list_and_count(self):
        with db.connect() as c:c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s',(self.ids['friend'],))
        self.assertEqual(self.profile('stranger')['friend_count'],0)
        self.assertEqual(self.clients['owner'].get('/api/friends').json()['friends'],[])

unittest.main(verbosity=2)
