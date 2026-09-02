#!/usr/bin/env python3
"""Serve local model and audio files for speech recognition mochitests.

Adds CORS headers so test pages at mochi.test:8888 can fetch from this server.

Prerequisites (Linux headless): PipeWire + pipewire-pulse + wireplumber must be
running with XDG_RUNTIME_DIR set, and a null audio sink must be active.
A helper script that sets this up:

  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  mkdir -p $XDG_RUNTIME_DIR
  pipewire &
  pipewire-pulse &
  wireplumber &
  sleep 2
  python3 testing/tools/serve_model.py &
  XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR ./mach mochitest --headless \
      dom/media/webspeech/recognition/test/test_parakeet_e2e.html

Usage:
  python3 testing/tools/serve_model.py
"""

import http.server
import os

PORT = 8766
SERVE_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        # Lets runtests.py tell this server apart from an unrelated process
        # that happens to already be listening on the port (e.g. a server
        # left over from a previous, ungracefully-terminated test run).
        self.send_header("X-Parakeet-Model-Server", "1")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress per-request noise


os.chdir(SERVE_ROOT)

print(f"Serving from {SERVE_ROOT} on port {PORT}", flush=True)
print(
    f"Model: http://localhost:{PORT}/cstr/parakeet-tdt-0.6b-v3-GGUF/main/parakeet-tdt-0.6b-v3-q4_k.gguf",
    flush=True,
)
print(f"Audio: http://localhost:{PORT}/kennedy-appolo.opus", flush=True)

httpd = http.server.ThreadingHTTPServer(("localhost", PORT), CORSHandler)
httpd.serve_forever()
