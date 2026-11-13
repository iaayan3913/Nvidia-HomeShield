import base64, io, json, struct, urllib.request, zlib
def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
img = base64.b64encode(png(64, 64, (20, 20, 20))).decode()
body = {"model": "nemotron_3_nano_omni", "max_tokens": 100,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "What colour is this image? One sentence."},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + img}}]}]}
req = urllib.request.Request("http://localhost:8000/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
try:
    r = json.load(urllib.request.urlopen(req, timeout=120))
    print("IMAGE ACCEPTED:", r["choices"][0]["message"]["content"])
except urllib.error.HTTPError as e:
    print("IMAGE REJECTED", e.code, e.read().decode()[:500])
