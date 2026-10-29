"""Public, non-secret basemap settings. Data licence and permission to use a tile service are separate."""
import os,re
from urllib.parse import urlsplit
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router=APIRouter()
DEFAULT_TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
OSM_CREDIT='© OpenStreetMap contributors'


def _url(value, template=False):
    if not value:return ''
    if len(value)>1000 or any(ord(c)<33 or c in "\"'<>;\\" for c in value):raise ValueError('Invalid map URL')
    u=urlsplit(value)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ValueError('Map URLs must be public HTTPS URLs without credentials, query keys or fragments')
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?',u.hostname):raise ValueError('Map host must be an explicit DNS name or IPv4 address')
    if not template and ('{' in u.path or '}' in u.path):raise ValueError('Archive URLs cannot contain tile placeholders')
    if u.port not in (None,443):raise ValueError('Map URLs must use HTTPS port 443')
    if template and not all('{'+k+'}' in u.path for k in ('z','x','y')):raise ValueError('Tile templates need {z}, {x} and {y}')
    if '{' in re.sub(r'\{[zxy]\}','',u.path) or '}' in re.sub(r'\{[zxy]\}','',u.path):raise ValueError('Unsupported map URL placeholder')
    return value


def settings(env=None):
    e=os.environ if env is None else env
    if e.get('KINETTA_MAP_KIND','').strip() and not e.get('KINETTA_MAP_TILES','').strip():
        raise ValueError('KINETTA_MAP_TILES is required when KINETTA_MAP_KIND is set')
    url=e.get('KINETTA_MAP_TILES','').strip() or DEFAULT_TILES
    kind=e.get('KINETTA_MAP_KIND','').strip() or ('pmtiles' if url.endswith('.pmtiles') else 'raster')
    if kind not in ('pmtiles','vector','raster'):raise ValueError('KINETTA_MAP_KIND must be pmtiles, vector or raster')
    if url.lower()=='off':return dict(kind='off',url='',dark_url='',max_zoom=19,attribution=OSM_CREDIT,attribution_url='',personal_default=False)
    _url(url,kind!='pmtiles')
    dark=_url(e.get('KINETTA_MAP_DARK_TILES','').strip(),kind=='raster')
    if dark and kind!='raster':raise ValueError('Dark tile URL is for raster sources; vector maps use built-in themes')
    credit=e.get('KINETTA_MAP_ATTRIBUTION','').strip()
    if len(credit)>160 or '<' in credit or '>' in credit or any(ord(c)<32 for c in credit):raise ValueError('Map attribution must be plain text up to 160 characters')
    link=_url(e.get('KINETTA_MAP_ATTRIBUTION_URL','').strip())
    try:zoom=int(e.get('KINETTA_MAP_MAX_ZOOM','') or 19)
    except ValueError:raise ValueError('Map maximum zoom must be an integer') from None
    if not 3<=zoom<=22:raise ValueError('Map maximum zoom must be between 3 and 22')
    return dict(kind=kind,url=url,dark_url=dark,max_zoom=zoom,attribution=credit,attribution_url=link,personal_default=url==DEFAULT_TILES)


CONFIG=settings()  # Invalid configuration fails startup; never silently falls back to another provider.


def origins(config=CONFIG):
    return sorted({f'{urlsplit(u).scheme}://{urlsplit(u).netloc}' for u in (config['url'],config['dark_url']) if u})


@router.get('/api/map-config')
def map_config():
    return JSONResponse(CONFIG,headers={'Cache-Control':'public, max-age=300'})
