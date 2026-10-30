FILE = r'c:\Users\DELL\Documents\GitHub\GrowZen--AI\backend\app\services\articles.py'

with open(FILE, 'r', encoding='utf-8') as f:
    text = f.read()

old_httpx = "import httpx"
new_httpx = """try:
    import httpx
except ImportError:
    import requests as httpx"""

if old_httpx in text:
    text = text.replace(old_httpx, new_httpx, 1)
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(text)
    print("Safely wrapped httpx import")
else:
    print("httpx already wrapped or not found")
