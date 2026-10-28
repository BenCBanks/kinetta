"""Map configuration/CSP allowlists, with no provider calls, secrets or personal fixtures."""
import unittest
from fastapi.testclient import TestClient
from app import map_config as maps
from app.main import app

class Maps(unittest.TestCase):
    def test_personal_default_is_explicit_and_only_default_mentions_osmf(self):
        d=maps.settings({});self.assertTrue(d['personal_default']);self.assertEqual(d['kind'],'raster')
        r=TestClient(app).get('/api/map-config');self.assertEqual(r.status_code,200)
        self.assertEqual(set(r.json()),{'kind','url','dark_url','max_zoom','attribution','attribution_url','personal_default'})
        self.assertIn('max-age=300',r.headers['cache-control'])
    def test_operator_archive_has_narrow_hosts_and_no_osmf(self):
        d=maps.settings({'KINETTA_MAP_TILES':'https://maps.example.test/usa.pmtiles','IGNORED_STORAGE_SECRET':'fictional-never-publish'})
        self.assertEqual(d['kind'],'pmtiles');self.assertFalse(d['personal_default']);self.assertEqual(maps.origins(d),['https://maps.example.test'])
        self.assertNotIn('fictional-never-publish',str(d));self.assertNotIn('tile.openstreetmap.org',str(d))
    def test_raster_dark_template_and_provider_credit(self):
        d=maps.settings({'KINETTA_MAP_TILES':'https://maps.example.test/light/{z}/{x}/{y}.png','KINETTA_MAP_DARK_TILES':'https://night.example.test/dark/{z}/{x}/{y}.png','KINETTA_MAP_ATTRIBUTION':'Fictional tiles','KINETTA_MAP_ATTRIBUTION_URL':'https://example.test/credits'})
        self.assertEqual(maps.origins(d),['https://maps.example.test','https://night.example.test'])
    def test_invalid_settings_fail_instead_of_contacting_another_provider(self):
        bad=[{'KINETTA_MAP_KIND':'unknown'},{'KINETTA_MAP_TILES':'http://example.test/{z}/{x}/{y}.png'},
          {'KINETTA_MAP_TILES':'https://user:secret@example.test/{z}/{x}/{y}.png'},
          {'KINETTA_MAP_TILES':'https://example.test/{z}/{x}/{y}.png?secret=key'},
          {'KINETTA_MAP_TILES':'https://*.example.test/{z}/{x}/{y}.png'},
          {'KINETTA_MAP_TILES':'https://example.test/a.png'},
          {'KINETTA_MAP_TILES':'https://example.test/a.pmtiles','KINETTA_MAP_DARK_TILES':'https://example.test/{z}/{x}/{y}.png'},
          {'KINETTA_MAP_ATTRIBUTION':'<script>alert(1)</script>'}, {'KINETTA_MAP_MAX_ZOOM':'100'},
          {'KINETTA_MAP_TILES':'https://example.test;evil/{z}/{x}/{y}.png'}]
        for e in bad:
            with self.subTest(e=e),self.assertRaises(ValueError):maps.settings(e)
    def test_off_does_not_fall_back_to_public_tiles(self):
        d=maps.settings({'KINETTA_MAP_TILES':'off'});self.assertEqual(d['kind'],'off');self.assertEqual(maps.origins(d),[])

unittest.main(verbosity=2)
