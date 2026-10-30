with open('frontend/src/platform/KeywordResearchPage.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

print('Keyword Explorer present in file:', 'Keyword Explorer' in text)
print('api/keyword present:', 'api/keyword' in text)
for line in text.splitlines():
    if 'tabs={' in line or 'label:' in line and ('Explorer' in line or 'Trends' in line or 'Discover' in line):
        print(line.strip())
