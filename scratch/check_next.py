with open('frontend/src/platform/ContentStudioPage.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(490, 540):
    print(f'{i+1}: {lines[i]}', end='')
