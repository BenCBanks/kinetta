"""Real owner-only food reuse and review; fictional SQL, no AI/catalog/provider calls."""
import datetime as dt
import json
import unittest
import uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth, db, food_memory as memory
from app.main import app


class FoodMemory(unittest.TestCase):
    def setUp(self):
        self.ids=[];self.clients=[];self.day=dt.date(2026,11,1);self.draft=str(uuid.uuid4())
        with db.connect() as c:
            for _ in range(2):
                uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                              ('zz_test_food_memory_'+uuid.uuid4().hex[:12],'Fictional food owner')).fetchone()['id']
                self.ids.append(uid);c.execute("INSERT INTO profile(user_id,tz,ai_ok) VALUES(%s,'UTC',false)",(uid,))
                client=TestClient(app);client.headers['Origin']='http://testserver'
                client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));self.clients.append(client)
        self.a,self.b=self.clients
        self.network=patch('urllib.request.urlopen',side_effect=AssertionError('No provider calls'));self.network.start()

    def tearDown(self):
        self.network.stop()
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def food(self,name='Wooden robot latte',owner=0,day=None,amount=1,unit='cup',brand=None,source='quick',unknown=False):
        with db.connect() as c:
            return c.execute('''INSERT INTO food_entries(user_id,day,meal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,source,ref)
                VALUES(%s,%s,'breakfast',%s,%s,%s,%s,180,8,20,7,%s,%s) RETURNING id''',
                (self.ids[owner],day or self.day,name,brand,amount,unit,source,json.dumps({'unknown_nutrients':['protein_g']} if unknown else {}))).fetchone()['id']

    def suggestion(self,name='latte',client=None):
        r=(client or self.a).get('/api/food/meals-chat/reuse',params={'q':name,'day':str(self.day),'user_id':self.ids[1]})
        self.assertEqual(r.status_code,200,r.text);return r.json()['items']

    def post(self,path,body,client=None,status=200):
        r=(client or self.a).post(path,json=body);self.assertEqual(r.status_code,status,r.text);return r.json()

    def reuse(self,item,**extra):
        body={'draft_id':self.draft,'client_id':str(uuid.uuid4()),'kind':item['kind'],'id':item['id'],
              'expected':item['expected'],'portion':item['canonical_portion'],'day':str(self.day),'meal':'lunch',**extra}
        return body,self.post('/api/food/thread/reviews/reuse',body)

    def test_candidates_are_owner_only_bounded_and_work_without_ai(self):
        own=self.food();self.food('Foreign secret latte',owner=1);self.food('Old expired latte',day=self.day-dt.timedelta(days=90))
        found=self.suggestion();self.assertEqual([(x['id'],x['name']) for x in found],[(own,'Wooden robot latte')])
        self.assertEqual(TestClient(app).get('/api/food/meals-chat/reuse?q=latte').status_code,401)
        self.assertEqual(self.a.get('/api/food/meals-chat/reuse?q=x').status_code,422)
        with db.coach_connect(self.ids[0]) as c:
            self.assertEqual(c.execute('SELECT DISTINCT user_id FROM food_entries').fetchall(),[{'user_id':self.ids[0]}])
        import psycopg
        with self.assertRaises((psycopg.errors.InsufficientPrivilege,psycopg.errors.ReadOnlySqlTransaction)):
            with db.coach_connect(self.ids[0]) as c:c.execute("DELETE FROM food_entries WHERE user_id=%s",(self.ids[0],))

    def test_usual_portion_uses_frequency_and_preserves_brand_variants(self):
        for _ in range(3):self.food(amount=1,brand='Fictional A')
        self.food(amount=2,brand='Fictional A');self.food(amount=1,brand='Fictional B')
        with db.coach_connect(self.ids[0]) as c:data=memory.retrieve(c,self.ids[0],'latte',self.day)
        self.assertEqual(len(data['frequent']),2)
        self.assertEqual(data['frequent'][0]['portion'],[{'amount':1.0,'unit':'cup'}])
        self.assertEqual(len(data['matches']),2)

    def test_exact_historical_recipe_and_unknown_nutrients_wait_for_confirmation(self):
        fid=self.food(source='dish',unknown=True);item=self.suggestion()[0];self.assertEqual(item['id'],fid)
        body,data=self.reuse(item)
        root=next(x for x in data['messages'] if x['kind']=='user')
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==root['id'])
        entry=result['parts'][0]['entries'][0];self.assertEqual(entry['kcal'],180);self.assertIsNone(entry['protein_g'])
        self.post('/api/food/thread/reviews/reuse',body)
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],1)
        review=self.post('/api/food/thread/reviews',{'draft_id':self.draft,'client_id':str(uuid.uuid4()),'messages':[root['id']]})
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':False,'meal':'lunch'},status=400)
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'lunch','day':str(self.day)})
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'lunch','day':str(self.day)})
        with db.connect() as c:
            rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s ORDER BY id',(self.ids[0],)).fetchall()
            self.assertEqual(len(rows),2);self.assertEqual(rows[1]['kcal'],180)
            self.assertIn('protein_g',rows[1]['ref']['unknown_nutrients'])

    def test_foreign_stale_deleted_and_forged_candidates_fail(self):
        fid=self.food();item=self.suggestion()[0];body={'draft_id':self.draft,'client_id':str(uuid.uuid4()),'kind':item['kind'],'id':fid,'expected':item['expected'],'portion':item['canonical_portion'],'day':str(self.day)}
        self.post('/api/food/thread/reviews/reuse',body,client=self.b,status=404)
        self.post('/api/food/thread/reviews/reuse',{**body,'user_id':self.ids[0]},status=422)
        self.post('/api/food/thread/reviews/reuse',{**body,'portion':{'count':-1}},status=422)
        with db.connect() as c:c.execute('UPDATE food_entries SET kcal=240 WHERE user_id=%s AND id=%s',(self.ids[0],fid))
        self.post('/api/food/thread/reviews/reuse',body,status=409)
        with db.connect() as c:c.execute('DELETE FROM food_entries WHERE user_id=%s AND id=%s',(self.ids[0],fid))
        self.post('/api/food/thread/reviews/reuse',body,status=404)

    def test_source_change_after_staging_rejects_review(self):
        fid=self.food();_,data=self.reuse(self.suggestion()[0]);root=next(x for x in data['messages'] if x['kind']=='user')
        with db.connect() as c:c.execute('UPDATE food_entries SET brand=%s WHERE user_id=%s AND id=%s',('Changed fictional brand',self.ids[0],fid))
        self.post('/api/food/thread/reviews',{'draft_id':self.draft,'client_id':str(uuid.uuid4()),'messages':[root['id']]},status=409)

    def test_saved_search_ranks_old_exact_names_and_separate_brands(self):
        with db.connect() as c:
            exact=c.execute("INSERT INTO custom_foods(user_id,name,brand,kcal) VALUES(%s,'Cinnamon coffee','Fictional Pearl Foods',180) RETURNING id",(self.ids[0],)).fetchone()['id']
            for i in range(15):c.execute('INSERT INTO custom_foods(user_id,name,kcal) VALUES(%s,%s,100)',(self.ids[0],f'Coffee variant {i}'))
            long=c.execute("INSERT INTO custom_foods(user_id,name,kcal) VALUES(%s,'Maple apple fritter iced latte with whole milk',210) RETURNING id",(self.ids[0],)).fetchone()['id']
        self.assertEqual(self.suggestion('cinnamon coffee')[0]['id'],exact)
        self.assertEqual(self.suggestion('Pearl Foods')[0]['id'],exact)
        self.assertEqual(self.suggestion('Maple apple fritter iced latte with whole milk')[0]['id'],long)
        self.assertEqual(self.suggestion('cinnmon coffee')[0]['id'],exact)
        self.assertEqual(self.a.get('/api/food/meals-chat/reuse?q=latte&day=0001-01-01').status_code,200)

    def test_recipe_suggestion_pins_portion_despite_another_logged_portion(self):
        with db.connect() as c:
            did=c.execute("INSERT INTO dishes(user_id,name,known_kcal,serving) VALUES(%s,'Fictional cinnamon loaf',400,'one') RETURNING id",(self.ids[0],)).fetchone()['id']
            c.execute("INSERT INTO food_entries(user_id,day,name,source,amount,unit,kcal,ref) VALUES(%s,%s,'Fictional cinnamon loaf','dish',1,'serving',400,%s)",
                      (self.ids[0],self.day,json.dumps({'dish_id':did})))
            item=memory.public(c,self.ids[0],memory.source(c,self.ids[0],'dish',did))
        self.assertEqual(item['totals']['kcal'],400)
        with db.connect() as c:
            c.execute("INSERT INTO food_entries(user_id,day,name,source,amount,unit,kcal,ref) VALUES(%s,%s,'Fictional cinnamon loaf','dish',2,'serving',800,%s)",
                      (self.ids[0],self.day,json.dumps({'dish_id':did})))
        _,data=self.reuse(item)
        result=next(x['result'] for x in data['messages'] if x['kind']!='user')
        self.assertEqual(result['parts'][0]['entries'][0]['kcal'],400)

    def message(self,text):
        r=self.post('/api/food/thread/messages',{'body':text,'client_id':str(uuid.uuid4()),'review_only':True,'draft_id':self.draft},status=201)
        self.day=dt.date.fromisoformat(r['message']['local_day']);return r['message']

    def context_patches(self,ask):
        from contextlib import ExitStack
        stack=ExitStack()
        for name in ['app.food_memory_understand.enabled','app.food_thread_understand.allowed']:
            stack.enter_context(patch(name,return_value=True))
        stack.enter_context(patch('app.food_thread_understand.obvious',return_value=False))
        stack.enter_context(patch('app.food_memory_understand.ask_model',side_effect=ask))
        return stack

    def reading(self,foods):
        return {'intent':'log','foods':foods,'missing':'none','meal':'none','day':'none','topic':'none','nutrient':'none','reply':'Review these foods.'}

    def test_context_reference_in_middle_renames_exact_numbers_and_keeps_other_foods(self):
        m=self.message('I had an apple fritter latte; use the nutrition from Wooden robot latte. Also a banana.')
        self.food();self.food('Banana');self.food('Foreign secret latte',owner=1)
        def ask(uid,message,ctx,card):
            self.assertNotIn('Foreign secret',json.dumps(ctx));token=next(k for k,v in ctx['sources'].items() if v['name']=='Wooden robot latte')
            return self.reading([{'name':'Apple fritter latte','quantity':1,'reference_token':token},{'name':'Banana','quantity':1}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        entries=[e for p in result['parts'] for e in p.get('entries',[])]
        self.assertEqual([(e['name'],e['kcal']) for e in entries],[('Apple fritter latte',180),('Banana',180)])
        self.assertEqual(entries[0]['ref']['nutrition_from']['name'],'Wooden robot latte')
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],2)

    def test_context_memory_is_own_food_only_and_revocation_discards_late_reading(self):
        m=self.message('My usual latte again');self.food()
        with db.connect() as c:
            for uid in self.ids:c.execute('INSERT INTO kit_conversations(user_id,generation) VALUES(%s,%s)',(uid,uuid.uuid4()))
            for uid,text,health in [(self.ids[0],'I prefer whole milk.',False),(self.ids[0],'PRIVATE HEALTH NOTE',True),(self.ids[1],'FOREIGN NOTE',False)]:
                c.execute('INSERT INTO kit_memories(user_id,text,health_included) VALUES(%s,%s,%s)',(uid,text,health))
        def ask(uid,message,ctx,card):
            self.assertEqual([n['user_said'] for n in ctx['stable']['preferences']],['I prefer whole milk.'])
            token=next(iter(ctx['sources']))
            with db.connect() as c:c.execute('UPDATE kit_conversations SET memory_enabled=false,memory_version=memory_version+1 WHERE user_id=%s',(uid,))
            return self.reading([{'name':'Latte','reference_token':token}]),{},'stand-in'
        from app import food_memory_understand as contextual
        with self.context_patches(ask):contextual.prepare(self.ids[0],m['id'])
        with db.connect() as c:r=c.execute('SELECT result FROM food_chat_messages WHERE user_id=%s AND id=%s',(self.ids[0],m['id'])).fetchone()['result']
        self.assertTrue(r['understanding']['failed']);self.assertNotIn('food_memory',r)

    def test_context_concurrent_retry_has_one_interpretation(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        m=self.message('My usual latte again');self.food();started=Event();release=Event();calls=[]
        def ask(uid,message,ctx,card):
            calls.append(uid);started.set();self.assertTrue(release.wait(5))
            return self.reading([{'name':'Latte','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask),ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(self.a.post,f"/api/food/thread/messages/{m['id']}/process",json={})
            self.assertTrue(started.wait(5));second=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
            self.assertTrue(second['processing']);release.set();self.assertEqual(first.result().status_code,200)
        self.assertEqual(len(calls),1)

    def test_context_deleted_message_cannot_be_recreated_after_model_returns(self):
        m=self.message('My usual latte again');self.food()
        def ask(uid,message,ctx,card):
            self.assertEqual(self.a.request('DELETE','/api/food/thread/messages/'+str(m['id']),json={}).status_code,200)
            return self.reading([{'name':'Latte','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask):self.post(f"/api/food/thread/messages/{m['id']}/process",{},status=404)
        with db.connect() as c:self.assertIsNone(c.execute('SELECT id FROM food_chat_messages WHERE user_id=%s AND id=%s',(self.ids[0],m['id'])).fetchone())

    def test_context_stale_source_asks_without_reestimating_or_copying_new_values(self):
        m=self.message('An apple fritter latte, like my Wooden robot latte');fid=self.food()
        def ask(uid,message,ctx,card):
            token=next(iter(ctx['sources']))
            with db.connect() as c:c.execute('UPDATE food_entries SET kcal=999 WHERE user_id=%s AND id=%s',(uid,fid))
            return self.reading([{'name':'Apple fritter latte','reference_token':token}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        self.assertFalse(any(p.get('entries') for p in result['parts']));self.assertIn('changed',result['parts'][0]['question'])

    def test_food_access_reuses_the_locked_connection(self):
        from app import food_thread_understand as U
        with db.connect() as c,patch('app.food_thread_understand.enabled',return_value=True),patch('app.ai_budget.enabled',return_value=True),\
             patch('app.coach.allowed',return_value=True),patch('app.ai_access.require') as require:
            self.assertTrue(U.allowed(c,self.ids[0]));require.assert_called_once_with(self.ids[0],'food',connection=c)

    def test_lost_context_lease_does_not_enter_legacy_paid_preparation(self):
        m=self.message('My usual latte again');self.food()
        def ask(uid,message,ctx,card):
            with db.connect() as c:c.execute("UPDATE food_chat_messages SET result=jsonb_set(result,'{_memory_lease,id}',%s::jsonb) WHERE user_id=%s AND id=%s",(json.dumps('replacement-lease'),uid,m['id']))
            return self.reading([{'name':'Latte','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask),patch('app.food_thread_understand.prepare') as legacy:
            result=self.post(f"/api/food/thread/messages/{m['id']}/process",{});self.assertTrue(result['processing']);legacy.assert_not_called()

    def test_clarification_can_choose_a_reference_without_reestimating_it(self):
        first=self.message('latte');self.food();self.food('Maple cloud latte')
        with db.connect() as c:c.execute('UPDATE food_chat_messages SET local_day=local_day-1 WHERE user_id=%s AND id=%s',(self.ids[0],first['id']))
        original=self.post(f"/api/food/thread/messages/{first['id']}/process",{})
        previous=next(x['result'] for x in original['messages'] if x.get('reply_to')==first['id'])
        self.assertGreater(previous['pending_count'],0)
        m=self.post('/api/food/thread/messages',{'body':'The Wooden robot one','client_id':str(uuid.uuid4()),'review_only':True,
            'draft_id':self.draft,'context':first['client_id']},status=201)['message']
        def ask(uid,message,ctx,card):
            token=next(k for k,v in ctx['sources'].items() if v['name']=='Wooden robot latte')
            out=self.reading([{'name':'Latte','reference_token':token}]);out['intent']='answer';return out,{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        self.assertEqual(result['parts'][0]['entries'][0]['kcal'],180)
        self.assertEqual((result['day'],result['meal']),(previous['day'],previous['meal']))
        old=next(x['result'] for x in data['messages'] if x.get('reply_to')==first['id']);self.assertEqual(old['parts'],[])

    def test_catalog_analogue_uses_published_slice_weight_and_keeps_new_name(self):
        from app import food_thread_resolve as resolver
        from app.food_thread_models import ResolveIn
        food={'source':'usda','generic':True,'id':'999999999999','name':'Banana bread','per100':{'kcal':300,'protein_g':4,'carbs_g':50,'fat_g':10},
              'serving':{'label':'100 g','g':100,'is_default':True}}
        part={'index':0,'status':'unknown','text':'a slice of banana bread','logged':False,'item':{},'analogue':{'name':'Lavender iced loaf','base':'banana bread'}}
        work={'message':{'body':'A slice of lavender loaf, similar to banana bread','result':{'review_only':True}},'result':{'parts':[part]},'media':{'kind':'text'}}
        with patch('app.meal_chat.lookup',return_value={'kind':'plain','foods':[food]}),\
             patch('app.api_food._cached',side_effect=lambda key,fetch:fetch()),\
             patch('app.api_food._get',return_value={'foodPortions':[{'amount':1,'portionDescription':'1 slice','gramWeight':50}]}):
            updates,error=resolver.resolve_outside(self.ids[0],work,ResolveIn())
        self.assertIsNone(error);ready=updates[0]['part'];self.assertEqual(ready['status'],'ready')
        self.assertEqual([(e['name'],e['kcal']) for e in ready['entries']],[('Lavender iced loaf',150)])
        self.assertEqual(ready['entries'][0]['ref']['estimated_from'],'banana bread')
        self.assertEqual(ready['entries'][0]['ref']['typical_portion'],'slice')
        manual={'manual':True,'analogue':part['analogue'],'entries':[{'name':'My edited food','kcal':125,'ref':{'origin':'manual'}}]}
        memory.label_entries(manual);self.assertEqual(manual['entries'][0]['name'],'My edited food');self.assertNotIn('estimated_from',manual['entries'][0]['ref'])

    def test_provider_retry_rechecks_before_each_send_and_releases_unsent_reservation(self):
        from contextlib import nullcontext
        from urllib.error import HTTPError
        from fastapi import HTTPException
        from app import food_photo
        with patch('app.ai_budget.reserve',return_value='stand-in'),patch('app.ai_budget.lease',side_effect=lambda _:nullcontext()),\
             patch('app.ai_budget.finish'),patch('app.ai_budget.release_failed') as release,patch('time.sleep'),\
             patch('urllib.request.urlopen',side_effect=HTTPError('https://example.invalid',503,'Fictional busy',None,None)) as send,\
             patch('builtins.print'):
            check=unittest.mock.Mock(side_effect=[None,HTTPException(409,'Consent revoked')])
            with self.assertRaises(HTTPException) as error:food_photo.ask([{'text':'Fictional message'}],{'type':'object'},'fictional',model_policy='context',before_attempt=check)
            self.assertEqual(error.exception.status_code,409);self.assertEqual(check.call_count,2);self.assertEqual(send.call_count,1)
            self.assertEqual(release.call_args.args[-1],400)
            self.assertIn('/models/gemini-3.8-flash:',send.call_args.args[0].full_url)

    def test_context_prompt_has_stable_prefix_and_internal_stronger_first_policy(self):
        from app import food_memory_understand as contextual
        ctx={'stable':{'frequent':[],'preferences':[]},'dynamic':{'matches':[],'today':[],'recent_turns':[]}}
        message={'id':123,'client_id':str(uuid.uuid4()),'body':'A latte similar to my usual one, plus toast'}
        with patch('app.food_photo.brake'),patch('app.food_photo.ask',return_value=({}, {}, 'stand-in')) as ask:
            contextual.ask_model(self.ids[0],message,ctx,{'card':'No pending food','previous':'Hello'})
        parts=ask.call_args.args[0];self.assertIn('Choose one intent',parts[0]['text'])
        self.assertEqual(json.loads(parts[1]['text']),ctx['stable']);self.assertIn(message['body'],parts[2]['text'])
        self.assertEqual(ask.call_args.kwargs['model_policy'],'context');self.assertTrue(callable(ask.call_args.kwargs['before_attempt']))

    def test_reference_volume_needs_a_compatible_recorded_measure(self):
        m=self.message('A 12 fl oz hazelnut latte; use Wooden robot latte nutrition');self.food(unit='serving')
        def ask(uid,message,ctx,card):return self.reading([{'name':'Hazelnut latte','quantity':12,'unit':'fl oz','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        part=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])['parts'][0]
        self.assertNotIn('entries',part);self.assertIn('saved portion',part['question'])
        with db.connect() as c:
            fid=c.execute("INSERT INTO custom_foods(user_id,name,serving_label,kcal) VALUES(%s,'Fictional coffee','1 cup',180) RETURNING id",(self.ids[0],)).fetchone()['id']
            item=memory.source(c,self.ids[0],'custom',fid);p=memory.reference_portion(c,self.ids[0],item,2,'cup',{'count':1})
            rows,_=memory.entries(c,self.ids[0],item,p);self.assertEqual(rows[0]['kcal'],360)

    def test_published_household_search_result_also_labels_the_assumption(self):
        from app import food_thread_resolve as resolver
        from app.food_thread_models import ResolveIn
        food={'source':'usda','generic':True,'id':'999999999999','name':'Banana bread','per100':{'kcal':300,'protein_g':4,'carbs_g':50,'fat_g':10},'serving':{'label':'1 slice','g':50,'is_default':False}}
        part={'index':0,'status':'unknown','text':'a slice of banana bread','logged':False,'item':{},'analogue':{'name':'Lavender loaf','base':'banana bread'}}
        work={'message':{'body':'A slice of lavender loaf, similar to banana bread','result':{'review_only':True}},'result':{'parts':[part]},'media':{'kind':'text'}}
        with patch('app.meal_chat.lookup',return_value={'kind':'plain','foods':[food]}),patch('app.food_memory.household_portion') as detail:
            updates,error=resolver.resolve_outside(self.ids[0],work,ResolveIn());detail.assert_not_called()
        self.assertEqual(updates[0]['part']['entries'][0]['ref']['typical_portion'],'slice')

    def test_three_item_semicolon_and_newline_lists_route_stronger(self):
        from app import food_memory_understand as contextual
        self.assertTrue(contextual.complex_message('Eggs; toast; coffee'))
        self.assertTrue(contextual.complex_message('Eggs\nToast\nCoffee'))
        self.assertFalse(contextual.complex_message('A banana'))



    def test_household_label_on_history_in_grams_uses_the_recorded_weight(self):
        m=self.message('A cup of apple oatmeal, use Wooden robot latte nutrition')
        fid=self.food(amount=200,unit='g')
        with db.connect() as c:c.execute('UPDATE food_entries SET kcal=400,ref=%s WHERE user_id=%s AND id=%s',
            (json.dumps({'serving':{'label':'1 cup','g':100}}),self.ids[0],fid))
        def ask(uid,message,ctx,card):return self.reading([{'name':'Apple oatmeal','quantity':1,'unit':'cup','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        entry=result['parts'][0]['entries'][0]
        self.assertEqual((entry['amount'],entry['unit'],entry['kcal']),(100,'g',200))
        with db.connect() as c:
            c.execute('UPDATE food_entries SET ref=%s WHERE user_id=%s AND id=%s',
                (json.dumps({'serving':{'label':'1 cup'}}),self.ids[0],fid))
            item=memory.source(c,self.ids[0],'history',fid)
            from fastapi import HTTPException
            with self.assertRaises(HTTPException):memory.reference_portion(c,self.ids[0],item,1,'cup',{'count':200,'unit':'g'})

    def test_unresolved_reference_keeps_the_new_food_without_estimation(self):
        m=self.message('An apple fritter latte, use my missing usual latte nutrition')
        def ask(uid,message,ctx,card):
            out=self.reading([{'name':'Apple fritter latte','quantity':1,'unit':'cup','reference_question':True}])
            out['reply']='Which of your saved lattes should I use?';return out,{},'stand-in'
        with self.context_patches(ask),patch('app.food_photo.estimate') as estimate:
            data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
            estimate.assert_not_called()
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        part=result['parts'][0];self.assertEqual(part['description']['food'],'Apple fritter latte')
        self.assertNotIn('entries',part);self.assertIn('?',part['question']);self.assertFalse(result['can_resolve'])


    def test_reference_source_answer_keeps_the_original_two_cups(self):
        first=self.message('2 cups of apple latte, use my usual latte nutrition');self.food()
        def unclear(uid,message,ctx,card):
            out=self.reading([{'name':'Apple latte','quantity':2,'unit':'cup','reference_question':True}])
            out['reply']='Which saved latte should I use?';return out,{},'stand-in'
        with self.context_patches(unclear):self.post(f"/api/food/thread/messages/{first['id']}/process",{})
        m=self.post('/api/food/thread/messages',{'body':'The Wooden robot one','client_id':str(uuid.uuid4()),
            'review_only':True,'draft_id':self.draft,'context':first['client_id']},status=201)['message']
        def answer(uid,message,ctx,card):
            out=self.reading([{'name':'Apple latte','quantity':2,'unit':'cup','reference_token':next(iter(ctx['sources']))}])
            out['intent']='answer';return out,{},'stand-in'
        with self.context_patches(answer):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        entry=result['parts'][0]['entries'][0];self.assertEqual((entry['name'],entry['amount'],entry['kcal']),('Apple latte',2,360))

    def test_unclear_reference_never_attaches_the_question_to_an_unrelated_banana(self):
        m=self.message('A banana and a latte, use my usual latte nutrition')
        def unclear(uid,message,ctx,card):
            out=self.reading([{'name':'Banana','quantity':1},{'name':'Latte','quantity':1}]);out['intent']='unclear'
            out['reply']='Which saved latte should I use?';return out,{},'stand-in'
        with self.context_patches(unclear),patch('app.food_photo.estimate') as estimate:
            data=self.post(f"/api/food/thread/messages/{m['id']}/process",{});estimate.assert_not_called()
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        self.assertEqual(result['kind'],'answer');self.assertIn('latte',result['text']);self.assertNotIn('parts',result)

    def test_context_query_timeout_rolls_back_and_uses_rules_without_a_provider(self):
        from app import food_memory_understand as contextual
        def timeout(*args):
            # Exercise a real aborted PostgreSQL savepoint, not merely a thrown Python exception.
            args[0].execute("SET LOCAL statement_timeout='1ms'")
            args[0].execute('SELECT pg_sleep(0.1)')
        m=self.message('A banana')
        with patch('app.food_memory_understand.enabled',return_value=True),patch('app.food_thread_understand.allowed',return_value=True),\
             patch('app.food_thread_understand.obvious',return_value=False),patch('app.food_memory_understand.context',side_effect=timeout),\
             patch('app.food_memory_understand.ask_model') as ask,patch('app.food_thread_understand.ask_model') as old:
            self.post(f"/api/food/thread/messages/{m['id']}/process",{});ask.assert_not_called();old.assert_not_called()
        with db.connect() as c:
            row=c.execute('SELECT state,result FROM food_chat_messages WHERE user_id=%s AND id=%s',(self.ids[0],m['id'])).fetchone()
            self.assertNotEqual(row['state'],'pending')


    def test_generic_latte_keeps_habit_details_instead_of_asking_between_saved_variants(self):
        m=self.message('A latte and a banana');self.food();self.food('Maple cloud latte')
        def ask(uid,message,ctx,card):return self.reading([{'name':'Latte','quantity':1,'details':'whole milk'},{'name':'Banana','quantity':1}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        part=result['parts'][0];self.assertEqual(part['status'],'unknown');self.assertIn('whole milk',part['text'])
        self.assertNotIn('entries',part);self.assertTrue(result['can_resolve'])

    def test_an_explicit_ambiguous_reference_still_asks_before_estimation(self):
        m=self.message('My usual latte again');self.food();self.food('Maple cloud latte')
        def ask(uid,message,ctx,card):
            out=self.reading([{'name':'Latte','reference_question':True}]);out['reply']='Which of your saved lattes?'
            return out,{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])
        self.assertEqual(result['parts'][0]['status'],'description');self.assertFalse(result['can_resolve'])

    def test_context_transport_uses_low_thinking_and_leaves_default_policy_unchanged(self):
        from contextlib import nullcontext
        from app import food_photo
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps({'candidates':[{'content':{'parts':[{'text':'{}'}]}}]}).encode()
        with patch('app.ai_budget.reserve',return_value='stand-in'),patch('app.ai_budget.lease',side_effect=lambda _:nullcontext()),\
             patch('app.ai_budget.settle'),patch('app.ai_budget.finish'),patch('urllib.request.urlopen',return_value=Response()) as send:
            food_photo.ask([{'text':'Fictional message'}],{'type':'object'},'fictional',model_policy='context')
            config=json.loads(send.call_args.args[0].data)['generationConfig']
            self.assertEqual(config['thinkingConfig'],{'thinkingLevel':'LOW'});self.assertEqual(config['maxOutputTokens'],4096)
            food_photo.ask([{'text':'Fictional message'}],{'type':'object'},'fictional')
            config=json.loads(send.call_args.args[0].data)['generationConfig']
            self.assertNotIn('thinkingConfig',config);self.assertEqual(config['maxOutputTokens'],2048)


    def test_ingredient_substitution_uses_a_new_estimate_instead_of_unchanged_reference(self):
        m=self.message('My usual latte, but oat milk instead of whole milk today');self.food()
        with db.connect() as c:c.execute('UPDATE profile SET ai_ok=true,ai_adult_at=now(),birth_year=1990 WHERE user_id=%s',(self.ids[0],))
        def ask(uid,message,ctx,card):return self.reading([{'name':'Latte','quantity':1,'details':'oat milk','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id']);part=result['parts'][0]
        self.assertEqual(part['status'],'unknown');self.assertIn('oat milk',part['text']);self.assertNotIn('entries',part)

    def test_explicit_copy_after_a_conjunction_keeps_the_requested_source(self):
        m=self.message('My latte but with oat milk, and use Wooden robot latte nutrition exactly');self.food()
        def ask(uid,message,ctx,card):return self.reading([{'name':'Latte','quantity':1,'details':'oat milk','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        part=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])['parts'][0]
        self.assertEqual(part['entries'][0]['kcal'],180);self.assertIn('nutrition_from',part['entries'][0]['ref'])

    def test_known_again_reference_still_receives_context_instead_of_obvious_shortcut(self):
        m=self.message('My Wooden robot latte again');self.food()
        def ask(uid,message,ctx,card):return self.reading([{'name':'Latte','reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask),patch('app.food_thread_understand.obvious',return_value=True) as obvious:
            data=self.post(f"/api/food/thread/messages/{m['id']}/process",{});obvious.assert_not_called()
        part=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])['parts'][0];self.assertEqual(part['entries'][0]['kcal'],180)

    def test_ordinary_single_latte_does_not_need_a_brand_question(self):
        m=self.message('A latte');self.food();self.food('Maple cloud latte')
        def ask(uid,message,ctx,card):
            out=self.reading([{'name':'Latte','quantity':1}]);out['missing']='type';out['reply']='Which brand?'
            return out,{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        result=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id']);self.assertEqual(result['parts'][0]['status'],'unknown')
        self.assertTrue(result['can_resolve'])

    def test_preference_bearing_two_food_list_uses_stronger_model(self):
        from app import food_memory_understand as contextual
        ctx={'stable':{'frequent':[],'preferences':[{'id':'1','user_said':'I prefer whole milk.'}]},'dynamic':{'matches':[],'today':[],'recent_turns':[]}}
        message={'id':123,'client_id':str(uuid.uuid4()),'body':'A latte and a banana'}
        with patch('app.food_photo.brake'),patch('app.food_photo.ask',return_value=({}, {}, 'stand-in')) as ask:
            contextual.ask_model(self.ids[0],message,ctx,{'card':'No pending food','previous':'None'})
        self.assertEqual(ask.call_args.kwargs['model_policy'],'context')


    def test_substitution_in_the_new_name_cannot_copy_the_old_nutrition(self):
        m=self.message('An oat milk latte instead of my usual one');self.food()
        def ask(uid,message,ctx,card):return self.reading([{'name':'Oat milk latte','quantity':1,'reference_token':next(iter(ctx['sources']))}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        part=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])['parts'][0]
        self.assertNotIn('entries',part);self.assertEqual(part['status'],'unknown')

    def test_one_drinks_copy_instruction_does_not_override_another_drinks_change(self):
        m=self.message('My usual latte with oat milk instead, and a honey latte using Wooden robot latte nutrition');self.food()
        def ask(uid,message,ctx,card):
            token=next(iter(ctx['sources']))
            return self.reading([{'name':'Latte','quantity':1,'details':'oat milk','reference_token':token},
                {'name':'Honey latte','quantity':1,'reference_token':token}]),{},'stand-in'
        with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{m['id']}/process",{})
        parts=next(x['result'] for x in data['messages'] if x.get('reply_to')==m['id'])['parts']
        self.assertNotIn('entries',parts[0]);self.assertEqual(parts[1]['entries'][0]['kcal'],180)
        self.assertEqual(parts[1]['entries'][0]['name'],'Honey latte')

    def test_ordinary_exact_food_still_skips_context_model(self):
        from app import food_memory_understand as contextual
        m=self.message('Wooden robot latte');self.food()
        with patch('app.food_memory_understand.enabled',return_value=True),patch('app.food_thread_understand.allowed',return_value=True),\
             patch('app.food_thread_understand.obvious',return_value=True),patch('app.food_memory_understand.ask_model') as ask:
            self.assertIsNone(contextual.prepare(self.ids[0],m['id']));ask.assert_not_called()

if __name__=='__main__':unittest.main(verbosity=2)
