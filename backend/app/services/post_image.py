"""A picture for a Google Business Profile post, made from the post's own words.

Google's rule for post photos: JPG or PNG, 1200 x 900 px (4:3) recommended, at least 400 x 300, 10 KB to 5 MB. Every card here is a 1200 x 900 JPEG.
The card shows the post's headline (its title, or its first sentence), one supporting line (the offer code and dates, the event date, or the second
sentence) and the business name with its place: only what the post already says. Links, phone numbers and hashtags are left off, as Google advises.
This is a designed text card, not a generated photograph: it always matches the post and never shows anything invented.
"""
from __future__ import annotations

import hashlib
import io
import re
from datetime import date
from typing import Any

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 900
MIN_W, MIN_H, MAX_BYTES = 400, 300, 5 * 1024 * 1024

# name: (gradient top, gradient bottom, text, accent, soft shape)
STYLES: dict[str, tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]] = {
    "indigo": ((49, 46, 129), (79, 70, 229), (255, 255, 255), (250, 204, 21), (129, 140, 248)),
    "forest": ((6, 78, 59), (16, 138, 98), (255, 255, 255), (253, 224, 71), (110, 231, 183)),
    "sunset": ((154, 52, 18), (234, 88, 12), (255, 255, 255), (254, 240, 138), (253, 186, 116)),
    "ocean": ((12, 74, 110), (2, 132, 199), (255, 255, 255), (253, 224, 71), (125, 211, 252)),
    "berry": ((131, 24, 67), (219, 39, 119), (255, 255, 255), (254, 240, 138), (249, 168, 212)),
    "light": ((248, 250, 252), (226, 232, 240), (15, 23, 42), (79, 70, 229), (199, 210, 254)),
}
FONTS_BOLD = ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
FONTS_REG = ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
             "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf")


def _font(paths: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)  # Pillow's own scalable font: always there


def clean_text(text: str | None) -> str:
    """The post's words without what Google advises against on a picture: links, phone numbers, hashtags, emoji and extra spaces."""
    t = str(text or "")
    t = re.sub(r"https?://\S+|www\.\S+", " ", t)
    t = re.sub(r"(?<!\d)\+?\d[\d\s().-]{7,}\d(?!\d)", " ", t)
    t = re.sub(r"#\w+", " ", t)
    t = re.sub(r"[^\w\s.,!?'’&%:;()\-–/₹$€£@]", " ", t)
    return " ".join(t.split())


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if len(s.strip()) > 3]


def _trim(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:.-– ")
    return cut + "…"


def pick_style(seed: str, style: str | None = None) -> str:
    if style in STYLES:
        return style
    names = [k for k in STYLES if k != "light"]
    return names[int(hashlib.md5((seed or "x").lower().encode()).hexdigest(), 16) % len(names)]


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def _fit_headline(draw: ImageDraw.ImageDraw, text: str, width: int, max_lines: int = 4) -> tuple[list[str], Any]:
    for size in range(96, 41, -4):
        f = _font(FONTS_BOLD, size)
        lines = _wrap(draw, text, f, width)
        if len(lines) <= max_lines:
            return lines, f
    f = _font(FONTS_BOLD, 44)
    lines = _wrap(draw, _trim(text, 90), f, width)
    return lines[:max_lines], f


def _date_text(d: date | str | None) -> str:
    if not d:
        return ""
    try:
        x = d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
        return f"{x.day} {x.strftime('%b %Y')}"
    except ValueError:
        return ""


def support_line(post_type: str, body: str, headline: str, *, coupon: str | None = None, starts_on=None, ends_on=None, start_time: str | None = None) -> str:
    when = " – ".join(x for x in (_date_text(starts_on), _date_text(ends_on)) if x)
    if post_type == "Offer":
        return " · ".join(x for x in ((f"Use code {coupon.strip()}" if coupon and coupon.strip() else ""), when) if x)
    if post_type == "Event":
        return " · ".join(x for x in (when, start_time or "") if x)
    rest = [s for s in _sentences(body) if s != headline and s not in headline]
    return _trim(rest[0], 120) if rest else ""


def render(*, business_name: str, place: str | None, title: str | None, body: str | None, post_type: str = "Update", style: str | None = None,
           coupon: str | None = None, starts_on=None, ends_on=None, start_time: str | None = None) -> bytes:
    """The post picture as JPEG bytes, W x H."""
    body_c, title_c = clean_text(body), clean_text(title)
    sents = _sentences(body_c)
    headline = _trim(title_c or (sents[0] if sents else clean_text(business_name)), 110) or clean_text(business_name) or "Update"
    sub = support_line(post_type, body_c, headline, coupon=coupon, starts_on=starts_on, ends_on=ends_on, start_time=start_time)
    top, bottom, ink, accent, soft = STYLES[pick_style(business_name, style)]

    img = Image.new("RGB", (W, H), top)
    px = img.load()
    for y in range(H):  # vertical gradient
        t = y / (H - 1)
        row = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = row
    shapes = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shapes)
    sd.ellipse((W - 420, -180, W + 160, 400), fill=soft + (70,))
    sd.ellipse((-200, H - 360, 320, H + 160), fill=soft + (55,))
    img = Image.alpha_composite(img.convert("RGBA"), shapes).convert("RGB")
    d = ImageDraw.Draw(img)

    margin, width = 90, W - 2 * 90
    label = {"Offer": "SPECIAL OFFER", "Event": "EVENT"}.get(post_type, "NEWS")
    lf = _font(FONTS_BOLD, 30)
    tw = int(d.textlength(label, font=lf))
    d.rounded_rectangle((margin, 80, margin + tw + 48, 80 + 58), radius=29, fill=accent)
    d.text((margin + 24, 80 + 29), label, font=lf, fill=(17, 24, 39) if accent != (79, 70, 229) else (255, 255, 255), anchor="lm")

    lines, hf = _fit_headline(d, headline, width)
    size = getattr(hf, "size", 60)
    lh = int(size * 1.18)
    y = 200
    for ln in lines:
        d.text((margin, y), ln, font=hf, fill=ink)
        y += lh
    d.rectangle((margin, y + 18, margin + 120, y + 26), fill=accent)
    if sub:
        sf = _font(FONTS_REG, 40)
        for ln in _wrap(d, sub, sf, width)[:3]:
            d.text((margin, y + 56), ln, font=sf, fill=ink)
            y += 52

    ff = _font(FONTS_BOLD, 36)
    sfont = _font(FONTS_REG, 30)
    name = _trim(clean_text(business_name), 48)
    d.text((margin, H - 120), name, font=ff, fill=ink)
    if place:
        d.text((margin, H - 70), _trim(clean_text(place), 60), font=sfont, fill=ink)

    out = io.BytesIO()
    img.save(out, "JPEG", quality=90, optimize=True)
    data = out.getvalue()
    if len(data) > MAX_BYTES:  # never expected for a flat card, but Google refuses more than 5 MB
        out = io.BytesIO()
        img.save(out, "JPEG", quality=70, optimize=True)
        data = out.getvalue()
    return data


def for_business(b: Any, *, title: str | None, body: str | None, post_type: str = "Update", style: str | None = None, **extra: Any) -> bytes:
    place = ", ".join(x for x in (getattr(b, "area", None), getattr(b, "city", None)) if x)
    return render(business_name=b.name or "", place=place or None, title=title, body=body, post_type=post_type, style=style, **extra)
