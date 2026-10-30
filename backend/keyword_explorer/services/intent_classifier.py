"""Rule-based Search Intent Classifier for Keyword Research."""

import re

# Precompiled regex patterns for high performance and low memory
TRANSACTIONAL_PATTERN = re.compile(
    r"\b(buy|purchase|pricing|price|cost|quote|order|coupon|discount|cheap|deal|hire|hiring|"
    r"contract|rates?|fees?|checkout|shop|subscribe|subscription|trial|license|booking)\b",
    re.IGNORECASE,
)

INFORMATIONAL_PREFIX_PATTERN = re.compile(
    r"^(what|how|why|when|where|who)\b|\b(guide|tutorial|tips|definition|meaning|ideas?|"
    r"examples?|learn|course|syllabus|training|case study|explained|checklist|roadmap|"
    r"template|process|steps?)\b",
    re.IGNORECASE,
)

COMMERCIAL_PATTERN = re.compile(
    r"\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives|"
    r"ratings?|recommended|benchmark|agency|company|companies|firm|firms|providers?|vendors?|"
    r"service|services|solutions?)\b",
    re.IGNORECASE,
)

NAVIGATIONAL_PATTERN = re.compile(
    r"\b(login|log in|signin|sign in|signup|sign up|portal|official|website|official website|"
    r"app|apk|ios app|android app|download|dashboard|contact us|customer care|helpline|"
    r"support|careers|documentation|docs)\b",
    re.IGNORECASE,
)


def classify_intent(keyword: str) -> str:
    """
    Classifies search intent:
      1. TRANSACTIONAL: Direct purchase / hiring / pricing indicators
      2. INFORMATIONAL: Questions or tutorials
      3. COMMERCIAL: Investigation, comparison, reviews, vendor search
      4. NAVIGATIONAL: Specific brand or system destinations
      5. INFORMATIONAL: Default intent
    """
    text = keyword.strip()

    if TRANSACTIONAL_PATTERN.search(text):
        return "TRANSACTIONAL"

    if INFORMATIONAL_PREFIX_PATTERN.search(text):
        return "INFORMATIONAL"

    if COMMERCIAL_PATTERN.search(text):
        return "COMMERCIAL"

    if NAVIGATIONAL_PATTERN.search(text):
        return "NAVIGATIONAL"

    return "INFORMATIONAL"
