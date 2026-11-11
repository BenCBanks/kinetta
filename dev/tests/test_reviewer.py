"""Offline reviewer boundaries; no network, Apple requests or real accounts."""
import contextlib,datetime as dt,importlib.util,io,json,pathlib,sys,unittest,xml.etree.ElementTree as ET
from unittest.mock import patch
from urllib.error import HTTPError
spec=importlib.util.spec_from_file_location('reviewer',pathlib.Path(__file__).parents[1]/'demo/reviewer.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'dev/tests'))
sys.path.insert(0,str(ROOT/'dev/demo'))
integration_spec=importlib.util.spec_from_file_location('reviewer_integration',pathlib.Path(__file__).with_name('test_reviewer_integration.py'));I=importlib.util.module_from_spec(integration_spec);integration_spec.loader.exec_module(I)
BASE='https://fictional.example';LOGIN='review_round1';CONF=f'CREATE REVIEW DEMO ON {BASE} FOR {LOGIN}'
class ReviewerChecks(unittest.TestCase):
 def test_integration_confirmation_precedes_guard_or_credentials(self):
  with patch.object(I,'guard_target',side_effect=AssertionError('No Docker inspection before confirmation')),contextlib.redirect_stdout(io.StringIO()):
   self.assertEqual(I.main(['--url','http://127.0.0.1:8798','--project','kt-review-demo','--confirm','wrong']),1)
 def test_rejected_integration_guard_precedes_auth_and_seed(self):
  base='http://127.0.0.1:8798';project='kt-review-demo';confirmation=I.expected_confirmation(base,project)
  output=io.StringIO()
  with patch.object(I,'guard_target',side_effect=ValueError('fixture mismatch')),patch.object(I,'admin_headers',side_effect=AssertionError('No auth')),patch.object(I.reviewer,'API',side_effect=AssertionError('No API')),patch.object(I.reviewer,'seed',side_effect=AssertionError('No seed')),contextlib.redirect_stdout(output):
   self.assertEqual(I.main(['--url',base,'--project',project,'--confirm',confirmation]),1)
  self.assertIn('marked disposable',output.getvalue())
 def test_confirmation_before_any_password_or_network(self):
  output=io.StringIO()
  with patch.object(R.getpass,'getpass',side_effect=AssertionError('No credential prompt')),patch.object(R,'API',side_effect=AssertionError('No network')),contextlib.redirect_stdout(output):
   self.assertEqual(R.main(['--server',BASE,'--reviewer',LOGIN,'--admin','operator','--confirm','wrong']),1)
  self.assertNotIn(BASE,output.getvalue());self.assertNotIn(LOGIN,output.getvalue())
  self.assertEqual(R.validate(BASE+'/',LOGIN,CONF),(BASE,LOGIN,LOGIN+'_friend'))
 def test_server_and_names(self):
  for server in ('http://external.example','https://name:secret@fictional.example','https://fictional.example/path','https://fictional.example?token=secret','https://fictional.example#fragment','file:///tmp/a','https://fictional.example:0'):
   with self.assertRaises(R.Refused):R.server_origin(server)
  for name in ('alex','review_','review_abcdefghijklm','review_../a','review_Upper'):
   with self.assertRaises(R.Refused):R.validate(BASE,name,CONF)
  self.assertEqual(R.server_origin('http://127.0.0.1:8798'),'http://127.0.0.1:8798')
 def test_existing_account_refuses_before_any_write(self):
  for occupied in (LOGIN,LOGIN+'_friend'):
   class Admin:
    def get(self,path):return {'pages':1,'rows':[{'login':occupied}]} if occupied in path else {'pages':1,'rows':[]}
    def post(self,*args):raise AssertionError('No writes on collision')
   with self.assertRaises(R.Refused):R.seed(Admin(),BASE,LOGIN,LOGIN+'_friend','fictional password')
 def test_does_not_enroll_mfa(self):
  class Admin:
   def post(self,path,body):
    assert path=='/api/admin/login';return {'enrollment':True,'setup_key':'private-test-seed'}
  with self.assertRaises(R.Refused) as e:R.admin_signin(Admin(),'operator','private-password',lambda:(_ for _ in ()).throw(AssertionError('No code')))
  self.assertNotIn('private',str(e.exception))
 def test_redirects_and_errors_do_not_expose_credentials(self):
  self.assertIsNone(R.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example'))
  api=R.API(BASE)
  with patch.object(api.opener,'open',side_effect=HTTPError(BASE,401,'private-password-response',{},io.BytesIO(b'private-token'))):
   with self.assertRaises(R.Refused) as e:api.post('/api/login',{'password':'private-password'})
  self.assertNotIn('private',str(e.exception));self.assertIn('HTTP401',str(e.exception))
 def test_routes_are_fictional_and_timed(self):
  ns={'g':'http://www.topografix.com/GPX/1/1'};root=ET.fromstring(R.fictional_gpx(dt.date(2026,1,1),3));pts=root.findall('.//g:trkpt',ns);self.assertEqual(len(pts),241)
  self.assertTrue(all(abs(float(p.attrib['lat']))<.02 and abs(float(p.attrib['lon']))<.02 for p in pts));times=[p.find('g:time',ns).text for p in pts];self.assertEqual(times,sorted(times));self.assertNotEqual(R.fictional_gpx(dt.date(2026,1,1),0),R.fictional_gpx(dt.date(2026,1,2),0))
if __name__=='__main__':unittest.main()
