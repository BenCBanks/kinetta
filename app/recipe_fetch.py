"""Bounded public-HTTPS reads for explicit recipe imports. No proxy/cookie/auth support."""
import http.client
import ipaddress
import queue
import re
import socket
import ssl
import threading
import time
from urllib.parse import quote,urlsplit,urlunsplit,urljoin

MAX_BYTES=1024*1024
MAX_REDIRECTS=3
TIME_LIMIT=10
DNS_LIMIT=2
_fetch_slots=threading.BoundedSemaphore(4)
_dns_slots=threading.BoundedSemaphore(4)


class RecipeFetchError(ValueError):
    def __init__(self,code,message):super().__init__(message);self.code=code


def checked_url(value):
    if not isinstance(value,str):raise RecipeFetchError('invalid_url','Paste a public HTTPS recipe link.')
    value=value.strip()
    if not value or len(value)>2048 or any(ch.isspace() or ord(ch)<32 or ord(ch)==127 for ch in value):
        raise RecipeFetchError('invalid_url','Paste one public HTTPS recipe link.')
    try:
        p=urlsplit(value)
        if p.scheme.lower()!='https' or not p.hostname or p.username is not None or p.password is not None or p.port not in (None,443):raise ValueError()
        host=p.hostname.rstrip('.').encode('idna').decode('ascii').lower()
        if not host or len(host)>253 or '%' in host:raise ValueError()
        try:ipaddress.ip_address(host)
        except ValueError:
            if '.' not in host or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in host.split('.')):raise ValueError()
        authority='['+host+']' if ':' in host else host
        path=quote(p.path or '/',safe="/%:@!$&'()*+,;=-._~")
        query=quote(p.query,safe="/%?:@!$&'()*+,;=-._~")
        return urlunsplit(('https',authority,path,query,'')),host,path+('?' + query if query else '')
    except (ValueError,UnicodeError):raise RecipeFetchError('invalid_url','Use an HTTPS recipe link without a login or custom port.') from None


def _public(value):
    try:ip=ipaddress.ip_address(value)
    except ValueError:return False
    if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_loopback or ip.is_link_local or ip.is_unspecified:return False
    if isinstance(ip,ipaddress.IPv6Address):
        if ip.is_site_local or ip.sixtofour or ip.teredo:return False
        if ip.ipv4_mapped and not _public(str(ip.ipv4_mapped)):return False
        if ip in ipaddress.ip_network('64:ff9b::/96') or ip in ipaddress.ip_network('64:ff9b:1::/48'):return False
    return True


def _addresses(host,deadline):
    try:literal=ipaddress.ip_address(host)
    except ValueError:literal=None
    if literal:addresses=[str(literal)]
    else:
        dns_slots=_dns_slots
        if not dns_slots.acquire(blocking=False):raise RecipeFetchError('busy','Recipe links are busy. Try again shortly, or paste the ingredients.')
        result=queue.Queue(maxsize=1)
        def resolve():
            try:result.put((True,socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
            except Exception:result.put((False,None))
            finally:dns_slots.release()
        try:threading.Thread(target=resolve,daemon=True).start()
        except RuntimeError:
            dns_slots.release()
            raise RecipeFetchError('busy','Recipe links are busy. Try again shortly, or paste ingredients.') from None
        try:ok,rows=result.get(timeout=max(.01,min(DNS_LIMIT,deadline-time.monotonic())))
        except queue.Empty:raise RecipeFetchError('timeout','The recipe site took too long. Try a screenshot or paste the ingredients.') from None
        if not ok or not rows or len(rows)>64:raise RecipeFetchError('unavailable','That public recipe site could not be reached. Try a screenshot or paste ingredients.')
        addresses=list(dict.fromkeys(row[4][0] for row in rows))
    if not addresses or not all(_public(ip) for ip in addresses):raise RecipeFetchError('unsafe_address','Recipe links must use public internet addresses.')
    return sorted(addresses,key=lambda value:ipaddress.ip_address(value).version)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self,host,address,deadline):
        self.tls=ssl.create_default_context();self.address=address;self.deadline=deadline
        super().__init__(host,443,context=self.tls,timeout=self.remaining())

    def remaining(self):
        left=self.deadline-time.monotonic()
        if left<=0:raise TimeoutError()
        return min(3,left)

    def connect(self):
        # The socket uses the validated IP. TLS certificate/SNI and Host keep the
        # original hostname; a second DNS resolution cannot redirect the socket.
        raw=socket.create_connection((self.address,443),timeout=self.remaining())
        try:
            raw.settimeout(self.remaining())
            self.sock=self.tls.wrap_socket(raw,server_hostname=self.host)
        except BaseException:raw.close();raise


def fetch(value):
    """Return bounded HTML and the final URL, in memory only. The caller authenticates/rate-limits first."""
    url,_,_=checked_url(value)
    if not _fetch_slots.acquire(blocking=False):raise RecipeFetchError('busy','Recipe links are busy. Try again shortly, or paste the ingredients.')
    deadline=time.monotonic()+TIME_LIMIT;current=[None];expired=threading.Event()
    def abort():
        conn=current[0]
        sock=conn.sock if conn else None
        if sock:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
        if conn:
            try:conn.close()
            except OSError:pass
    def timeout():expired.set();abort()
    timer=threading.Timer(TIME_LIMIT,timeout);timer.daemon=True;timer.start()
    try:
        for hop in range(MAX_REDIRECTS+1):
            url,host,target=checked_url(url)
            address=_addresses(host,deadline)[0]
            if expired.is_set() or time.monotonic()>=deadline:raise TimeoutError()
            conn=_PinnedHTTPS(host,address,deadline);current[0]=conn
            conn.request('GET',target,headers={'User-Agent':'KinettaRecipe/1.0 (+https://kinetta.app)','Accept':'text/html, application/xhtml+xml','Accept-Encoding':'identity','Connection':'close'})
            response=conn.getresponse()
            try:
                if response.status in (301,302,303,307,308):
                    location=response.getheader('Location')
                    if not location or hop==MAX_REDIRECTS:raise RecipeFetchError('redirect','That recipe link redirects too many times. Try its final page or a screenshot.')
                    url=checked_url(urljoin(url,location))[0]
                    continue
                if response.status!=200:raise RecipeFetchError('unavailable','The recipe site did not provide a readable page. Try a screenshot or paste ingredients.')
                kind=(response.getheader('Content-Type') or '').split(';')[0].strip().lower()
                if kind not in ('text/html','application/xhtml+xml'):raise RecipeFetchError('unsupported','That link is not an HTML recipe page. Try a screenshot or paste ingredients.')
                if (response.getheader('Content-Encoding') or 'identity').lower()!='identity':raise RecipeFetchError('unsupported','That page cannot be read safely. Try a screenshot or paste ingredients.')
                length=response.getheader('Content-Length')
                if length is not None and (not length.isdecimal() or int(length)>MAX_BYTES):raise RecipeFetchError('too_large','That page is too large. Try a screenshot or paste the ingredients.')
                chunks=[];size=0
                while True:
                    if expired.is_set() or time.monotonic()>=deadline:raise TimeoutError()
                    if conn.sock:conn.sock.settimeout(max(.01,min(3,deadline-time.monotonic())))
                    chunk=response.read1(min(65536,MAX_BYTES-size+1))
                    if not chunk:break
                    size+=len(chunk)
                    if size>MAX_BYTES:raise RecipeFetchError('too_large','That page is too large. Try a screenshot or paste the ingredients.')
                    chunks.append(chunk)
                charset=(response.headers.get_content_charset() or 'utf-8').lower()
                if charset not in ('utf-8','utf8','iso-8859-1','latin-1','windows-1252','cp1252'):charset='utf-8'
                return {'url':url,'html':b''.join(chunks).decode('utf-8-sig' if charset in ('utf-8','utf8') else charset,errors='replace')}
            finally:response.close();conn.close()
        raise RecipeFetchError('redirect','That recipe link could not be followed safely.')
    except RecipeFetchError:raise
    except (OSError,TimeoutError,http.client.HTTPException,ValueError,UnicodeError):
        raise RecipeFetchError('timeout' if expired.is_set() or time.monotonic()>=deadline else 'unavailable','The recipe could not be read. Try a screenshot or paste the ingredients.') from None
    finally:timer.cancel();abort();_fetch_slots.release()
