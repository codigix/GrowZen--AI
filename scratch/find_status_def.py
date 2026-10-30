import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if 'ARTICLE_STATUS' in line:
            data = json.loads(line)
            c = data.get('content', '')
            if 'ARTICLE_STATUS =' in c or 'const ARTICLE_STATUS' in c:
                print('Found in step', j)
                for l in c.splitlines():
                    if 'ARTICLE_STATUS' in l or 'ARTICLE_LENGTHS' in l or 'ArticlesList' in l:
                        print('  ', l[:120])
