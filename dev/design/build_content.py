#!/usr/bin/env python3
"""Render editable Markdown copy into existing marketing layouts. No dependencies."""
from pathlib import Path
import html
import json
import hashlib
import re
import subprocess
ROOT = Path(__file__).resolve().parents[2]

def inline(text):
    # Raw HTML is escaped; links accept only safe web/mail or local destinations.
    links = []
    def link(m):
        label, url = m.groups()
        if not ((re.match(r'^(https?://|mailto:)', url) or re.match(r'^[a-zA-Z0-9_./#?=&%-]+$', url) and ':' not in url) and not url.startswith('//')):
            raise ValueError('Unsupported link destination: ' + url)
        links.append('<a href="' + html.escape(url, quote=True) + '">' + html.escape(label) + '</a>')
        return '\x00' + str(len(links)-1) + '\x00'
    text = re.sub(r'\[([^\]]+)\]\(([^\s)]+)\)', link, text)
    text = html.escape(text, quote=False)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', text)
    return re.sub('\x00(\\d+)\x00', lambda m: links[int(m[1])], text)

def render(source, entries):
    # An empty content entry removes its whole optional block, including media.
    source = re.sub(r'\{\{#copy:([a-z0-9-]+)\}\}(.*?)\{\{/copy:\1\}\}',
                    lambda m: m[2] if entries[m[1]] else '', source, flags=re.S)
    return re.sub(r'\{\{copy:([^}]+)\}\}', lambda m: entries[m[1]], source)

def build():
    for template in sorted((ROOT/'site/templates').glob('*.html')):
        md = (ROOT/'site/content'/template.with_suffix('.md').name).read_text()
        parts = re.split(r'(?m)^## ([a-z0-9-]+)\s*\n', md)
        keys = parts[1::2]
        if len(set(keys)) != len(keys): raise ValueError('Duplicate section key')
        entries = dict(zip(keys, (inline(' '.join(x.split())) for x in parts[2::2])))
        source = template.read_text()
        required = set(re.findall(r'\{\{(?:#|/)?copy:([^}]+)\}\}', source))
        if required != set(entries): raise ValueError(f'{template.name}: missing or unknown section keys')
        (ROOT/'site'/template.name).write_text(render(source, entries))
        if template.name == 'terms.html':
            # One editable document supplies both the website and the app's version gate.
            document = {'version': entries['version'], 'draft': entries['status'] != 'Published' or '[OWNER:' in md,
                        'sha256': hashlib.sha256(md.encode()).hexdigest(),
                        'url': 'https://kinetta.app/terms', 'privacy_url': 'https://kinetta.app/privacy'}
            (ROOT/'app/terms_document.json').write_text(json.dumps(document, indent=2)+'\n')

    subprocess.run(['node', str(ROOT/'dev/design/build_guide.js')], check=True)
    print('Website copy rendered from site/content/*.md')
if __name__ == '__main__': build()
