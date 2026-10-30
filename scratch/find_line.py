with open('frontend/src/platform/ContentStudioPage.jsx', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if 'Target Conversion URL' in line or 'Clinical Guide' in line:
            print(f'Line {i}: {line.strip()[:100]}')
