"""Contract guards for ingredient ambiguity; synthetic model actions, no provider calls."""
import unittest,uuid
from unittest.mock import patch
from app import auth,db,api_dishes as D,cook_chat as C

class Clarification(unittest.TestCase):
 def setUp(self):
  with db.connect() as c:
   self.uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_clarify_'+uuid.uuid4().hex[:12],'Fictional cook',auth.hash_pw('green teapot on the hill'))).fetchone()['id']
   c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(self.uid,))
  self.user={'id':self.uid};self.did=D.dish_add(D.DishIn(name='Fictional ingredient test'),user=self.user)['id']
 def tearDown(self):
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(self.uid,))
 def say(self,text,previous=None):return C.say(self.did,C.SayIn(text=text,previous=previous),user=self.user)
 def test_unknown_weight_and_vague_correction_never_call_model(self):
  with patch.object(C,'ai_actions',side_effect=AssertionError('No guessing')):
   for text in ('rice','2 apples','remove it'):
    r=self.say(text);self.assertEqual(r['by'],'clarification');self.assertEqual(r['added'],[])
  with patch.object(C,'_ai_ready',return_value=False):
   self.assertEqual(self.say('100 g',previous='rice')['query'],'100 g rice')
 def test_legacy_ai_household_size_is_not_treated_as_user_supplied(self):
  mem={'apple':{'name':'Apple','source':'ai','units':{'each':180},'per100':{'kcal':50}}}
  self.assertIsNone(C.from_memory('2 apples',mem))
  self.assertEqual(C.from_memory('200 g apples',mem)[0]['grams'],200)
 def test_model_cannot_change_identity_weight_or_duplicate_an_ingredient(self):
  valid={'op':'add','name':'Quinoa','amount':'1 bowl','grams':200,'kcal':240,'protein_g':8,'carbs_g':42,'fat_g':4}
  with patch.object(C,'_ai_ready',return_value=True),patch.object(C.food_photo,'brake'),patch.object(C,'ai_actions') as model:
   for actions in ([{**valid,'grams':250}],[{**valid,'name':'Rice'}],[valid,valid]):
    model.return_value=(actions,'Fictional estimate')
    r=self.say('200 g quinoa');self.assertEqual(r['by'],'clarification');self.assertEqual(r['dish']['items'],[])
   model.return_value=([valid],'Fictional estimate')
   r=self.say('200 g quinoa');self.assertEqual(len(r['added']),1);it=r['dish']['items'][0]
   self.assertEqual(it['grams'],200);self.assertEqual(it['amount'],'200 g');self.assertEqual(it['units'],{})
   model.return_value=([{'op':'remove','id':'different'}],'Wrong ingredient')
   r=self.say('remove quinoa');self.assertEqual(r['by'],'clarification');self.assertEqual(len(r['dish']['items']),1)

unittest.main()
