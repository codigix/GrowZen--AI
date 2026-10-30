import urllib.request

try:
    resp = urllib.request.urlopen('http://localhost:3100/src/platform/ContentStudioPage.jsx')
    text = resp.read().decode('utf-8')
    print('Vite served ContentStudioPage.jsx successfully, length:', len(text))
    assert 'AI Draft' in text
    assert 'Quality Gate' in text
    assert 'useUrlTab' in text
    print('ALL ASSERTIONS PASSED!')
except Exception as e:
    print('Error:', e)
