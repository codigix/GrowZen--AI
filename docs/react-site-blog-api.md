# React.js website: blog API that GrowZen publishes to

GrowZen (AI Blog Studio → Publish & Schedule → **React.js Website**) publishes articles to a custom website through
that website's own backend. This file is the contract the website's backend must implement. It was written for
`codigixinfotech.com` (Vite + React front end, Express API behind nginx), but works for any Node/Express backend.

## What exists today on codigixinfotech.com (checked read-only, 2 Nov 2026)

| Endpoint | Status |
|---|---|
| `GET /api/blogs` | exists, **public**, returns the blog list (fields below) |
| `GET /api/blogs/:id` | exists, public |
| health / create / update / delete / image upload with an API key | **not found from outside** – the admin panel's write calls are not in the public bundle, so they must be added or confirmed in the backend code |

Blog record fields already used by the site: `id, title, slug, body (HTML), excerpt, category, sub_category, tags,
seo_title, seo_description, seo_keywords, focus_keyword, secondary_keywords, image, image_alt, status, date,
publication_time, author, …`. GrowZen sends exactly these names.

## The contract

All requests carry the API key, as chosen in the connection form:

```
Authorization: Bearer <API_KEY>        (default)
X-API-Key: <API_KEY>                   (alternative)
```

| Purpose | Request | Expected answer |
|---|---|---|
| Health / test | `GET /api/integrations/health` | `200` with a valid key, **`401`** without one (GrowZen checks both, so it knows the key is really verified) |
| Create post | `POST /api/blogs` + JSON below | `201` `{ "id": 12, "slug": "…", "url": "https://…/blog/…" }` (`slug`/`url` optional) |
| Update post | `PUT /api/blogs/:id` + JSON below | `200` |
| Delete post | `DELETE /api/blogs/:id` | `200`/`204` (`404` = already gone) |
| Featured image | `POST /api/uploads` multipart: `image` (WebP file), `alt` | `201` `{ "url": "https://…/uploads/….webp" }` |

The endpoint paths are only defaults: any path can be entered in the GrowZen connection form.

### Article JSON sent by GrowZen

```json
{
  "title": "Healthcare Agency: How to Choose the Right One",
  "slug": "healthcare-agency-how-to-choose-the-right-one",
  "body": "<p>…</p><h2>…</h2><p>…</p>",          // clean HTML, no <h1> (the page renders the title)
  "excerpt": "Meta description…",
  "seo_title": "…", "seo_description": "…",
  "focus_keyword": "healthcare agency",
  "secondary_keywords": ["…"], "seo_keywords": "a, b, c", "tags": ["…"],
  "category": "Healthcare Agency",
  "image": "https://codigixinfotech.com/uploads/….webp", "image_alt": "…",
  "status": "draft",                               // draft | published | scheduled
  "date": "2026-11-02", "publication_time": "2026-11-02T10:00:00+00:00",
  "faqs": [{ "question": "…", "answer": "…" }],
  "schema_jsonld": "{ \"@context\": \"https://schema.org\", \"@graph\": [ … ] }",
  "source": "growzen", "growzen_article_id": 9
}
```

Render `schema_jsonld` in the post page's `<head>` as `<script type="application/ld+json">`.
A `scheduled` post should stay hidden from the public list until `publication_time`.

## Express example (drop-in router)

```js
// routes/growzen.js  — mount with: app.use('/api', require('./routes/growzen'))
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const router = express.Router();

// Issue one long random key (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
// and keep it in the backend's environment, never in the React front end.
const API_KEY = process.env.GROWZEN_API_KEY;

function requireKey(req, res, next) {
  const sent = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-api-key') || '';
  const ok = API_KEY && sent.length === API_KEY.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(API_KEY));
  return ok ? next() : res.status(401).json({ message: 'Invalid or missing API key' });
}

router.get('/integrations/health', requireKey, (req, res) => res.json({ ok: true }));

const ALLOWED = ['title', 'slug', 'body', 'excerpt', 'seo_title', 'seo_description', 'focus_keyword', 'secondary_keywords',
  'seo_keywords', 'tags', 'category', 'image', 'image_alt', 'status', 'date', 'publication_time'];
const pick = (b) => Object.fromEntries(ALLOWED.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));

router.post('/blogs', requireKey, express.json({ limit: '2mb' }), async (req, res) => {
  const blog = await Blogs.create({ ...pick(req.body), schema_jsonld: req.body.schema_jsonld, faqs: req.body.faqs }); // your DB layer
  res.status(201).json({ id: blog.id, slug: blog.slug, url: `https://codigixinfotech.com/blog/${blog.slug}` });
});

router.put('/blogs/:id', requireKey, express.json({ limit: '2mb' }), async (req, res) => {
  const blog = await Blogs.update(req.params.id, { ...pick(req.body), schema_jsonld: req.body.schema_jsonld, faqs: req.body.faqs });
  if (!blog) return res.status(404).json({ message: 'Not found' });
  res.json({ id: blog.id, slug: blog.slug });
});

router.delete('/blogs/:id', requireKey, async (req, res) => {
  const gone = await Blogs.remove(req.params.id);
  return gone ? res.status(204).end() : res.status(404).json({ message: 'Not found' });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: 'public/uploads',
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'image/webp'), // GrowZen always sends optimized WebP
});
router.post('/uploads', requireKey, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Send a WebP image in the "image" field' });
  res.status(201).json({ url: `https://codigixinfotech.com/uploads/${path.basename(req.file.path)}` });
});

module.exports = router;
```

The public `GET /api/blogs` list can keep working as it does; only the write endpoints need the key.
