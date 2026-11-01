"""Capture the published app's public basemap contract; no accounts or private runtime access."""
import json
import os
from pathlib import Path
import sys
import urllib.request
from urllib.parse import urlsplit

PUBLIC_CONFIG='https://login.kinetta.app/api/map-config'
def capture_env(config):
    if config.get('kind') not in ('pmtiles','vector'):
        raise ValueError('Published capture source must be an operator-controlled vector basemap')
    fields={'url':'KINETTA_MAP_TILES','kind':'KINETTA_MAP_KIND','dark_url':'KINETTA_MAP_DARK_TILES',
            'attribution':'KINETTA_MAP_ATTRIBUTION','attribution_url':'KINETTA_MAP_ATTRIBUTION_URL','max_zoom':'KINETTA_MAP_MAX_ZOOM'}
    values={env:str(config.get(key,'')) for key,env in fields.items()}
    for value in values.values():
        if len(value)>1200 or '\n' in value or '\r' in value:raise ValueError('Invalid public map setting')
    for key in ('url','dark_url','attribution_url'):
        if not config.get(key):continue
        url=urlsplit(config[key])
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.hostname.endswith('tile.openstreetmap.org'):
            raise ValueError('Capture source must be public HTTPS without credentials or OSM tile-service use')
    values['KINETTA_SCREENSHOT_MAP_ORIGIN']='https://login.kinetta.app'
    return values

if __name__=='__main__':
    with urllib.request.urlopen(urllib.request.Request(PUBLIC_CONFIG,headers={'User-Agent':'Kinetta fictional capture setup'}),timeout=20) as response:
        config=json.load(response)
    values=capture_env(config)
    if len(sys.argv)==3 and sys.argv[1]=='--output':Path(sys.argv[2]).write_text(json.dumps(values))
    else:
        with Path(os.environ['GITHUB_ENV']).open('a') as output:
            for key,value in values.items():output.write(key+'='+value+'\n')
    print('Public vector map settings prepared for the disposable capture; no account data read')
