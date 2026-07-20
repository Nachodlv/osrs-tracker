#!/usr/bin/env python3
"""Serves this folder as a static site, plus a same-origin proxy at
/api/hiscores?player=NAME (the OSRS hiscores endpoint sends no CORS headers,
so the browser can't call it directly).

Usage: python server.py [port]   (defaults to 8791)
Then open http://localhost:8791/index.html
"""

import http.server
import os
import socketserver
import sys
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_PORT = 8791
HISCORES_URL = "https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player="


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/hiscores":
            self.handle_hiscores(parsed.query)
            return
        super().do_GET()

    def handle_hiscores(self, query):
        params = urllib.parse.parse_qs(query)
        player = (params.get("player") or [""])[0].strip()
        if not player:
            self.send_json_error(400, "Missing ?player=name")
            return

        url = HISCORES_URL + urllib.parse.quote(player)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                self.send_json_error(404, "Player not found on the hiscores")
            else:
                self.send_json_error(502, "Hiscores lookup failed (HTTP %s)" % e.code)
        except Exception as e:
            self.send_json_error(502, "Hiscores lookup failed: %s" % e)

    def send_json_error(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(('{"error": %s}' % repr(message).replace("'", '"')).encode())


class ReusableServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    # An explicit argv port wins; PORT lets a launcher assign a free one.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT") or DEFAULT_PORT)
    server = ReusableServer(("", port), Handler)
    print(f"Serving Iron Tracker on http://localhost:{port}/index.html")
    print("Hiscores sync available at /api/hiscores?player=NAME")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
