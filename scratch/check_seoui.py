with open('frontend/src/platform/SeoUi.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find('useUrlTab')
if idx != -1:
    print(text[idx:idx+350])
else:
    print('useUrlTab not found in SeoUi.jsx')
