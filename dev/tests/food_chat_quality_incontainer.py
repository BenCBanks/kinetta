"""Food chat conversation quality: what people actually type, end to end through the app's review flow.

Fictional account; catalogs and the AI estimator are stand-ins (routing and wording only, never model accuracy).
Each conversation mirrors the phone: review_only messages in one draft, each sent with the latest food card as context.
"""
import re,unittest,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,auth
from app.main import app

PW='green teapot on the hill'


def lookup(text):
    if 'starbucks' in text.lower():
        return {'kind':'brand','text':text,'foods':[{'source':'usda','id':'b1','name':'Fictional latte','brand':'Fictional','per100':{'kcal':60,'protein_g':3,'carbs_g':6,'fat_g':2},'serving':{'label':'1 cup','g':240}}]}
    return {'kind':'none','text':text,'foods':[]}


def estimate(body,user=None,strict=False):
    """Like the real estimator: one item per food named, each with its own amount."""
    items=[]
    for chunk in re.split(r'\n|,| and | with ',body.note or ''):
        chunk=chunk.strip()
        if not chunk:continue
        m=re.match(r'(\d+(?:\.\d+)?)\s+(.*)',chunk);n=float(m[1]) if m else 1
        name=(m[2] if m else re.sub(r'^(?:a|an|one|some)\s+','',chunk)).strip()
        items.append({'name':name.capitalize()[:60],'amount':f'{n:g} serving','grams':100*n,'kcal':100*n,'protein_g':5*n,'carbs_g':10*n,'fat_g':4*n,'fiber_g':1})
    return {'items':items,'notes':'stand-in','model':'stand-in, not real inference'}


class Conversation(unittest.TestCase):
    def setUp(self):
        login='zz_test_chat_'+uuid.uuid4().hex[:10]
        with db.connect() as c:
            self.uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(login,'Fictional',auth.hash_pw(PW))).fetchone()['id']
            c.execute("INSERT INTO profile(user_id,tz,ai_ok,weight_kg,kcal_target,protein_target) VALUES (%s,'UTC',true,75,2000,110)",(self.uid,))
        self.a=TestClient(app);self.a.headers['Origin']='http://testserver'
        self.assertEqual(self.a.post('/api/login',json={'login':login,'password':PW}).status_code,200)
        self.patches=[patch('urllib.request.urlopen',side_effect=AssertionError('Unexpected external request')),
                      patch('app.meal_chat.lookup',side_effect=lookup),patch('app.food_photo.estimate',side_effect=estimate)]
        mocks=[p.start() for p in self.patches];self.model=mocks[2]
        self.draft=str(uuid.uuid4());self.context=None

    def tearDown(self):
        for p in self.patches:p.stop()
        with db.connect() as c:
            rows=c.execute('DELETE FROM ai_food_attempts WHERE user_id=%s RETURNING day,charged_micros',(self.uid,)).fetchall()
            for r in rows:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(r['charged_micros'],r['day']))
            c.execute('DELETE FROM users WHERE id=%s',(self.uid,))

    def say(self,text):
        """One message as the phone sends it; returns (reply text, reply result, every message returned)."""
        cid=str(uuid.uuid4())
        r=self.a.post('/api/food/thread/messages',json={'client_id':cid,'body':text,'review_only':True,'draft_id':self.draft,'context':self.context or cid})
        self.assertEqual(r.status_code,201,r.text[:400]);mid=r.json()['message']['id']
        data=self.a.post(f'/api/food/thread/messages/{mid}/process',json={}).json()
        reply=next(m for m in data['messages'] if m.get('reply_to')==mid)
        if reply['result'].get('can_resolve'):
            data=self.a.post(f'/api/food/thread/messages/{mid}/resolve',json={}).json()
            reply=next(m for m in data['messages'] if m.get('reply_to')==mid)
        own=next(m for m in data['messages'] if m['id']==mid)
        if (own.get('result') or {}).get('kind') in ('log','needs','preview','undone'):self.context=cid
        return reply['body'],reply['result'],data['messages']

    def foods(self,result):
        return [(e['name'],e['kcal']) for p in result.get('parts',[]) for e in p.get('entries') or []]

    def test_replies_that_are_not_food_never_become_food(self):
        for text in ('ok','yes','lol','nothing','I skipped breakfast','what?','never mind','cancel','is that right?'):
            with self.subTest(text=text):
                body,result,_=self.say(text)
                self.assertEqual(result['kind'],'answer',body);self.assertNotIn('How much',body);self.assertNotIn(text.lower()+' did you',body.lower())
        body,result,_=self.say('2 slices')
        self.assertEqual(result['kind'],'answer');self.assertIn('of what?',body)
        self.model.assert_not_called()

    def test_an_article_size_or_unit_is_already_an_amount(self):
        for text in ('a banana','large fries','glass of wine','a handful of almonds','2 beers'):
            with self.subTest(text=text):
                body,result,_=self.say(text)
                self.assertEqual(result['kind'],'preview',body);self.assertTrue(self.foods(result))

    def test_missing_amount_assumes_a_typical_portion_and_says_so(self):
        body,result,_=self.say('coffee with milk')
        self.assertEqual(result['kind'],'preview',body);self.assertEqual(self.model.call_args.args[0].note,'a typical serving of coffee with milk')
        self.assertIn('typical portion of coffee with milk',result['assumed'])
        with db.connect() as c:c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(self.uid,))
        body,result,_=self.say('greek yogurt')
        self.assertTrue(body.startswith('Greek yogurt — about how much?'),'without AI estimates the amount is still asked');self.assertIn('Not sure',result['parts'][0]['replies'])
        body,result,_=self.say('large');self.assertIn('1 large greek yogurt',result['parts'][0]['text'])

    def test_new_foods_in_one_sentence_are_estimated_together(self):
        body,result,_=self.say('I had 2 eggs and toast for breakfast')
        self.assertEqual(result['kind'],'preview',body)
        self.assertEqual(self.model.call_args.args[0].note,'2 eggs and toast')
        self.assertEqual([n for n,_ in self.foods(result)],['Eggs','Toast'])

    def test_corrections_change_the_unconfirmed_card(self):
        self.say('2 eggs and toast')
        body,_,messages=self.say('actually 3 eggs');self.assertEqual(body,'Changed eggs to 3.')
        card=next(m for m in messages if m.get('reply_to') and m['result'].get('parts'))['result']
        self.assertEqual(self.foods(card),[('Eggs',300),('Toast',100)],'only the named food changes')
        body,_,messages=self.say('remove the toast');self.assertEqual(body,'Removed toast.')
        card=next(m for m in messages if m.get('reply_to') and m['result'].get('parts'))['result']
        self.assertEqual(self.foods(card),[('Eggs',300)])
        body,_,messages=self.say('no, it was lunch');self.assertEqual(body,'Okay, lunch today.')
        self.assertEqual(next(m for m in messages if m.get('reply_to') and m['result'].get('parts'))['result']['meal'],'lunch')
        body,_,_=self.say('never mind');self.assertIn('Nothing was logged',body)
        self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])

    def test_not_sure_estimates_a_typical_version_and_keeps_details(self):
        self.say('taco')
        body,result,_=self.say('not sure');self.assertEqual(result['kind'],'preview',body)
        self.assertEqual(self.model.call_args.args[0].note,'a typical taco');self.assertIn('a typical portion of taco.',result['assumed'])
        self.say('taco');body,result,_=self.say('chicken')
        self.assertEqual(self.model.call_args.args[0].note,'a typical serving of chicken taco');self.assertIn('typical portion of chicken taco',result['assumed'])
        body,_,messages=self.say('2');self.assertEqual(body,'Changed chicken taco to 2.')
        self.say('salad')
        body,result,_=self.say('caesar with chicken');self.assertEqual(self.model.call_args.args[0].note,'a typical serving of caesar salad with chicken')
        self.say('burrito')
        body,_,_=self.say('what do you mean');self.assertIn('Or say “not sure”',body)

    def test_unrelated_food_is_never_a_dish_type(self):
        self.say('taco')
        body,result,_=self.say('banana')
        self.assertEqual(result['parts'][0]['text'],'a typical serving of banana');self.assertNotIn('taco',self.model.call_args.args[0].note)

    def test_food_questions_look_the_food_up_without_logging(self):
        body,result,_=self.say('how many calories in an avocado?')
        self.assertEqual(result['kind'],'preview',body);self.assertEqual(self.model.call_args.args[0].note,'an avocado')
        self.say('does greek yogurt have protein')
        self.assertEqual(self.model.call_args.args[0].note,'a typical serving of greek yogurt')
        self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])

    def test_steppers_change_one_food_inside_an_estimate(self):
        _,result,_=self.say('2 eggs and toast')
        mid=next(r for r in self.a.get('/api/food/thread').json()['messages'] if r['kind']=='user' and r['body']=='2 eggs and toast')['id']
        part=result['parts'][0];self.assertEqual(part['entry_drafts'],[0,1])
        r=self.a.post(f'/api/food/thread/messages/{mid}/choose',json={'part':part['index'],'draft':1,'factor':2}).json()
        card=next(m for m in r['messages'] if m.get('reply_to')==mid)['result']
        self.assertEqual(self.foods(card),[('Eggs',200),('Toast',200)],'only the toast doubled')
        self.assertEqual(self.a.post(f'/api/food/thread/messages/{mid}/choose',json={'part':part['index'],'draft':9,'factor':2}).status_code,422)

    def test_clear_chat_and_daily_fresh_start_keep_logged_food(self):
        self.say('a banana')
        with db.connect() as c:
            c.execute("INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,protein_g,carbs_g,fat_g,source) VALUES (%s,(now() AT TIME ZONE 'UTC')::date,'lunch','Fictional logged food',1,'serving',100,1,1,1,'quick')",(self.uid,))
            # Yesterday's conversation, over 3 hours old, goes on the next read; a just-after-midnight one stays.
            c.execute("UPDATE food_chat_messages SET local_day=local_day-1,created=now()-interval '5 hours' WHERE user_id=%s",(self.uid,))
        self.say('an apple')
        with db.connect() as c:c.execute("UPDATE food_chat_messages SET local_day=local_day-1 WHERE user_id=%s AND body='an apple'",(self.uid,))
        bodies=[m['body'] for m in self.a.get('/api/food/thread').json()['messages'] if m['kind']=='user']
        self.assertEqual(bodies,['an apple'])
        self.assertEqual(self.a.post('/api/food/thread/clear',json={'confirm':False}).status_code,400)
        r=self.a.post('/api/food/thread/clear',json={'confirm':True}).json();self.assertTrue(r['food_kept'])
        self.assertEqual(self.a.get('/api/food/thread').json()['messages'],[])
        self.assertEqual([e['name'] for e in self.a.get('/api/food/day').json()['entries']],['Fictional logged food'])
        with db.connect() as c:cid=c.execute("SELECT client_id FROM food_chat_cancellations WHERE user_id=%s LIMIT 1",(self.uid,)).fetchone()['client_id']
        replay=self.a.post('/api/food/thread/messages',json={'client_id':str(cid),'body':'an apple','review_only':True})
        self.assertEqual(replay.status_code,409,'a phone retry cannot bring a cleared message back')

    def test_generic_word_asks_once_without_ai_understanding(self):
        body,result,_=self.say('chips');self.assertEqual(body,'What kind of chips? For example, “tortilla chips”.')
        body,result,_=self.say('tortilla');self.assertEqual(result['kind'],'preview',body)

    def test_remaining_goal_with_nothing_logged(self):
        body,_,_=self.say('how much protein do I have left')
        self.assertEqual(body,'All of your 110 g protein goal is left; nothing is logged for today yet.')


if __name__=='__main__':
    unittest.main(argv=['food_chat_quality'],exit=True)
