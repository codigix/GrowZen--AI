with open('frontend/src/platform/seoApi.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(7, 25):
    print(f'{i+1}: {lines[i]}', end='')
