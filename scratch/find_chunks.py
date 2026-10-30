import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if 'Showing lines ' in line and 'of 1168' in line:
            data = json.loads(line)
            c = data.get('content', '')
            header = c.splitlines()[:5]
            print(f'Step {j}: {header}')
