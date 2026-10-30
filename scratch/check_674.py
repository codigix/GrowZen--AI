import json
with open(r'C:/Users/DELL/.gemini/antigravity/brain/d9fd05e3-2337-4eb2-a287-cdd2b2d4f90f/.system_generated/logs/transcript_full.jsonl', encoding='utf-8') as f_in:
    for j, line in enumerate(f_in):
        if j == 674:
            data = json.loads(line)
            calls = data.get('tool_calls', [])
            for c in calls:
                print(c.get('args', {}).get('Content'))
