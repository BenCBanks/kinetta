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
   required=set(re.findall(r'\{\{(?:#|/)?copy:([^}]+)\}\}',template.read_text()))
   present=set(re.findall(r'(?m)^## ([a-z0-9-]+)',(content.ROOT/'site/content'/template.with_suffix('.md').name).read_text()))
   self.assertTrue(required,template.name);self.assertEqual(required,present,template.name)
 def test_secondary_about_photo_can_be_removed_in_one_content_entry(self):
  import re
  parts=re.split(r'(?m)^## ([a-z0-9-]+)\s*\n',(content.ROOT/'site/content/about.md').read_text())
  entries=dict(zip(parts[1::2],(content.inline(' '.join(x.split())) for x in parts[2::2])))
  template=(content.ROOT/'site/templates/about.html').read_text()
  enabled=content.render(template,entries)
  self.assertIn('alt="Ben and Rachel by the river"',enabled)
  entries['about-couple-photo']=''
  removed=content.render(template,entries)
  self.assertNotIn('assets/about/ben-and-rachel',removed)
  self.assertNotIn('class="about-couple"',removed)
  self.assertIn('alt="Ben, who makes Kinetta"',removed)
  self.assertIn('mailto:feedback@kinetta.app',removed)
  self.assertNotIn('{{',removed)
  words=' '.join(entries[k] for k in ['about-story','about-feedback'])
  self.assertTrue(60<=len(words.split())<=90)
  self.assertNotRegex(words.lower(),r'\bads?\b|ad-free|privacy|sell|data')
  self.assertNotIn('<ul',enabled)
 def test_about_is_linked_only_from_every_footer(self):
  for template in (content.ROOT/'site/templates').glob('*.html'):
   source=template.read_text()
   self.assertIn('<a href="about">About us</a>',source.split('<footer>')[1],template.name)
   self.assertNotIn('href="about"',source.split('</header>')[0],template.name)
  self.assertNotIn('class="about"',(content.ROOT/'site/templates/index.html').read_text())
 def test_about_photos_have_no_embedded_metadata(self):
  import struct
  for name in ['ben','ben-and-rachel']:
   for extension in ['jpg','webp']:
    with self.subTest(name=name,extension=extension):
     data=(content.ROOT/f'site/assets/about/{name}.{extension}').read_bytes()
     self.assertLess(len(data),100_000)
     if extension=='jpg':
      self.assertEqual(data[:2],b'\xff\xd8')
      offset=2
      while data[offset:offset+2]!=b'\xff\xda':
       self.assertEqual(data[offset],255)
       # APP1 can contain EXIF/GPS or XMP; neither belongs in public photos.
       self.assertNotEqual(data[offset+1],0xe1)
       offset+=2+struct.unpack('>H',data[offset+2:offset+4])[0]
     else:
      self.assertEqual(data[:4],b'RIFF');self.assertEqual(data[8:12],b'WEBP')
      offset=12
      while offset<len(data):
       self.assertNotIn(data[offset:offset+4],[b'EXIF',b'XMP ',b'ICCP'])
       size=struct.unpack('<I',data[offset+4:offset+8])[0]
       offset+=8+size+(size%2)
if __name__=='__main__':unittest.main()
