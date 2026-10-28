"""The real shipped app cannot reopen parked saved-route APIs; personal export/segments remain mounted."""
import unittest
from fastapi.testclient import TestClient
from app.main import app

class Retired(unittest.TestCase):
    def test_saved_surfaces_are_not_registered(self):
        paths={getattr(r,'path','') for r in app.routes}
        self.assertFalse(any('/planned-routes' in p or '/shared-routes' in p or '/shared-route-downloads' in p or '/route-reports' in p for p in paths))
        for path in ('/api/plan/services','/api/activities/{aid}/sections','/api/segments','/api/me/export'):
            if path!='/api/me/export':self.assertIn(path,paths)
        self.assertTrue(any('export' in p for p in paths))
        c=TestClient(app)
        for path in ('/api/planned-routes','/api/planned-routes/1','/api/shared-routes','/api/shared-routes/1','/api/admin/route-reports'):
            self.assertEqual(c.get(path).status_code,404,path)
    def test_old_links_reveal_no_saved_data(self):
        c=TestClient(app)
        html=c.get('/routes/shared/1').text
        self.assertNotIn('route-sharing.js',html)
        self.assertNotIn('route-following.js',html)
        self.assertEqual(c.get('/api/activities/1/sections').status_code,401)
        self.assertEqual(c.get('/api/plan/services').status_code,401)

unittest.main(verbosity=2)
