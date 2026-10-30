with open('frontend/src/platform/ContentStudioPage.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i in range(660, 860):
    l = lines[i]
    if 'step ===' in l or '{/* Step' in l:
        print(f'{i+1}: {l.strip()}')
