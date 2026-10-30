import urllib.request
import json

try:
    with urllib.request.urlopen('http://localhost:8000/api/v1/businesses/1/articles') as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print('Backend /api/v1/businesses/1/articles responded!')
        print('Keys:', data.keys())
        articles = data.get('articles', [])
        print('Total articles:', len(articles))
        for a in articles[:3]:
            print(f"- ID {a['id']}: {a['keyword']} ({a['status']})")
except Exception as e:
    print('Error:', e)
