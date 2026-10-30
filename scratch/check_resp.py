import urllib.request
import urllib.error

try:
    req = urllib.request.Request('http://localhost:8000/businesses/1/articles')
    with urllib.request.urlopen(req) as resp:
        print('Status:', resp.status)
        raw = resp.read()
        print('Raw length:', len(raw))
        print('Content:', raw[:300])
except urllib.error.HTTPError as e:
    print('HTTPError:', e.code, e.read().decode('utf-8', errors='ignore'))
except Exception as e:
    print('Other error:', e)
