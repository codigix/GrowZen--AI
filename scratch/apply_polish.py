FILE = r'c:\Users\DELL\Documents\GitHub\GrowZen--AI\frontend\src\platform\ContentStudioPage.jsx'

with open(FILE, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update SeoUi import to include useUrlTab
old_import = """import {
  SeoShell, Card, Tabs, Badge, StatusPill, Button, Field, inputCls, areaCls,
  ScoreRing, Meter, SERIES, scoreWord, useSimulated, useToast, useAction, ErrorNote, PreviewNote
} from './SeoUi';"""

new_import = """import {
  SeoShell, Card, Tabs, Badge, StatusPill, Button, Field, inputCls, areaCls,
  ScoreRing, Meter, SERIES, scoreWord, useSimulated, useToast, useAction, useUrlTab, ErrorNote, PreviewNote
} from './SeoUi';"""

if old_import in text:
    text = text.replace(old_import, new_import, 1)
    print("1. Added useUrlTab to imports")
else:
    print("1. old_import not matched")

# 2. Update ContentStudioPage to use useUrlTab
old_tab_state = "  const [tab, setTab] = useState('trends');"
new_tab_state = "  const [tab, setTab] = useUrlTab('trends', ['trends', 'blog', 'calendar', 'backlinks']);"

if old_tab_state in text:
    text = text.replace(old_tab_state, new_tab_state, 1)
    print("2. Updated tab state to useUrlTab")
else:
    print("2. old_tab_state not matched")

# 3. Fix step < 6 to step < 4 for ChevronRight
old_chevron = "{step < 6 && <ChevronRight size={13} />}"
new_chevron = "{step < 4 && <ChevronRight size={13} />}"

if old_chevron in text:
    text = text.replace(old_chevron, new_chevron, 1)
    print("3. Fixed chevron condition to step < 4")
else:
    print("3. old_chevron not matched")

# 4. Allow navigating any step when selectedArticle is present
old_nav = "onClick={() => i <= step && setStep(i)}"
new_nav = "onClick={() => (selectedArticle || i <= step) && setStep(i)}"

if old_nav in text:
    text = text.replace(old_nav, new_nav, 1)
    print("4. Updated step navigation onClick")
else:
    print("4. old_nav not matched")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(text)

print("Saved updated ContentStudioPage.jsx")
