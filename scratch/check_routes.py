import urllib.request
import json

try:
    with urllib.request.urlopen('http://localhost:8000/openapi.json') as resp:
        spec = json.loads(resp.read().decode('utf-8'))
        print('Total routes in spec:', len(spec.get('paths', {})))
        for path in sorted(spec.get('paths', {}).keys()):
            if 'article' in path:
                print('Article route:', path)
except Exception as e:
    print('Error:', e)
