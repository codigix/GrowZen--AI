import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if j < 600 and 'ARTICLE_STATUS =' in line:
            print('Found ARTICLE_STATUS in step', j)
            data = json.loads(line)
            c = data.get('content', '')
            if not c:
                for tc in data.get('tool_calls', []):
                    c += str(tc.get('args', ''))
            with open('scratch/found_code.txt', 'w', encoding='utf-8') as out:
                out.write(c)
            break
