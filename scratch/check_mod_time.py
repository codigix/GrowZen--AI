import os, time

p = 'frontend/src/platform/ContentStudioPage.jsx'
stat = os.stat(p)
print('File size:', stat.st_size)
print('Modified time:', time.ctime(stat.st_mtime))

with open(p, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print('Total lines:', len(lines))
for i in range(25):
    print(f'{i+1}: {lines[i]}', end='')
