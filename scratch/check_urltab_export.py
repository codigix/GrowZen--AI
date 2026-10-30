with open('frontend/src/platform/SeoUi.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

import re
m = re.search(r'export\s+(const|function)\s+useUrlTab\b', text)
print('Exported as const/function:', bool(m))
if not m:
    # check named exports at end
    print('useUrlTab in text:', 'useUrlTab' in text)
    for l in text.splitlines():
        if 'useUrlTab' in l:
            print(l)
