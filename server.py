#!/usr/bin/env python3
"""Loopback-only storage bridge and static browser client."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from ledger import Ledger, Conflict
from game import advance, describe

ROOT = Path(__file__).resolve().parent
INITIAL = {"name": "Moosenberg", "location": "tavern", "health": 100,
           "inventory": [], "flags": [], "visits": 0,
           "last_scene": "Ara wipes a glass that remembers rain. Narm is arguing with the fire again."}


def make_server(ledger, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def allowed(self, write=False):
            authority = "127.0.0.1:%s" % self.server.server_port
            origin = self.headers.get("Origin")
            if self.headers.get("Host") != authority:
                self.reply(403, {"error": "Unrecognized host"})
                return False
            if origin not in (None, "http://" + authority) or (write and origin is None):
                self.reply(403, {"error": "Use the local Red Door page"})
                return False
            return True

        def reply(self, status, payload, mime="application/json; charset=utf-8"):
            body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.allowed():
                return
            path = urlsplit(self.path).path
            if path == "/api/world":
                self.reply(200, {"world": ledger.latest(), "history": ledger.history(12),
                                 "storage": {"path": str(ledger.path), "bytes": ledger.path.stat().st_size}})
            elif path == "/api/terminal":
                world = ledger.latest()
                self.reply(200, {"world": world, "output": describe(world)})
            elif path == "/api/verify":
                try:
                    self.reply(200, ledger.verify())
                except ValueError as error:
                    self.reply(500, {"error": str(error)})
            elif path in ("/", "/app.js", "/style.css", "/terminal", "/terminal.js", "/terminal.css", "/vendor/hterm/index.js", "/vendor/libdot/index.js"):
                file, mime = {"/": ("index.html", "text/html; charset=utf-8"),
                              "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                              "/terminal": ("terminal.html", "text/html; charset=utf-8"),
                              "/terminal.js": ("terminal.js", "text/javascript; charset=utf-8"),
                              "/terminal.css": ("terminal.css", "text/css; charset=utf-8"),
                              "/vendor/hterm/index.js": ("vendor/hterm/index.js", "text/javascript; charset=utf-8"),
                              "/vendor/libdot/index.js": ("vendor/libdot/index.js", "text/javascript; charset=utf-8"),
                              "/style.css": ("style.css", "text/css; charset=utf-8")}[path]
                self.reply(200, (ROOT / "web" / file).read_bytes(), mime)
            else:
                self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if not self.allowed(write=True):
                return
            if self.path != "/api/commands":
                self.reply(404, {"error": "Not found"})
                return
            try:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("JSON is required")
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    raise ValueError("Invalid request size")
                request = json.loads(self.rfile.read(length))
                if not isinstance(request, dict):
                    raise ValueError("Request must be an object")
                if "state" in request:
                    raise ValueError("Send a command; the server owns world state")
                command = request.get("command")
                if not isinstance(command, str) or not 1 <= len(command) <= 128:
                    raise ValueError("A short command is required")
                command = command.strip().lower()
                receipt = ledger.apply(request.get("request_id"), request.get("expected_revision"),
                                       {"command": command}, lambda state: advance(state, command))
                self.reply(200, {"receipt": receipt, "output": describe(receipt)})
            except Conflict as error:
                self.reply(409, {"error": str(error)})
            except (ValueError, TypeError) as error:
                self.reply(400, {"error": str(error)})
            except Exception:
                self.reply(500, {"error": "Save failed. Reload the world to check its last committed state."})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--db", type=Path, default=Path.home()/".local/share/red-door-local/world.sqlite3")
    args = parser.parse_args()
    ledger = Ledger(args.db, INITIAL)
    ledger.verify()
    server = make_server(ledger, args.port)
    print("Red Door: http://127.0.0.1:%s" % server.server_port, flush=True)
    print("World ledger: %s" % ledger.path, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
