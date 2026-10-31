"""Stamp disposable web output from content, shared by Docker and Capacitor.

Source files keep placeholders. Canonicalising generated values makes rebuilding
an already stamped tree identical, without a clock, git checkout or random value.
"""
import argparse
import hashlib
from html import escape, unescape
from pathlib import Path
import re
import tempfile
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ASSET = '__ASSET_HASH__'
SHELL = '__SHELL_HASH__'
REFERENCE = re.compile(r'(?P<attribute>\b(?:src|href)\s*=\s*)(?P<quote>[\"\'])(?P<url>[^\"\']+)(?P=quote)')
SHELL_LINE = re.compile(r"const SHELL = 'fit-shell-[^']+';")
STATIC_VERSION = re.compile(r'/static/(?P<name>[A-Za-z0-9_./-]+)\?v=(?:__ASSET_HASH__|[A-Za-z0-9_-]+)')


def digest(data):
    return hashlib.sha256(data).hexdigest()[:32]


def references(text, version):
    def replace(match):
        url=urlsplit(unescape(match['url']))
        if url.scheme or url.netloc:return match[0]
        if url.path=='/manifest.webmanifest':name='manifest.webmanifest'
        elif url.path.startswith('/static/'):name=url.path[len('/static/'):]
        else:return match[0]
        if not name or Path(name).as_posix()!=name or '..' in Path(name).parts:raise ValueError('Invalid static reference')
        query=[(key,value) for key,value in parse_qsl(url.query,keep_blank_values=True) if key!='v']
        query.append(('v',version(name)))
        result=urlunsplit(('', '', url.path, urlencode(query), url.fragment))
        return match['attribute']+match['quote']+escape(result,quote=True)+match['quote']
    return REFERENCE.sub(replace,text)


def build(source, output):
    source,output=Path(source).resolve(),Path(output).resolve()
    files={}
    for path in sorted(source.rglob('*')):
        if path.is_symlink():raise ValueError('Static source must not contain symlinks')
        if not path.is_file():continue
        name=path.relative_to(source).as_posix();data=path.read_bytes()
        if path.suffix=='.html':data=references(data.decode('utf-8'),lambda _:ASSET).encode('utf-8')
        if path.suffix in ('.html','.js','.css','.webmanifest','.json','.svg'):
            data=STATIC_VERSION.sub(lambda m:'/static/'+m['name']+'?v='+ASSET,data.decode('utf-8')).encode('utf-8')
        if name=='sw.js':
            text,count=SHELL_LINE.subn("const SHELL = 'fit-shell-"+SHELL+"';",data.decode('utf-8'))
            if count!=1:raise ValueError('Expected one service-worker shell name')
            data=text.encode('utf-8')
        files[name]=data
    if 'index.html' not in files or 'sw.js' not in files:raise ValueError('Missing web entry or service worker')
    shell=digest(b''.join(name.encode('utf-8')+b'\0'+bytes.fromhex(digest(data)) for name,data in files.items()))
    if source!=output and output.exists() and any(output.iterdir()):raise ValueError('Build output must be empty')
    hashes={};built={};visiting=set()
    def materialise(name):
        if name not in files:raise ValueError('Missing referenced static file: '+name)
        if name in visiting:raise ValueError('Circular static version references: '+name)
        if name in built:return hashes[name]
        visiting.add(name);data=files[name]
        if name.endswith('.html'):
            data=references(data.decode('utf-8'),materialise).encode('utf-8')
        if Path(name).suffix in ('.html','.js','.css','.webmanifest','.json','.svg'):
            data=STATIC_VERSION.sub(lambda m:'/static/'+m['name']+'?v='+materialise(m['name']),data.decode('utf-8')).encode('utf-8')
        if name=='sw.js':data=data.replace(SHELL.encode(),shell.encode())
        visiting.remove(name);built[name]=data;hashes[name]=digest(data)
        return hashes[name]
    for name in files:materialise(name)
    for name,data in built.items():
        target=output/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    return {'shell':'fit-shell-'+shell,'assets':hashes}


def runtime_copy(source):
    """Direct uvicorn development must not serve source placeholders as cache keys.

    Docker already contains stamped output, so it needs no extra copy. The caller
    holds the returned TemporaryDirectory for the lifetime of the process.
    """
    source=Path(source)
    if ASSET not in (source/'index.html').read_text() and SHELL not in (source/'sw.js').read_text():return None
    output=tempfile.TemporaryDirectory(prefix='kinetta-static-')
    try:build(source,Path(output.name))
    except Exception:
        output.cleanup();raise
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();result=build(args.source,args.output)
    print(result['shell'])
