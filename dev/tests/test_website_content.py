"""Exercise the actual dependency-free Markdown renderer with owner edits."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('content',Path(__file__).resolve().parents[1]/'design/build_content.py')
content=importlib.util.module_from_spec(spec);spec.loader.exec_module(content)
class CopyTests(unittest.TestCase):
 def test_normal_copy_and_safe_links(self):
  self.assertEqual(content.inline('Your **workouts** and *food*.'),'Your <strong>workouts</strong> and <em>food</em>.')
  self.assertEqual(content.inline('[Training](training)'),'<a href="training">Training</a>')
  self.assertIn('&lt;script&gt;',content.inline('<script>alert(1)</script>'))
 def test_unsafe_destinations_rejected(self):
  for link in ['javascript:alert','data:text/html,x','//other.example']:
   with self.assertRaises(ValueError):content.inline('[bad]('+link+')')
 def test_every_template_key_has_copy(self):
  import re
  for template in (content.ROOT/'site/templates').glob('*.html'):
   required=set(re.findall(r'\{\{copy:([^}]+)\}\}',template.read_text()))
   present=set(re.findall(r'(?m)^## ([a-z0-9-]+)',(content.ROOT/'site/content'/template.with_suffix('.md').name).read_text()))
   self.assertTrue(required,template.name);self.assertEqual(required,present,template.name)
if __name__=='__main__':unittest.main()
