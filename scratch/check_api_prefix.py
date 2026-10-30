import urllib.request
import json

try:
    req = urllib.request.Request('http://localhost:8000/api/businesses/1/articles')
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print('Backend /api/businesses/1/articles responded!')
        articles = data.get('articles', [])
        print(f'Total articles: {len(articles)}')
        for a in articles[:3]:
            print(f" - ID: {a['id']}, Keyword: {a['keyword']}, Status: {a['status']}, Title: {a.get('title')}")
except Exception as e:
    print('Backend request result:', e)
