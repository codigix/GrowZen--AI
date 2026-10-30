import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if 'ARTICLE_STATUS' in line:
            data = json.loads(line)
            raw = json.dumps(data)
            idx = raw.find('ARTICLE_STATUS')
            while idx != -1:
                print(f'Step {j}:', raw[max(0, idx-50):min(len(raw), idx+150)])
                idx = raw.find('ARTICLE_STATUS', idx+150)
