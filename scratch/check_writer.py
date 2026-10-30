with open('frontend/src/platform/ContentStudioPage.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print('BlogWriterTab starts at line 388')
for i in range(387, 430):
    print(f'{i+1}: {lines[i]}', end='')
