"""Size words describe the portion, not the food: '1 medium chicken breast' finds chicken breast (28 October 2026).
The USDA search is a fictional stand-in; nothing leaves the container."""
from unittest.mock import patch
from app import meal_chat

FOODS = [{'name': 'Chicken, breast, boneless, skinless, raw', 'generic': True, 'source': 'usda'},
         {'name': 'Chicken breast, roll, oven-roasted', 'generic': True, 'source': 'usda'},
         {'name': 'Egg, whole, raw', 'generic': True, 'source': 'usda'}]
seen = []
def search(q):
    seen.append(q); return FOODS
with patch.object(meal_chat, '_search_usda', search), patch.object(meal_chat, '_search_off', lambda q: []):
    for text in ('1 medium chicken breast', 'a large chicken breast', 'chicken breast', '2 small chicken breasts'):
        r = meal_chat.lookup(text)
        assert r['kind'] == 'plain' and r['foods'][0]['name'].startswith('Chicken, breast'), (text, r)
        assert 'medium' not in r['query'] and 'large' not in r['query'] and 'small' not in r['query'], r['query']
    assert meal_chat.lookup('2 large eggs')['foods'][0]['name'] == 'Egg, whole, raw'
    r = meal_chat.lookup('1 medium')            # a size alone is not a food: unchanged behaviour, no match
    assert r['kind'] == 'none', r
print('Food lookup: size words (small/medium/large) stay with the portion, not the search; chicken breast and eggs match PASS')

# Real cache SQL with original fictional values; provider work is always a local stand-in.
import threading,time,unittest,uuid
from concurrent.futures import ThreadPoolExecutor
from app import api_food as F,db


class CatalogCache(unittest.TestCase):
 def setUp(self):
  self.prefix='zz_test_catalog_'+uuid.uuid4().hex;self.keys=[];self.release=[];self.last=F._last_off[0]
 def key(self,suffix=''):
  key=self.prefix+suffix;self.keys.append(key);return key
 def tearDown(self):
  for event in self.release:event.set()
  def pending():
   with F._catalog_lock:return any(key[0] in self.keys for key in F._catalog_flights)
  until=time.monotonic()+2
  while pending() and time.monotonic()<until:time.sleep(.01)
  self.assertFalse(pending(),'Background cache work did not finish')
  F._last_off[0]=self.last
  with db.connect() as c:c.execute('DELETE FROM food_cache WHERE key=ANY(%s)',(self.keys,))
 def test_identical_misses_fetch_once_and_return_independent_values(self):
  key=self.key();entered=threading.Event();release=threading.Event();self.release.append(release);calls=[]
  def fetch():
   calls.append(1);entered.set();release.wait(2);return [{'per100':{'kcal':100}}]
  with ThreadPoolExecutor(6) as pool:
   pending=[pool.submit(F._cached,key,fetch) for _ in range(6)]
   self.assertTrue(entered.wait(1));time.sleep(.05);release.set();values=[f.result(2) for f in pending]
  self.assertEqual(len(calls),1);values[0][0]['per100']['kcal']=999
  self.assertTrue(all(v[0]['per100']['kcal']==100 for v in values[1:]))
  self.assertEqual(F._cached(key,lambda:self.fail('Warm cache fetched again'))[0]['per100']['kcal'],100)
 def test_shared_failure_is_not_cached_and_retry_succeeds(self):
  key=self.key();entered=threading.Event();release=threading.Event();self.release.append(release);calls=[]
  def fail():
   calls.append(1);entered.set();release.wait(2);raise OSError('fictional provider unavailable')
  with ThreadPoolExecutor(4) as pool:
   pending=[pool.submit(F._cached,key,fail) for _ in range(4)]
   self.assertTrue(entered.wait(1));time.sleep(.05);release.set()
   errors=[]
   for result in pending:
    with self.assertRaises(F.CatalogUnavailable) as error:result.result(2)
    errors.append(error.exception)
  self.assertEqual(len(calls),1);self.assertEqual(len({id(e) for e in errors}),4)
  with db.connect() as c:self.assertIsNone(c.execute('SELECT 1 FROM food_cache WHERE key=%s',(key,)).fetchone())
  self.assertEqual(F._cached(key,lambda:{'ready':True}),{'ready':True})
 def test_empty_results_keep_existing_no_cache_policy(self):
  key=self.key();calls=[]
  def fetch():calls.append(1);return []
  self.assertEqual(F._cached(key,fetch),[]);self.assertEqual(F._cached(key,fetch),[]);self.assertEqual(len(calls),2)
 def test_caller_deadline_does_not_wait_for_blocked_worker_shutdown(self):
  key=self.key();release=threading.Event();self.release.append(release)
  started=time.monotonic()
  with F.catalog_budget(time.monotonic()+.1):
   with self.assertRaises(F.CatalogUnavailable):F._cached(key,lambda:(release.wait(2),{'late':True})[1])
  self.assertLess(time.monotonic()-started,.6);release.set()
 def test_pacing_lock_is_part_of_the_same_budget(self):
  query=self.prefix;self.keys.append('off2-search:'+query.lower());F._off_pace.acquire();started=time.monotonic()
  try:
   with patch.object(F,'_get',side_effect=AssertionError('No provider should start')) as provider:
    with F.catalog_budget(time.monotonic()+.1):
     with self.assertRaises(F.CatalogUnavailable):F._search_off(query)
    provider.assert_not_called()
  finally:F._off_pace.release()
  self.assertLess(time.monotonic()-started,.6)
 def test_different_queries_still_keep_provider_spacing(self):
  F._last_off[0]=0;times=[];queries=[self.prefix+' one',self.prefix+' two']
  self.keys.extend('off2-search:'+q.lower() for q in queries)
  product={'code':'0000000000000','product_name':'Fictional oats','nutriments':{'energy-kcal_100g':380,'proteins_100g':13,'carbohydrates_100g':66,'fat_100g':7}}
  def get(*a,**k):times.append(time.monotonic());return {'hits':[product]}
  with patch.object(F,'_get',side_effect=get),patch.object(F,'OFF_INTERVAL',.12):
   with ThreadPoolExecutor(2) as pool:values=list(pool.map(F._search_off,queries))
  self.assertTrue(all(values));self.assertEqual(len(times),2);self.assertGreaterEqual(abs(times[1]-times[0]),.1)
 def test_fetch_capacity_is_bounded_without_queuing_more_work(self):
  entered=threading.Event();release=threading.Event();self.release.append(release);one=self.key(' one');two=self.key(' two')
  def fetch():entered.set();release.wait(2);return {'ready':True}
  with patch.object(F,'_catalog_slots',threading.BoundedSemaphore(1)):
   with ThreadPoolExecutor(1) as pool:
    first=pool.submit(F._cached,one,fetch);self.assertTrue(entered.wait(1))
    started=time.monotonic()
    with self.assertRaises(F.CatalogUnavailable):F._cached(two,lambda:self.fail('Excess work was queued'))
    self.assertLess(time.monotonic()-started,.2);release.set();self.assertEqual(first.result(2),{'ready':True})
 def test_direct_http_has_a_total_budget_even_for_an_uncooperative_read(self):
  release=threading.Event();self.release.append(release);finished=threading.Event()
  class Response:
   def __enter__(self):return self
   def __exit__(self,*a):finished.set()
   def read(self):release.wait(2);return b'{}'
  with patch('urllib.request.urlopen',return_value=Response()):
   started=time.monotonic()
   with F.catalog_budget(time.monotonic()+.1):
    with self.assertRaises(F.CatalogUnavailable):F._get('https://example.invalid')
   self.assertLess(time.monotonic()-started,.6);release.set();self.assertTrue(finished.wait(1))


unittest.main()
