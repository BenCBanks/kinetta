"""Canonical preset examples and malformed-input bounds, without app/provider imports."""
import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from app.intervals import definition

def step(id,action,kind,amount,unit,role='effort'):
 return dict(id=id,action=action,role=role,title='',target=dict(kind=kind,amount=amount,unit=unit))
def example(kind='time',mixed=False,omit=False):
 steps=[step('run','run',kind,'400' if kind=='distance' else '3','m' if kind=='distance' else 'min'),step('walk','walk','time' if mixed else kind,'1' if mixed or kind=='time' else '100','min' if mixed or kind=='time' else 'm','recovery')]
 block=dict(id='main',repeat=3,steps=steps)
 if omit:block['omit_final_recovery']='walk'
 return dict(schema=1,name='Demo intervals',description='',blocks=[block])
class ContractTests(unittest.TestCase):
 def test_exact_examples(self):
  for raw,n,t,m in [(example(),6,720,0),(example(omit=True),5,660,0),(example('distance'),6,0,1500),(example('distance',mixed=True),6,180,1200)]:
   p=definition(raw);self.assertEqual((len(p['steps']),p['totals']['seconds'],p['totals']['metres']),(n,t,m))
  raw=example();raw['blocks'].insert(0,dict(id='warm',repeat=1,steps=[step('warm-walk','walk','time','5','min','warmup')]))
  raw['blocks'].append(dict(id='cool',repeat=1,steps=[step('cool-walk','walk','time','5','min','cooldown')]))
  self.assertEqual(definition(raw)['totals']['seconds'],1320)
 def test_units_order_and_identity(self):
  raw=example('distance');raw['blocks'][0]['steps'][0]['target']=dict(kind='distance',amount='1.000',unit='mi')
  p=definition(raw);self.assertEqual(p['steps'][0]['target'],1609.344);self.assertEqual(p['definition']['blocks'][0]['steps'][0]['target']['amount'],'1')
  self.assertEqual(p['content_hash'],definition(p['definition'])['content_hash'])
  raw=example();raw['blocks'][0]['steps'].reverse();self.assertEqual(definition(raw)['steps'][0]['action'],'walk')
 def test_rejects_malformed_without_mutation(self):
  mutations=[lambda p:p.update(schema=True),lambda p:p['blocks'][0].update(repeat=True),lambda p:p['blocks'][0].update(repeat=1.5),lambda p:p['blocks'][0].update(repeat=101),lambda p:p['blocks'][0].update(omit_final_recovery='run'),lambda p:p['blocks'][0]['steps'][1].update(id='run'),lambda p:p['blocks'][0]['steps'][0]['target'].update(kind={}),lambda p:p['blocks'][0]['steps'][0]['target'].update(amount='NaN'),lambda p:p['blocks'][0]['steps'][0]['target'].update(amount='0'),lambda p:p['blocks'][0]['steps'][0]['target'].update(amount='-1'),lambda p:p['blocks'][0]['steps'][0]['target'].update(amount='1e3'),lambda p:p['blocks'][0]['steps'][0].update(target={}),lambda p:p.update(blocks=[])]
  for mutate in mutations:
   p=example();mutate(p);before=copy.deepcopy(p)
   with self.assertRaises(ValueError):definition(p)
   self.assertEqual(p,before)
 def test_expansion_and_aggregate_limits(self):
  p=example();p['blocks'][0]['repeat']=100;p['blocks'][0]['steps']*=6
  # Repeated authored IDs are rejected before they can make an ambiguous plan.
  with self.assertRaises(ValueError):definition(p)
  p=example();p['blocks'][0]['steps'][0]['target']['amount']='360';p['blocks'][0]['repeat']=5
  with self.assertRaises(ValueError):definition(p)
 def test_shared_fixtures(self):
  for row in json.loads((Path(__file__).parent/'fixtures/interval_presets.json').read_text()):
   p=definition(row['pin']['definition']);self.assertEqual(p['content_hash'],row['pin']['content_hash']);self.assertEqual(p['steps'],row['expected_steps'])
if __name__=='__main__':unittest.main()
