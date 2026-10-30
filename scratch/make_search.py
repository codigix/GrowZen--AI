with open('scratch/search_text.py', 'w', encoding='utf-8') as f:
    f.write('''import os

for root, dirs, files in os.walk('.'):
    if 'node_modules' in root or '.git' in root or 'venv' in root or '.system_generated' in root:
        continue
    for file in files:
        if file.endswith(('.jsx', '.js', '.py')):
            p = os.path.join(root, file)
            with open(p, 'r', encoding='utf-8', errors='ignore') as s:
                c = s.read()
                if 'Target Conversion URL' in c or 'Clinical Guide' in c:
                    print('FOUND IN', p)
''')
