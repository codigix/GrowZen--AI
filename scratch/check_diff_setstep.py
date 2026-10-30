with open('scratch/hunks_parsed.txt', 'r', encoding='utf-8') as f:
    text = f.read()

for l in text.splitlines():
    if 'setStep' in l:
        print(l)
