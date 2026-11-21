"""Exercise the actual dependency-free Markdown renderer with owner edits."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('content',Path(__file__).resolve().parents[1]/'design/build_content.py')
content=importlib.util.module_from_spec(spec);spec.loader.exec_module(content)
class CopyTests(unittest.TestCase):
 def test_website_has_no_private_by_default_claim(self):
  import re
  root=content.ROOT/'site'
  for path in [*root.glob('*.html'),*root.glob('templates/*.html'),*root.glob('content/*.md')]:
   self.assertNotRegex(path.read_text().lower(),r'private\s+by\s+default',str(path.relative_to(root)))
 def test_home_training_proof_includes_routes_and_lifting_records(self):
  home=(content.ROOT/'site/index.html').read_text()
  self.assertIn('Every run, ride and lift, with the details.',home)
  self.assertIn('See a route and splits for a run or ride, or set-by-set history and records for a lift.',home)
 def test_home_challenges_uses_positive_copy_and_privacy_details_stay_in_policy(self):
  home=(content.ROOT/'site/index.html').read_text()
  for text in ['Distance','Active days','activities','food logging days','protein goal days']:
   self.assertIn(text,home)
  self.assertIn('Bring friends together around',home)
  self.assertNotIn('never sends a friend request',home)
  self.assertNotIn('not your food details or protein target',home)
  privacy=(content.ROOT/'site/privacy.html').read_text()
  self.assertIn('A group\'s workout totals include your activity only when you choose',privacy)
  self.assertIn('Food challenges share logging-day or protein-goal-day counts',privacy)
  self.assertIn('assets/tour/challenge-start-light.webp',home)
  self.assertIn('assets/tour/challenge-start-dark.webp',home)
  self.assertIn('assets/tour/challenge-detail-light.webp',home)
  self.assertIn('assets/tour/challenge-detail-dark.webp',home)
  self.assertNotRegex(home.lower(),r'private\s+by\s+default|free\s+during\s+beta')
 def test_kit_week_demo_copy_and_social_tagline_are_positive(self):
  home=(content.ROOT/'site/index.html').read_text()
  self.assertIn('Yes, mostly: your completed-week running trend is up over the last 8 weeks. This week is still in progress at 4.8 mi.',home)
  self.assertIn('This week · Run',home)
  self.assertIn('Weekly average · Run',home)
  self.assertIn('Best week · Run',home)
  self.assertIn('data-week-this>4.8</b>',home)
  self.assertIn('data-week-average>20.6</b>',home)
  self.assertIn('data-week-best>27.9</b>',home)
  self.assertIn('Completed weekly run totals rise across 8 weeks',home)
  self.assertNotIn('data-week-this>0.0</b>',home)
  self.assertIn('data-week-chart',home)
  self.assertIn('kit-week-chart-line',home)
  self.assertIn('kit-phone-status-icons',home)
  self.assertNotIn('What Kit could check',home)
  self.assertNotIn('One week alone cannot establish a lasting trend.',home)
  self.assertNotIn('Confirm lunch',home)
  self.assertNotIn('Lunch logged',home)
  self.assertIn('2 foods - ~',home)
  self.assertIn('Add to log',home)
  self.assertEqual(home.count('class="kit-chat-stepper" aria-hidden="true"'),2)
  self.assertNotIn('data-chat-check',home)
  self.assertIn('Review the matched foods, portions and estimate, then choose Add to log.',home)
  self.assertNotIn('Kit logs the matched foods',home)
  self.assertNotIn('Your weekly run total is 10.8 mi',home)
  self.assertNotIn('Fictional week · sample response',home)
  self.assertNotIn('Fictional Kit insight screen · sample week',home)
  friends=(content.ROOT/'site/friends.html').read_text()
  self.assertIn('Made for the people you move with',friends)
  self.assertNotIn('Made for people, not metrics',friends)
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
 def test_about_uses_one_framed_fictional_app_screen(self):
  import re
  parts=re.split(r'(?m)^## ([a-z0-9-]+)\s*\n',(content.ROOT/'site/content/about.md').read_text())
  entries=dict(zip(parts[1::2],(content.inline(' '.join(x.split())) for x in parts[2::2])))
  template=(content.ROOT/'site/templates/about.html').read_text()
  page=content.render(template,entries)
  self.assertIn('assets/shots/light-today.webp',page)
  self.assertIn('assets/shots/dark-today.webp',page)
  self.assertEqual(page.count('class="frame"'),1)
  self.assertNotIn('assets/about/ben-and-rachel',page)
  self.assertNotIn('about-couple',page)
  self.assertIn('mailto:feedback@kinetta.app',page)
  self.assertNotIn('{{',page)
  words=' '.join(entries[k] for k in ['about-story','about-feedback'])
  self.assertTrue(40<=len(words.split())<=90)
  self.assertNotRegex(words.lower(),r'\bads?\b|ad-free|privacy|sell|data')
  self.assertEqual(page.count('class="site-capabilities"'),1)
  self.assertEqual(page.count('class="site-capabilities"'),1)
 def test_about_and_privacy_are_linked_from_every_footer_and_guide_is_retired(self):
  import re
  for template in (content.ROOT/'site/templates').glob('*.html'):
   md=(content.ROOT/'site/content'/template.with_suffix('.md').name).read_text()
   parts=re.split(r'(?m)^## ([a-z0-9-]+)\s*\n',md)
   entries=dict(zip(parts[1::2],(content.inline(' '.join(x.split())) for x in parts[2::2])))
   source=content.render(template.read_text(),entries)
   footer=source.split('<footer>')[1]
   self.assertRegex(footer,r'<a href="about">About us</a>',template.name)
   self.assertNotIn('Feature guide',footer,template.name)
   self.assertRegex(footer,r'<a href="privacy">Privacy(?: policy)?</a>',template.name)
   header=source.split('</header>')[0]
   nav=re.search(r'<nav class="tabs" aria-label="Primary">(.*?)</nav>',header,re.S)
   self.assertIsNotNone(nav,template.name)
   links=re.findall(r'<a href="([^"]+)"[^>]*>([^<]+)</a>',nav.group(1))
   expected=[('compare','Features'),('https://login.kinetta.app/','Sign in')] if template.name=='index.html' else [('./','Home'),('compare','Features'),('https://testflight.apple.com/join/YAX1JnwB','iPhone beta')]
   self.assertEqual(links,expected,template.name)
   self.assertNotIn('Guide',nav.group(1),template.name)
  legacy=(content.ROOT/'site/404.html').read_text()
  self.assertIn("'/guide', '/guide.html'",legacy)
  self.assertIn("location.replace('/compare')",legacy)
  self.assertFalse((content.ROOT/'site/guide.html').exists())
 def test_about_photos_have_no_embedded_metadata(self):
  import struct
  for name in ['ben-and-rachel']:
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
