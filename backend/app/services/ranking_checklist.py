"""The ranking checklist: every change on the website, the Google Business Profile and other places that affects a client's visibility, as tasks.

Each point either checks real data (a missing About page, unanswered reviews, no cover photo, orphan pages...) and is raised only while the problem exists, so
it closes by itself once fixed, or is a standing point we cannot read from outside (claiming a Bing listing, a Facebook page...) which a person ticks off once.
Every point carries where to do it, a filled-in dummy example and test links. Pure functions over a context dict; no network.
"""
import re
from datetime import date
from typing import Any
from urllib.parse import quote, urlparse


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def build_context(b: Any, pages: list[dict[str, Any]], stats: Any, unreplied: int, cannibal: int) -> dict[str, Any]:
    paths = {(urlparse(p["url"]).path or "/").lower().rstrip("/") or "/" for p in pages}
    base = ""
    if b.website:
        u = urlparse(b.website if b.website.startswith("http") else f"https://{b.website}")
        base = f"{u.scheme}://{u.netloc}"
    status = b.gbp_status or {}
    svc = next((s.get("name") for s in (b.services or []) if s.get("name")), "") or b.primary_category or "our services"
    return {"b": b, "pages": pages, "paths": paths, "stats": stats, "unreplied": unreplied, "cannibal": cannibal, "base": base, "host": urlparse(base).netloc,
            "name": b.name, "city": b.city or b.area or "your city", "cat": b.primary_category or "local business", "svc": svc, "phone": b.phone or "+91 00000 00000",
            "has_gbp": bool(b.gbp_location or b.place_id), "maps": status.get("maps_url"), "review_url": status.get("review_url"), "country": (b.country or "").upper()}


def _has(c: dict[str, Any], *words: str) -> bool:
    return any(w in p for p in c["paths"] for w in words)


def _no_data(c: dict[str, Any]) -> bool:
    return not c["pages"]


def P(key, area, title, why, how, priority, impact, effort, *, need=None, standing=False, where="", example=None, links=None, needs_site=False, needs_gbp=False):
    return {"key": key, "area": area, "title": title, "why": why, "how": how, "priority": priority, "impact": impact, "effort": effort, "need": need, "standing": standing,
            "where": where, "example": example, "links": links, "needs_site": needs_site, "needs_gbp": needs_gbp}


def catalog(c: dict[str, Any]) -> list[dict[str, Any]]:
    b, n, city, cat, svc, base, phone = c["b"], c["name"], c["city"], c["cat"], c["svc"], c["base"], c["phone"]
    review_url = c["review_url"] or "[your Google review link]"
    wa = f"https://wa.me/?text={quote(f'Hi! Thank you for choosing {n}. Could you leave us a quick Google review? ' + review_url)}"
    return [
        # ---- Google Business Profile
        P("gmb-reply-reviews", "gmb", f"Reply to the {c['unreplied']} unanswered Google reviews", "Replies show Google and customers that the business is active, and they lift conversion.",
          "Reply to every review within 48 hours. Thank positive reviewers by name; for 1-3 star reviews apologise, state the fix and invite them to call.", 2, "High", "quick",
          need=lambda c: (c["unreplied"] > 0) if c["has_gbp"] else None, needs_gbp=True,
          where="Google Business Profile manager > Reviews > pick a review > Reply > Post reply",
          example=f"Thank you, Priya! We're glad {svc.lower()} went well. See you at your next visit. - Team {n}",
          links=[("Reviews on Google Maps", c["maps"]), ("Business Profile manager", "https://business.google.com/reviews")]),
        P("gmb-review-requests", "gmb", "Ask every customer for a Google review (send the review link)", "Review count, rating and freshness are among the strongest local ranking signals.",
          "Share the direct review link by WhatsApp, SMS or a QR code at the counter right after a good visit. Aim for 4+ new reviews a week. Never offer rewards for reviews.", 2, "High", "quick",
          need=lambda c: (c["stats"].review_count < 50) if c["has_gbp"] else None, needs_gbp=True,
          where="Business Profile manager > Get more reviews > copy the link > share it by WhatsApp, SMS or print the QR code",
          example=f"Hi Rahul, thank you for visiting {n}! If you were happy with {svc.lower()}, would you leave us a 1-minute review? {review_url}",
          links=[("WhatsApp message ready to send", wa), ("Business Profile manager", "https://business.google.com/")]),
        P("gmb-photos", "gmb", "Upload fresh photos to the Google profile", "Listings with many recent photos get more calls and direction requests.",
          "Add at least 30 real photos over the next month: exterior, entrance, interior, team, work in progress, finished work, products. Upload 3-5 every week. No stock images.", 3, "Medium", "medium",
          need=lambda c: (c["stats"].photos < 30) if c["has_gbp"] else None, needs_gbp=True,
          where="Business Profile manager > Photos & videos > Add photo > choose the category (Exterior, Interior, Team, At work) > Upload",
          example=f"File name before upload: {_slug(n)}-{_slug(city)}-reception.jpg  (describe what it shows, keep it under 5 MB, at least 720x720 px)",
          links=[("Your photos on Google Maps", c["maps"])]),
        P("gmb-logo-cover", "gmb", "Add the logo and a cover photo to the Google profile", "A recognisable logo and cover photo make the listing look complete and trusted.",
          "Upload a square logo (at least 250x250 px) and a 1024x576 cover photo, then mark them as logo and cover.", 3, "Medium", "quick",
          need=lambda c: (not c["b"].logo or not c["b"].cover_photo) if c["has_gbp"] else None, needs_gbp=True,
          where="Business Profile manager > Photos & videos > Logo / Cover > Upload",
          example=f"Logo: {_slug(n)}-logo-500.png (square, transparent background)    Cover: {_slug(n)}-cover-1024x576.jpg"),
        P("gmb-hours", "gmb", "Set complete opening hours on the Google profile", "Wrong or missing hours cost calls and 'open now' searches.",
          "Enter the hours for every day, then keep them current.", 2, "High", "quick",
          need=lambda c: (not c["b"].hours) if c["has_gbp"] else None, needs_gbp=True,
          where="Business Profile manager > Edit profile > Business information > Hours > Edit hours > Apply",
          example="Mon-Sat 09:00-19:00, Sun closed"),
        P("gmb-special-hours", "gmb", "Add holiday and special opening hours", "Google shows 'hours might differ' on holidays unless you set them, which loses visits.",
          "Add the next festivals and public holidays, and any day you close early.", 4, "Low", "quick", standing=True, needs_gbp=True,
          where="Business Profile manager > Edit profile > Business information > Hours > Add special hours > pick the dates > Apply",
          example="Diwali, 12 Nov 2026: closed    Christmas Eve, 24 Dec 2026: 09:00-14:00"),
        P("gmb-booking-link", "gmb", "Add a booking / appointment link to the Google profile", "A direct action button turns profile views into customers.",
          "Add the booking page, or the contact page if there is no booking system.", 3, "Medium", "quick",
          need=lambda c: (not c["b"].booking_url) if c["has_gbp"] else None, needs_gbp=True,
          where="Business Profile manager > Edit profile > Business information > Appointment link > paste the URL > Apply",
          example=f"{base or 'https://www.example.com'}/contact?utm_source=google&utm_medium=gbp&utm_campaign=booking"),
        P("gmb-utm", "gmb", "Add tracking (UTM) to the website link on the Google profile", "Without it, visits from Google Maps are mixed with other traffic and cannot be measured.",
          "Edit the profile's Website link to include UTM parameters, then watch the source in Google Analytics.", 4, "Low", "quick", standing=True, needs_gbp=True, needs_site=True,
          where="Business Profile manager > Edit profile > Business information > Website > paste the tagged link > Apply",
          example=f"{base or 'https://www.example.com'}/?utm_source=google&utm_medium=organic&utm_campaign=gbp-listing"),
        P("gmb-nap", "gmb", "Make name, address and phone identical everywhere", "Different spellings of the business name, address or phone split trust between listings.",
          "Pick one exact format and make the website footer, Google profile, Facebook, directories and invoices match it character for character.", 2, "High", "medium", standing=True,
          where="Website footer / contact page, Business Profile manager > Edit profile, each directory's 'Edit listing' page",
          example=f"{n}\n{b.address or '[street address]'}, {city}\n{phone}"),
        # ---- Website
        P("web-about", "content", "Create an About page that shows who is behind the business", "Google looks for real people, experience and contact details (E-E-A-T) before trusting a business site.",
          "Write 300+ words: the story, founders or team with photos, years in business, certifications, where you work. Link it from the menu and footer.", 3, "Medium", "medium",
          need=lambda c: (not _has(c, "about", "our-story", "who-we-are", "team")) if c["pages"] else None, needs_site=True,
          where="Website editor > Pages > Add new page > title 'About us' > publish > add it to the header menu and footer",
          example=f"H1: About {n}\n- Who we are and why we started (2 paragraphs)\n- Meet the team: photo, name, role, one line each\n- Our promise to customers in {city}\n- Call to action: {phone}"),
        P("web-contact", "content", "Create a Contact page with address, phone, hours and a map", "Contact details on the site confirm the business is real and match the Google profile.",
          "Show the address and phone as text (not an image), the opening hours, a Google Maps embed and a short enquiry form.", 2, "High", "medium",
          need=lambda c: (not _has(c, "contact")) if c["pages"] else None, needs_site=True,
          where="Website editor > Pages > Add new page > 'Contact us' > add the address, phone, hours, map embed block and form > publish",
          example=f"H1: Contact {n}\n{b.address or '[address]'}, {city}\nCall: {phone}\nHours: Mon-Sat 09:00-19:00\n[Google Maps embed]  [Enquiry form]"),
        P("web-legal", "technical", "Publish Privacy Policy and Terms pages and link them in the footer", "They are trust signals, and required to collect leads or run ads.",
          "Add both pages and link them from every page's footer.", 4, "Low", "quick",
          need=lambda c: (not _has(c, "privacy", "terms")) if c["pages"] else None, needs_site=True,
          where="Website editor > Pages > Add new page > 'Privacy Policy' and 'Terms' > publish > footer menu",
          example="Footer: © 2026 " + n + "  |  Privacy Policy  |  Terms"),
        P("web-blog", "content", "Start a blog and publish two helpful articles a month", "Articles answer the questions customers search for and bring in traffic a service page cannot.",
          "Use the Keyword Management and Content Studio pages to pick topics, write, and publish. Link each article to the related service page.", 3, "Medium", "large",
          need=lambda c: (not _has(c, "blog", "news", "article", "insights")) if c["pages"] else None, needs_site=True,
          where="Content Studio in this app > pick a keyword > Generate > edit > Publish to the website (or website editor > Blog > New post)",
          example=f"Title: How much does {svc.lower()} cost in {city}? (2026 guide)\nH2s: Typical price range, What changes the price, How to choose, FAQs"),
        P("web-testimonials", "content", "Add real customer testimonials to the home and service pages", "Social proof raises conversions; use real names, photos and the review source.",
          "Add 3-6 real quotes with the customer's first name and area, and a link to your Google reviews. Do not add star-rating markup for your own business: Google ignores it.", 3, "Medium", "quick", standing=True, needs_site=True,
          where="Website editor > Home page > add a Testimonials section > paste real quotes > publish",
          example=f"\"Quick, clean and fair price.\" - Priya, {city}  (Google review, Oct 2026)"),
        P("web-click-to-call", "content", "Add click-to-call and WhatsApp buttons on every page", "Most local searches happen on phones; a tap-to-call button is the fastest way to turn a visit into an enquiry.",
          "Add a sticky bar or header button using tel: and wa.me links. Track clicks as conversions.", 2, "High", "quick", standing=True, needs_site=True,
          where="Website editor > Header / sticky footer > add a Button > link it to the phone and WhatsApp links > publish",
          example=f"<a href=\"tel:{re.sub(r'[^0-9+]', '', phone)}\">Call now</a>\n<a href=\"https://wa.me/{re.sub(r'[^0-9]', '', phone)}\">WhatsApp us</a>"),
        P("web-nap-footer", "content", "Put the business name, address and phone in the footer of every page", "Repeating the same details site-wide supports the Google profile.",
          "Add them as plain text in the footer (not an image), in the exact format used on Google.", 3, "Medium", "quick", standing=True, needs_site=True,
          where="Website editor > Footer > edit the text block > paste the details > publish", example=f"{n} · {b.address or '[address]'}, {city} · {phone}"),
        P("web-orphans", "seo", "Link orphan pages from related pages and the menu", "Pages that no other page links to are rarely crawled or ranked.",
          "Add at least two internal links with descriptive anchor text from related pages to each orphan, and add important ones to the menu.", 3, "Medium", "medium",
          need=lambda c: (sum(1 for p in c["pages"][1:] if p.get("inbound") == 0) > 0) if c["pages"] and all("inbound" in p for p in c["pages"]) else None, needs_site=True,
          where="Website editor > open a related page > select a phrase > Link > pick the orphan page > update",
          example=f"On /services: 'Read how our {svc.lower()} works' -> {base}/services/{_slug(svc)}"),
        P("web-cannibal", "seo", "Fix keywords where several of our pages compete", "When two pages rank for the same search, neither ranks as well as one strong page could.",
          "Pick the best page per keyword, merge or redirect (301) the weaker page into it, and point internal links at the winner.", 3, "Medium", "medium",
          need=lambda c: c["cannibal"] > 0, needs_site=True,
          where="Rank Tracking > keyword details (pages that ranked), then website editor / redirect plugin > add a 301 redirect",
          example=f"301 redirect: {base}/old-{_slug(svc)}-page  ->  {base}/services/{_slug(svc)}"),
        P("web-breadcrumbs", "seo", "Add breadcrumb navigation and BreadcrumbList schema", "Breadcrumbs help Google understand the site structure and show a clean path in results.",
          "Show Home > Section > Page on inner pages and mark it up with BreadcrumbList JSON-LD.", 4, "Low", "medium",
          need=lambda c: ("BreadcrumbList" not in {t for p in c["pages"] for t in p.get("schema_types", [])}) if c["pages"] else None, needs_site=True,
          where="Website editor / SEO plugin > Breadcrumbs setting ON (Yoast: SEO > Settings > Advanced > Breadcrumbs)",
          example=f"<script type=\"application/ld+json\">{{\"@context\":\"https://schema.org\",\"@type\":\"BreadcrumbList\",\"itemListElement\":[{{\"@type\":\"ListItem\",\"position\":1,\"name\":\"Home\",\"item\":\"{base}/\"}},{{\"@type\":\"ListItem\",\"position\":2,\"name\":\"{svc}\",\"item\":\"{base}/services/{_slug(svc)}\"}}]}}</script>"),
        P("web-images", "technical", "Compress images, convert to WebP and lazy-load them", "Heavy images are the commonest reason for slow pages, which hurts rankings and conversions.",
          "Resize to the displayed size, convert to WebP, add loading=\"lazy\" below the fold, and give images width and height.", 3, "Medium", "medium", standing=True, needs_site=True,
          where="Website editor / plugin settings (WordPress: Smush or ShortPixel > Bulk optimise > WebP > lazy load)",
          example="<img src=\"/images/team.webp\" width=\"800\" height=\"533\" loading=\"lazy\" alt=\"" + n + " team in " + city + "\">",
          links=[("PageSpeed Insights", f"https://pagespeed.web.dev/analysis?url={quote(base + '/', safe='')}" if base else None)]),
        P("web-404", "technical", "Create a helpful custom 404 page", "Visitors who land on a dead link should find the main pages instead of leaving.",
          "Design a 404 page with the menu, a search box and links to the top services, and make sure it returns a 404 status.", 4, "Low", "quick", standing=True, needs_site=True,
          where="Website editor > Pages > 404 / Not found page (WordPress theme: 404.php) > edit > publish",
          example=f"H1: We can't find that page\nTry: Home · {svc} · Contact · Call {phone}"),
        P("web-search-console", "technical", "Verify the site in Google Search Console and submit the sitemap", "Search Console shows indexing errors and the searches that bring visitors.",
          "Add the domain property, verify by DNS, submit the sitemap, and check Pages > Not indexed every week.", 2, "High", "quick", standing=True, needs_site=True,
          where="search.google.com/search-console > Add property > Domain > verify with DNS TXT record > Sitemaps > add sitemap.xml",
          example=f"Domain property: {c['host'] or 'example.com'}\nSitemap to submit: {base or 'https://www.example.com'}/sitemap.xml",
          links=[("Google Search Console", "https://search.google.com/search-console")]),
        P("web-bing-webmaster", "technical", "Verify the site in Bing Webmaster Tools", "Bing also feeds ChatGPT-style assistants and other search apps.",
          "Import the site from Google Search Console in one click and submit the sitemap.", 4, "Low", "quick", standing=True, needs_site=True,
          where="bing.com/webmasters > Sign in > Import from Google Search Console > Sitemaps > submit", links=[("Bing Webmaster Tools", "https://www.bing.com/webmasters")]),
        P(f"web-refresh-{date.today():%Y-%m}", "content", "Refresh the three most important pages this month", "Updated prices, photos, FAQs and dates keep pages fresh and relevant.",
          "Pick the three pages with the most impressions, add new facts, photos and FAQs, update the date, and re-submit them in Search Console.", 3, "Medium", "medium", needs_site=True,
          where="Top Pages report in this app > pick the pages > website editor > update > Search Console > URL inspection > Request indexing",
          example=f"Add to /{_slug(svc)}: new price list ({date.today():%B %Y}), 3 recent project photos, 2 new FAQs from customer calls"),
        # ---- Listings and other places
        P("off-bing-places", "backlinks", "Claim the Bing Places listing", "Bing Maps and many assistants read Bing Places; an unclaimed listing can show wrong details.",
          "Import the Google profile into Bing Places in one click, then verify.", 3, "Medium", "quick", standing=True,
          where="bingplaces.com > Sign in > Import from Google Business Profile > Verify", links=[("Bing Places for Business", "https://www.bingplaces.com/")],
          example=f"Business name: {n}\nAddress: {b.address or '[address]'}, {city}\nPhone: {phone}"),
        P("off-apple-business", "backlinks", "Claim the Apple Business Connect listing", "Apple Maps, Siri and iPhone searches use this listing.",
          "Search for the business, claim it, verify by phone, and add hours, photos and the website.", 3, "Medium", "quick", standing=True,
          where="businessconnect.apple.com > Sign in with Apple ID > Add your business > Verify", links=[("Apple Business Connect", "https://businessconnect.apple.com/")]),
        P("off-facebook", "backlinks", "Create or update the Facebook business page with the same name, address and phone", "A complete social profile is a trust signal and an extra place to be found.",
          "Fill in category, address, phone, website, hours and a logo and cover photo; post twice a week; add the page to the website's schema sameAs.", 3, "Medium", "quick", standing=True,
          where="facebook.com/pages/create > Business > enter the name and category > add details > Publish", links=[("Create a Facebook Page", "https://www.facebook.com/pages/create")],
          example=f"Bio: {n} - {cat.lower()} in {city}. {svc}. Call {phone}.  Website: {base or 'https://www.example.com'}"),
        P("off-instagram", "backlinks", "Create or update the Instagram business profile and link the website", "Instagram profiles often rank for the brand name and send visitors to the site.",
          "Switch to a professional account, use the business name, add the website and a booking button, and pin your best posts.", 4, "Low", "quick", standing=True,
          where="Instagram app > Settings > Account type and tools > Switch to professional account > Edit profile > Website", example=f"Name: {n}\nBio: {cat} in {city} · {svc}\nLink: {base or 'https://www.example.com'}"),
        P("off-linkedin", "backlinks", "Create the LinkedIn company page", "It ranks well for the brand name and adds credibility for B2B clients.",
          "Add logo, tagline, About text, website and location.", 4, "Low", "quick", standing=True,
          where="linkedin.com/company/setup/new > Company > fill in the details > Create page", links=[("Create a LinkedIn page", "https://www.linkedin.com/company/setup/new/")]),
        P("off-youtube", "backlinks", "Create a YouTube channel and publish a short intro video", "Video ranks in its own results and in the Google profile.",
          "Upload a 60-90 second intro video with the business name, city and service in the title and description, and link the website.", 4, "Low", "medium", standing=True,
          where="studio.youtube.com > Create > Upload video > title, description, website link > Publish", example=f"Title: {n} - {svc} in {city}\nDescription: Meet {n}. {svc}. Visit {base or 'https://www.example.com'} or call {phone}."),
        P("off-directories", "backlinks", "List the business in the top local directories" + (" (Justdial, Sulekha, IndiaMART)" if c["country"] == "IN" else ""),
          "Consistent listings on trusted directories help Google confirm the business and send referral visitors.",
          "Create or claim the listing with the exact same name, address, phone and website; add category, hours, photos and a description.", 3, "Medium", "medium", standing=True,
          where="Open each directory > Free listing / Add business > enter the NAP exactly as on Google > verify by phone > add photos",
          links=[("Justdial free listing", "https://www.justdial.com/Free-Listing"), ("Sulekha", "https://www.sulekha.com/")] if c["country"] == "IN" else None,
          example=f"{n} | {cat} | {b.address or '[address]'}, {city} | {phone} | {base or 'https://www.example.com'}"),
        P("off-partner-links", "backlinks", "Get links from partners, suppliers, associations and local sites", "Links from relevant local sites are a major ranking signal and send real visitors.",
          "List 10 suppliers, partners, associations, schools or event organisers you already work with; ask each for a link or a mention. Record every result in Backlink Intelligence.", 3, "High", "large",
          where="Backlink Intelligence page in this app > opportunities > send outreach; or email the partner directly",
          example=f"Hi [name], we have worked together on [project]. Could you add {n} to your partners page with a link to {base or 'https://www.example.com'}? Happy to do the same for you."),
        P("off-local-press", "backlinks", "Pitch one local news or blog mention this quarter", "Local press links and mentions build trust and are hard for competitors to copy.",
          "Send a short story (an event, an offer, a customer result, a community effort) to two local news sites or blogs.", 4, "Medium", "medium", standing=True,
          where="Email the editor / 'Write for us' page of local news and community blogs",
          example=f"Subject: {city} {cat.lower()} {n} offers [community event/offer]\nTwo lines about what, when, and a photo."),
    ]


def candidates(c: dict[str, Any]) -> list[dict[str, Any]]:
    """The checklist points to raise now: those whose data shows a problem, and the standing ones. A point whose data cannot be read yet (no crawl, no Google link) is left out."""
    out = []
    for p in catalog(c):
        if p["needs_site"] and not c["b"].website:
            continue
        if p["needs_gbp"] and not c["has_gbp"]:
            continue
        verdict = p["need"](c) if p["need"] else True
        if verdict is None:
            continue
        if verdict is False:
            continue
        out.append(p)
    return out


def resolved(c: dict[str, Any]) -> set[str]:
    """Keys of the data-based points that were checked and are fine now (so their open tasks can close as confirmed). Points that could not be checked are not here."""
    out = set()
    for p in catalog(c):
        if p["need"] is None or (p["needs_site"] and not c["b"].website) or (p["needs_gbp"] and not c["has_gbp"]):
            continue
        if p["need"](c) is False:
            out.add("chk:" + p["key"])
    return out
