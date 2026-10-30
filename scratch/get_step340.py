import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if j == 340:
            data = json.loads(line)
            c = data.get('content', '')
            print('Len:', len(c))
            with open('scratch/step340.txt', 'w', encoding='utf-8') as out:
                out.write(c)
