"""Fictional recipes and network stand-ins only; never contacts a website."""
import email.message
import ipaddress
import json
import pathlib
import socket
import sys
import threading
import time
import unittest
from unittest.mock import patch,Mock
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'app'))
import recipe_fetch as f
import recipe_schema as s

FIX=pathlib.Path(__file__).parent/'fixtures'/'recipes'
URL='https://recipes.example/bowls'

class Parser(unittest.TestCase):
    def test_optional_nutrition_forms(self):
        for value in (240,'240','240 kcal'):
            self.assertEqual(s._quantity(value,'kcal'),240)
        for value in (240,'240',True):self.assertIsNone(s._quantity(value,'g'))
        self.assertEqual(s._quantity('1,200 mg','mg'),1200)
        self.assertIsNone(s._quantity('1,20 mg','mg'))
        self.assertIsNone(s._quantity(True,'kcal'))
    def test_published(self):
        r=s.parse((FIX/'published.html').read_text(),URL)[0]
        self.assertEqual(r['servings'],6);self.assertFalse(r['needs_servings_review'])
        self.assertEqual(r['name'],'Lemon & bean bowls');self.assertEqual(r['nutrition']['fiber'],5)
        self.assertEqual(r['nutrition']['sodium'],300);self.assertEqual(r['nutrition']['sugar'],0)
        self.assertEqual(r['nutrition_basis'],'site_per_serving');self.assertEqual(r['source_url'],URL)
        self.assertNotIn('instructions',r);self.assertEqual(r['nutrition']['calories'],210)
    def test_missing_and_ambiguous(self):
        r=s.parse((FIX/'missing.html').read_text(),URL)[0]
        self.assertIsNone(r['servings']);self.assertTrue(r['needs_servings_review'])
        self.assertEqual(r['yield_text'],['12 cubes']);self.assertTrue(all(v is None for v in r['nutrition'].values()))
        self.assertIsNone(r['nutrition_basis'])
    def test_odd_units_multiple_malformed(self):
        a,b=s.parse((FIX/'odd.html').read_text(),URL)
        self.assertEqual(a['name'],'Fictional oat pot');self.assertEqual(a['servings'],2)
        self.assertEqual(a['nutrition']['calories'],100);self.assertEqual(a['nutrition']['protein'],1.2)
        for key in ('carbs','fat','sugar'):self.assertIsNone(a['nutrition'][key])
        self.assertEqual(a['nutrition_text']['carbs'],'less than 1 g');self.assertIsNone(b['servings'])
    def test_no_schema_or_executed_content(self):
        self.assertEqual(s.parse('<script src="https://evil.example/recipe.js"></script><p>no data</p>',URL),[])
        self.assertEqual(s.parse('<script type="application/ld+json">{"@type":"Recipe","name":"no ingredients"}</script>',URL),[])
        self.assertEqual(s.parse('<script type="application/ld+json">'+('['*1500)+']'*1500+'</script>',URL),[])
    def test_resource_bounds_duplicates_types(self):
        r={'@type':'Recipe','name':'Fictional soup','recipeYield':'3 people','recipeIngredient':['1 g fictional food']}
        page=lambda data:'<script type="application/ld+json">'+json.dumps(data)+'</script>'
        self.assertEqual(len(s.parse(page([r,r]),URL)),1)
        self.assertEqual(len(s.parse(page([dict(r,name=str(n)) for n in range(10)]),URL)),5)
        self.assertEqual(s.parse(page(dict(r,recipeIngredient=['x']*61)),URL),[])
        with self.assertRaises(s.RecipeSchemaError):s.parse('x'*(1024*1024+1),URL)
        with self.assertRaises(s.RecipeSchemaError):s.parse(page([{}]*5001),URL)
        self.assertEqual(s.parse('<script type></script>'+page(r),URL)[0]['servings'],3)

class Response:
    def __init__(self,status=200,body=b'<p>fictional</p>',headers=None):
        self.status=status;self.body=body;self.closed=False;self.headers=email.message.Message()
        for k,v in (headers or {'Content-Type':'text/html; charset=utf-8'}).items():self.headers[k]=v
    def getheader(self,key):return self.headers.get(key)
    def read1(self,size):part,self.body=self.body[:size],self.body[size:];return part
    def close(self):self.closed=True

class Connection:
    responses=[];created=[]
    def __init__(self,host,address,deadline):self.host=host;self.address=address;self.sock=Mock();self.created.append(self);self.closed=False
    def request(self,method,path,headers):self.requested=(method,path,headers)
    def getresponse(self):return self.responses.pop(0)
    def close(self):self.closed=True

class Fetch(unittest.TestCase):
    def setUp(self):
        Connection.responses=[];Connection.created=[]
        self.conn=patch.object(f,'_PinnedHTTPS',Connection);self.conn.start()
        self.dns=patch.object(socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]);self.resolver=self.dns.start()
    def tearDown(self):self.conn.stop();self.dns.stop()
    def fail_code(self,url,code):
        with self.assertRaises(f.RecipeFetchError) as caught:f.fetch(url)
        self.assertEqual(caught.exception.code,code)
    def test_reject_bad_urls_before_network(self):
        for url in ('http://recipes.example/','https://u:p@recipes.example/','https://recipes.example:8443/','file:///etc/passwd','https://localhost/','https://recipes.example/\r\nsecret','https://[fe80::1%25eth0]/','https://bad_host.example/'):
            self.fail_code(url,'invalid_url')
        self.resolver.assert_not_called();self.assertEqual(Connection.created,[])
    def test_private_reserved_and_transition_addresses(self):
        for ip in ('127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','224.0.0.1','192.0.2.1','::1','fc00::1','fe80::1','ff02::1','2001:db8::1','::ffff:127.0.0.1','64:ff9b::a00:1','2002:0808:0808::1'):
            host='['+ip+']' if ':' in ip else ip
            self.fail_code('https://'+host+'/','unsafe_address')
        self.assertEqual(Connection.created,[])
    def test_mixed_dns_and_rebinding_redirect(self):
        self.resolver.return_value=[(2,1,6,'',('8.8.8.8',443)),(2,1,6,'',('10.0.0.1',443))]
        self.fail_code(URL,'unsafe_address');self.assertEqual(Connection.created,[])
        self.resolver.side_effect=[[(2,1,6,'',('8.8.8.8',443))],[(2,1,6,'',('127.0.0.1',443))]]
        Connection.responses=[Response(302,headers={'Location':'/next'})]
        self.fail_code(URL,'unsafe_address');self.assertEqual(len(Connection.created),1)
        self.assertTrue(Connection.created[0].closed)
    def test_redirect_private_and_http_and_limit(self):
        for location,code in [('https://10.0.0.1/','unsafe_address'),('http://recipes.example/','invalid_url'),('https://user:pass@recipes.example/','invalid_url')]:
            Connection.responses=[Response(302,headers={'Location':location})];self.fail_code(URL,code)
        Connection.responses=[Response(302,headers={'Location':'/again'}) for _ in range(4)]
        self.fail_code(URL,'redirect')
    def test_limits_and_content(self):
        for response,code in [(Response(headers={'Content-Type':'image/png'}),'unsupported'),(Response(headers={'Content-Type':'text/html','Content-Encoding':'gzip'}),'unsupported'),(Response(headers={'Content-Type':'text/html','Content-Length':str(f.MAX_BYTES+1)}),'too_large'),(Response(body=b'x'*(f.MAX_BYTES+1)),'too_large'),(Response(403),'unavailable')]:
            Connection.responses=[response];self.fail_code(URL,code);self.assertTrue(response.closed)
    def test_headers_url_and_memory_only(self):
        Connection.responses=[Response(302,headers={'Location':'/final#x'}),Response(body=b'\xef\xbb\xbf<p>fictional</p>')]
        r=f.fetch(URL);self.assertEqual(r,{'url':'https://recipes.example/final','html':'<p>fictional</p>'})
        c=Connection.created[-1];self.assertEqual(c.address,'8.8.8.8');self.assertEqual(c.host,'recipes.example')
        self.assertEqual(set(c.requested[2]),{'User-Agent','Accept','Accept-Encoding','Connection'})
        self.assertEqual(f.checked_url(' https://RECIPES.example/café?q=é#ignored ')[0],'https://recipes.example/caf%C3%A9?q=%C3%A9')
        self.assertTrue(all(c.closed for c in Connection.created))
    def test_dns_timeout_and_concurrency_release(self):
        done=threading.Event()
        def slow(*args,**kwargs):done.wait(.2);return [(2,1,6,'',('8.8.8.8',443))]
        self.resolver.side_effect=slow
        with patch.object(f,'DNS_LIMIT',.02):self.fail_code(URL,'timeout')
        done.set();self.resolver.side_effect=None
        with patch.object(f,'_fetch_slots',threading.BoundedSemaphore(0)):self.fail_code(URL,'busy')
        with patch.object(f,'_dns_slots',threading.BoundedSemaphore(0)):self.fail_code(URL,'busy')
        Connection.responses=[Response()];self.assertIn('html',f.fetch(URL))
    def test_deadline_trickle_shutdown(self):
        class Slow(Response):
            def read1(self,size):time.sleep(.025);return b'x'
        Connection.responses=[Slow()]
        started=time.monotonic()
        with patch.object(f,'TIME_LIMIT',.06):self.fail_code(URL,'timeout')
        self.assertLess(time.monotonic()-started,.3)
        Connection.created[-1].sock.shutdown.assert_called()
    def test_tls_socket_pinned_and_cert_hostname(self):
        self.conn.stop()
        try:
            tls=Mock();raw=Mock()
            with patch.object(f.ssl,'create_default_context',return_value=tls),patch.object(f.socket,'create_connection',return_value=raw) as connect:
                c=f._PinnedHTTPS('recipes.example','8.8.8.8',time.monotonic()+2);c.connect()
                self.assertEqual(connect.call_args.args[0],('8.8.8.8',443))
                tls.wrap_socket.assert_called_once_with(raw,server_hostname='recipes.example')
                self.assertIs(c.sock,tls.wrap_socket.return_value)
        finally:self.conn.start()

if __name__=='__main__':unittest.main()
