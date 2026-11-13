import base64, io, json, math, struct, urllib.request, wave
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"".join(struct.pack("<h", int(8000*math.sin(2*math.pi*440*i/16000))) for i in range(16000)))
body = {"model": "nemotron_3_nano_omni", "max_tokens": 100,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "Describe this audio in one sentence."},
            {"type": "input_audio", "input_audio": {"data": base64.b64encode(buf.getvalue()).decode(), "format": "wav"}}]}]}
req = urllib.request.Request("http://localhost:8000/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
try:
    r = json.load(urllib.request.urlopen(req, timeout=120))
    print("AUDIO ACCEPTED:", r["choices"][0]["message"]["content"])
except urllib.error.HTTPError as e:
    print("AUDIO REJECTED", e.code, e.read().decode()[:500])
