import os, sys
os.chdir('backend')
sys.path.insert(0, '.')
from app.db import SessionLocal
from app.models import Article, Business
from app.services import site_preview

db = SessionLocal()
a = db.query(Article).filter(Article.id == 31).first()
b = db.query(Business).filter(Business.id == a.business_id).first()
res = site_preview.build(db, b, a, view='post', title=a.title, excerpt=a.meta_description or '', body=a.body, image=None, url='', primary=a.keyword, secondary=[], highlight=False)
html = res.get('html', '')

with open('temp_preview.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Saved temp_preview.html')
