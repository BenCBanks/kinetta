"""Real URLSession redirect test, fictional archive bytes, loopback only."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import subprocess
import sys
from threading import Thread, Lock

received, sinks = [], []
lock = Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_PUT(self): self.handle_request()
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def handle_request(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        with lock:
            if self.path.startswith('/redirect/'):
                _, _, code, dest = self.path.split('/')
                received.append((int(code), dest, body))
                self.send_response(int(code))
                host = primary if dest == 'same' else sink
                self.send_header('Location', f'http://127.0.0.1:{host.server_port}/sink')
            else:
                sinks.append((body, self.headers.get('Authorization')))
                self.send_response(200)
        self.send_header('Content-Length', '0');self.end_headers()
primary = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
sink = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
try:
    for server in [primary, sink]: Thread(target=server.serve_forever, daemon=True).start()
    subprocess.run(sys.argv[1:] + [f'http://127.0.0.1:{primary.server_port}'], check=True, timeout=120)
    assert len(received) == 10 and all(body == bytes([42])*4096 for _, _, body in received)
    assert not sinks, 'No redirected endpoint may receive bytes, headers, or a request'
    print('Real transport: ten original uploads, zero redirected requests/credentials/bytes PASS')
finally:
    primary.shutdown();sink.shutdown();primary.server_close();sink.server_close()
