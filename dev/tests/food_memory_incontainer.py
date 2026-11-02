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
        part=result['parts'][0];self.assertEqual(part['status'],'choose');self.assertFalse(result['can_resolve'])
        self.assertEqual({x['name'] for x in part['item']['choices']},{'Wooden robot latte','Maple cloud latte'})
        self.assertTrue(part['description']['reference']);self.assertFalse(part.get('entries'))

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


    def test_understanding_discards_model_nutrition_numbers_before_persisting(self):
        from app import food_memory_understand as contextual
        ctx={'sources':{},'stable':{'preferences':[]},'dynamic':{'recent_turns':[]}}
        out=self.reading([{'name':'Banana','quantity':1}]);out.update(intent='ask_food',reply='A banana contains105 calories.')
        result=contextual.clean(out,'calories in a banana',ctx)
        self.assertEqual(result['intent'],'ask_food');self.assertEqual(result['reply'],'')
        out.update(reply='Use2 bananas.');self.assertEqual(contextual.clean(out,'2 bananas',ctx)['reply'],'Use2 bananas.')
        out=self.reading([{'name':'Pasta'}]);out['missing']='type'
        self.assertEqual(contextual.clean(out,'pasta',ctx)['missing'],'amount')

    def routed(self,text,reading):
        # Keep actual obvious()/resolve routing; stub only approved gates and provider transport.
        from contextlib import ExitStack
        message=self.message(text)
        with ExitStack() as stack:
            stack.enter_context(patch('app.food_memory_understand.enabled',return_value=True))
            stack.enter_context(patch('app.food_thread_understand.allowed',return_value=True))
            provider=stack.enter_context(patch('app.food_memory_understand.ask_model',return_value=(reading,{},'fictional-context')))
            data=self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        return message,data,provider.call_count

    def test_uncertain_egg_does_not_shortcut_to_saved_egg_whites(self):
        self.food('Egg whites',amount=100,unit='g')
        for said in ('1 egg','i egg'):
            message,data,calls=self.routed(said,self.reading([{'name':'Egg','quantity':1 if said.startswith('1') else None,'size':'large'}]))
            self.assertEqual(calls,1,'partial/superset name reaches the real contextual preparation path')
            reply=next(m for m in data['messages'] if m.get('reply_to')==message['id'])
            self.assertNotIn('Egg whites',[e['name'] for p in reply['result'].get('parts',[]) for e in p.get('entries',[])])
            self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])

    def test_count_against_gram_history_reaches_context_not_last_gram_multiplier(self):
        self.food('Egg',amount=100,unit='g')
        message,data,calls=self.routed('1 egg',self.reading([{'name':'Egg','quantity':1,'size':'large'}]))
        self.assertEqual(calls,1)
        reply=next(m for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertFalse(any(p.get('status')=='quantity' for p in reply['result'].get('parts',[])),'model-interpreted ordinary egg does not return the saved-grams dead end')

    def test_bare_typo_cannot_apply_a_model_suggested_edit_to_previous_food(self):
        self.food('American cheese slice',amount=1,unit='serving')
        previous=self.message('2 american cheese slice')
        self.post(f"/api/food/thread/messages/{previous['id']}/process",{})
        reading={**self.reading([]),'intent':'correct','new_quantity':1,'target':None,'reply':'Updated.'}
        message,data,calls=self.routed('1 dgg',reading)
        self.assertEqual(calls,1)
        history=self.a.get('/api/food/thread').json()['messages']
        old=next(m for m in history if m.get('reply_to')==previous['id'])
        self.assertEqual(old['result']['parts'][0]['entries'][0]['amount'],2,'unknown food word never changes the earlier quantity')
        reply=next(m for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertNotEqual(reply['result'].get('kind'),'edit')

    def test_confident_exact_food_stays_immediate_without_context_call(self):
        self.food('Fictional beans',amount=1,unit='bowl')
        _,_,calls=self.routed('2 fictional beans',self.reading([{'name':'Fictional beans','quantity':2}]))
        self.assertEqual(calls,0)

    def test_context_ambiguity_keeps_tappable_owned_choices(self):
        self.food('Egg whites',amount=100,unit='g')
        reading=self.reading([{'name':'Egg','quantity':1,'reference_question':True}]);reading['reply']='Which egg did you mean?'
        message,data,calls=self.routed('1 egg',reading)
        part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertEqual(calls,1);self.assertEqual(part['status'],'choose')
        self.assertEqual([c['name'] for c in part['item']['choices']],['Egg whites'])
        self.assertEqual(part['item']['new_name'],'Egg');self.assertEqual(part['learn_phrase'],'1 egg')

    def test_single_food_i_egg_keeps_one_without_rewriting_pronouns(self):
        from app import food_memory_understand as contextual
        ctx={'sources':{},'stable':{'preferences':[]},'dynamic':{'recent_turns':[]}}
        reading=self.reading([{'name':'Egg','quantity':1}])
        self.assertEqual(contextual.clean(reading,'i egg',ctx)['foods'][0]['quantity'],1)
        self.assertIsNone(contextual.clean(reading,'I ate egg',ctx)['foods'][0]['quantity'])

    def test_ordinary_unit_mismatch_estimates_but_explicit_reference_still_asks(self):
        self.food('Plain yogurt',amount=1,unit='serving')
        def ask(uid,message,ctx,card):
            token=next(k for k,v in ctx['sources'].items() if v['name']=='Plain yogurt')
            return self.reading([{'name':'Plain yogurt','quantity':1,'unit':'pot','reference_token':token}]),{},'stand-in'
        for said,status in [('A pot of plain yogurt','unknown'),('A pot of my saved plain yogurt','description')]:
            message=self.message(said)
            with self.context_patches(ask):data=self.post(f"/api/food/thread/messages/{message['id']}/process",{})
            part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
            self.assertEqual(part['status'],status)
            if status=='unknown':self.assertEqual(part['text'],'1 pot of Plain yogurt');self.assertTrue(part['prefer_estimate'])
        message=self.post('/api/food/thread/messages',{'body':'Plain yogurt','client_id':str(uuid.uuid4()),'review_only':True,
            'draft_id':self.draft,'context':message['client_id']},status=201)['message']
        def answer(uid,message,ctx,card):
            result,raw,model=ask(uid,message,ctx,card);result['intent']='answer';return result,raw,model
        with self.context_patches(answer):data=self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertEqual(part['status'],'description','an inherited explicit reference never silently becomes an estimate')

    def test_ambiguous_saved_name_without_ai_is_a_choice_not_a_gram_question(self):
        self.food('Egg whites',amount=100,unit='g')
        message=self.message('1 egg')
        data=self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        reply=next(m for m in data['messages'] if m.get('reply_to')==message['id'])
        part=reply['result']['parts'][0]
        self.assertEqual(part['status'],'choose');self.assertTrue(part['item']['new_ok'])
        self.assertEqual(part['item']['new_name'],'egg');self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])

    def test_confirmed_plain_egg_choice_is_learned_for_this_owner(self):
        white=self.post('/api/food/foods',{'name':'Egg whites','serving_label':'1 serving','serving_g':100,'kcal':50})
        egg=self.post('/api/food/foods',{'name':'Egg large','serving_label':'1 egg','serving_g':50,'kcal':72})
        message=self.message('1 egg');self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        data=self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'pick':{'kind':'custom','id':egg['id']},'portion':{'count':1}})
        self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])
        review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[message['id']]})
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'breakfast'})
        with db.connect() as c:
            row=c.execute('SELECT templates FROM food_chat_aliases WHERE user_id=%s',(self.ids[0],)).fetchone()
            self.assertEqual(row['templates'][0]['id'],egg['id']);self.assertEqual(c.execute('SELECT count(*) AS n FROM food_chat_aliases WHERE user_id=%s',(self.ids[1],)).fetchone()['n'],0)
        self.draft=str(uuid.uuid4())
        _,data,calls=self.routed('1 egg',self.reading([{'name':'Egg','quantity':1}]))
        self.assertEqual(calls,0,'confirmed exact phrase avoids another model/catalog lookup')
        reply=next(m for m in data['messages'] if m.get('reply_to'))
        self.assertEqual(reply['result']['parts'][0]['entries'][0]['name'],'Egg large')

    def test_explicit_single_food_edit_stays_in_rules(self):
        self.food('Fictional beans',amount=1,unit='bowl')
        message=self.message('2 fictional beans');self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        _,_,calls=self.routed('make it 3',self.reading([]))
        self.assertEqual(calls,0)
        history=self.a.get('/api/food/thread').json()['messages'];reply=next(m for m in history if m.get('reply_to')==message['id'])
        self.assertEqual(reply['result']['parts'][0]['entries'][0]['amount'],3)

    def test_incompatible_explicit_edit_keeps_previous_amount(self):
        self.food('Egg',amount=1,unit='serving')
        previous=self.message('1 egg');self.post(f"/api/food/thread/messages/{previous['id']}/process",{})
        reading={**self.reading([]),'intent':'correct','new_quantity':2,'new_unit':'cup','target':'egg'}
        _,_,calls=self.routed('make egg 2 cups',reading)
        self.assertEqual(calls,1)
        reply=next(m for m in self.a.get('/api/food/thread').json()['messages'] if m.get('reply_to')==previous['id'])
        self.assertEqual(reply['result']['parts'][0]['entries'][0]['amount'],1)

    def test_logged_incompatible_unit_asks_without_crashing(self):
        from app import food_thread_edit as edits
        from fastapi import HTTPException
        fid=self.food('Rice',amount=100,unit='g')
        with db.connect() as c:
            row=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=%s',(self.ids[0],fid)).fetchone()
            with self.assertRaises(HTTPException) as raised:edits._scale(c,self.ids[0],row,{'count':2,'unit':'cup'})
        self.assertEqual(raised.exception.status_code,400)

    def test_household_edit_uses_the_multi_piece_serving_basis(self):
        from app import food_thread as T,food_thread_compose as C,food_thread_sources as S
        message=self.message('2 slices fictional toast')
        food={'name':'Fictional toast','source':'off','per100':{'kcal':400},'serving':{'label':'2 slices (50 g)','g':50}}
        draft=S.catalog_draft(food,{'count':2,'unit':'slice'},partial=True)
        with db.connect() as c:
            C.write(c,self.ids[0],T.locked_message(c,self.ids[0],message['id']),{'composed':True,'day':str(self.day),'meal':'breakfast',
                'parts':[{'index':0,'text':'Fictional toast','status':'ready','drafts':[draft],'entries':S.draft_entries([draft])}]})
        self.routed('make fictional toast 1 slice',self.reading([]))
        reply=next(m for m in self.a.get('/api/food/thread').json()['messages'] if m.get('reply_to')==message['id'])
        entry=reply['result']['parts'][0]['entries'][0]
        self.assertEqual((entry['amount'],entry['kcal']),(.5,100))

    def test_choice_learning_retains_original_amount_after_row_edit(self):
        egg=self.post('/api/food/foods',{'name':'Egg large','serving_label':'1 egg','serving_g':50,'kcal':72})
        message=self.message('1 dgg');self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        data=self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'pick':{'kind':'custom','id':egg['id']},'portion':{'count':1}})
        part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.post(f"/api/food/thread/messages/{message['id']}/edit-food",{'part':0,'entry':0,'expected':part['remove_token'],'amount':2})
        review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[message['id']]})
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'breakfast'})
        with db.connect() as c:
            template=c.execute('SELECT templates FROM food_chat_aliases WHERE user_id=%s',(self.ids[0],)).fetchone()['templates'][0]
            self.assertEqual(template['portion']['count'],1)
        self.draft=str(uuid.uuid4());message,data,calls=self.routed('1 dgg',self.reading([{'name':'Egg','quantity':1}]))
        self.assertEqual(calls,0)
        reply=next(m for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertEqual(reply['result']['parts'][0]['entries'][0]['amount'],1)

    def test_changed_choice_requires_fresh_review_and_deleted_choice_teaches_nothing(self):
        egg=self.post('/api/food/foods',{'name':'Egg large','serving_label':'1 egg','serving_g':50,'kcal':72})
        message=self.message('1 dgg');self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'pick':{'kind':'custom','id':egg['id']},'portion':{'count':1}})
        review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[message['id']]})
        with db.connect() as c:c.execute('UPDATE custom_foods SET kcal=80 WHERE user_id=%s AND id=%s',(self.ids[0],egg['id']))
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'breakfast'},status=409)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM food_chat_aliases WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],0)
            c.execute('DELETE FROM custom_foods WHERE user_id=%s AND id=%s',(self.ids[0],egg['id']))
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'breakfast'},status=404)
        self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])

    def test_catalog_choice_learns_confirmed_row_without_extra_food_creation(self):
        from app import food_thread as T,food_thread_compose as C
        message=self.message('1 dgg')
        food={'name':'Fictional egg','source':'usda','id':'999999999999','per100':{'kcal':140,'protein_g':12,'carbs_g':1,'fat_g':10},'serving':{'label':'1 egg','g':None}}
        with db.connect() as c:
            C.write(c,self.ids[0],T.locked_message(c,self.ids[0],message['id']),{'composed':True,'day':str(self.day),'meal':'breakfast',
                'parts':[{'index':0,'text':'1 dgg','status':'choose','catalog':[food],'entries':[]}]})
        data=self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'catalog':0})
        part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertEqual(part['status'],'quantity')
        data=self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'portion':{'grams':50}})
        part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.post(f"/api/food/thread/messages/{message['id']}/edit-food",{'part':0,'entry':0,'expected':part['remove_token'],'amount':100})
        review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[message['id']]})
        for _ in range(2):self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'breakfast'})
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],1)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM custom_foods WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],0)
            template=c.execute('SELECT templates FROM food_chat_aliases WHERE user_id=%s',(self.ids[0],)).fetchone()['templates'][0]
            self.assertEqual((template['kind'],template['portion']['count'],template['portion']['unit']),('food',50,'g'))

    def test_amount_snapshot_does_not_teach_a_changed_source(self):
        egg=self.post('/api/food/foods',{'name':'Egg large','serving_label':'1 egg','serving_g':50,'kcal':72})
        message=self.message('1 dgg');self.post(f"/api/food/thread/messages/{message['id']}/process",{})
        data=self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'pick':{'kind':'custom','id':egg['id']},'portion':{'count':1}})
        part=next(m['result']['parts'][0] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.post(f"/api/food/thread/messages/{message['id']}/edit-food",{'part':0,'entry':0,'expected':part['remove_token'],'amount':2})
        with db.connect() as c:c.execute('UPDATE custom_foods SET kcal=90 WHERE user_id=%s AND id=%s',(self.ids[0],egg['id']))
        review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[message['id']]})
        self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'breakfast'})
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_chat_aliases WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],0)

    def test_older_textless_draft_stepper_still_changes_only_the_named_food(self):
        from app import food_thread as T,food_thread_compose as C,food_thread_sources as S
        message=self.message('Fictional older draft')
        drafts=S.model_drafts({'items':[{'name':'Fictional grain','amount':'2 servings','kcal':200,'protein_g':8,'carbs_g':40,'fat_g':2},
                                      {'name':'Fictional fruit','amount':'1 serving','kcal':50,'protein_g':0,'carbs_g':12,'fat_g':0}]})
        with db.connect() as c:
            C.write(c,self.ids[0],T.locked_message(c,self.ids[0],message['id']),{'composed':True,'day':str(self.day),'meal':'lunch',
                'parts':[{'index':0,'status':'ready','drafts':drafts,'entries':S.draft_entries(drafts)}]})
        data=self.post(f"/api/food/thread/messages/{message['id']}/choose",{'part':0,'draft':0,'factor':1.5})
        entries=next(m['result']['parts'][0]['entries'] for m in data['messages'] if m.get('reply_to')==message['id'])
        self.assertEqual([(e['amount'],e['kcal']) for e in entries],[(3,300),(1,50)])
        self.assertEqual(self.a.get('/api/food/day').json()['entries'],[])
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_chat_aliases WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],0)

if __name__=='__main__':unittest.main(verbosity=2)
