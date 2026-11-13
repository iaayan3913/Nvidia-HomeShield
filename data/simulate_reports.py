import argparse, time, urllib.request, json
def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--url", default="http://127.0.0.1:8001/api/reports"); parser.add_argument("--interval", type=float, default=30)
    args = parser.parse_args()
    while True:
        body = json.dumps({"text": "Black mould in a child's bedroom", "property_id": "p-001"}).encode()
        request = urllib.request.Request(args.url, body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(request): pass
        time.sleep(args.interval)
if __name__ == "__main__": main()
