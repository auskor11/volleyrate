"""Local server for the review pages and the browser detector, with HTTP Range support
so the video can seek. POST /save/<name> stores a browser detection result in
cache/<name>/web_result.json for comparison with Python.

Usage: .venv/bin/python serve.py            -> http://localhost:8765/review/
                                               http://localhost:8765/web/
"""
import os
import re
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m[1]) if m[1] else max(0, size - int(m[2]))
        end = min(int(m[2]), size - 1) if m[1] and m[2] else size - 1
        if start >= size:
            self.send_error(416)
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.remaining = end - start + 1
        return f

    def copyfile(self, src, dst):
        n = getattr(self, "remaining", None)
        if n is None:
            return super().copyfile(src, dst)
        try:
            while n > 0:
                chunk = src.read(min(1 << 20, n))
                if not chunk:
                    break
                dst.write(chunk)
                n -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser cancelled the request after seeking elsewhere

    def end_headers(self):
        if not self.headers.get("Range"):
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_POST(self):
        m = re.match(r"/save/([^/?]+)(?:\?(\w+))?$", self.path)
        if not m:
            self.send_error(404)
            return
        from urllib.parse import unquote
        name = unquote(m[1])
        out = os.path.join("cache", name)
        if os.path.sep in name or name.startswith(".") or not os.path.isdir(out):
            self.send_error(400)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        fname = f"web_result_{m[2]}.json" if m[2] else "web_result.json"
        with open(os.path.join(out, fname), "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    url = f"http://localhost:{PORT}/review/"
    print(f"Serving {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    ThreadingHTTPServer(("127.0.0.1", PORT), RangeHandler).serve_forever()
