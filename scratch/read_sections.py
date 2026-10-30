with open('frontend/src/platform/ContentStudioPage.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print('Total lines:', len(lines))
# Let's inspect sections
sections = []
for i, l in enumerate(lines):
    if l.startswith('export default') or l.startswith('function ') or l.startswith('const '):
        sections.append((i+1, l.strip()[:60]))

for s in sections:
    print(f'{s[0]:4d}: {s[1]}')
