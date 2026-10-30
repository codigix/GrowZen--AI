import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if 510 <= j <= 664:
            data = json.loads(line)
            t = data.get('type')
            if t in ['USER_INPUT', 'PLANNER_RESPONSE']:
                content = data.get('content', '')
                if t == 'USER_INPUT':
                    print('User prompt at', j, repr(content[:100]))
