with open('frontend/src/platform/ContentStudioPage.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(1140, len(lines)):
    print(f'{i+1}: {lines[i]}', end='')
