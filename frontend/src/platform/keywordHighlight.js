// Helpers for the blog editor: the article's web address (slug) and marking its keywords in the preview.

/** Web-address words: lower case letters and digits joined by single hyphens, cut at a whole word (the same rule the server applies when it saves). */
export function slugify(text, limit = 80) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  return (cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/g, '');
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One expression for every keyword: the longest phrases first, whole words only, any case. A phrase that is part of a longer one is marked as the longer one. */
function expression(primary, secondary, brand) {
  const list = [];
  const add = (k, kind) => { const t = String(k || '').trim().replace(/\s+/g, ' '); if (t.length > 1 && !list.some(x => x.t.toLowerCase() === t.toLowerCase())) list.push({ t, kind }); };
  add(primary, 'primary');
  (secondary || []).forEach(k => add(k, 'secondary'));
  add(brand, 'brand');
  if (!list.length) return null;
  list.sort((a, b) => b.t.length - a.t.length);
  const kinds = new Map(list.map(x => [x.t.toLowerCase().replace(/\s+/g, ' '), x.kind]));
  return { rx: new RegExp(`(?<![\\p{L}\\p{N}])(${list.map(x => esc(x.t).replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), kinds };
}

export const MARK_STYLE = {
  primary: 'background:#fde68a;color:inherit;padding:0 2px;border-radius:3px;font-weight:600;box-shadow:inset 0 -2px 0 #f59e0b',
  secondary: 'background:#bae6fd;color:inherit;padding:0 2px;border-radius:3px;font-weight:600;box-shadow:inset 0 -2px 0 #0ea5e9',
  brand: 'background:#bbf7d0;color:inherit;padding:0 2px;border-radius:3px;font-weight:600;box-shadow:inset 0 -2px 0 #22c55e',
};

/** The name readers know the business by (the same rule the server uses): "Codigix Infotech" from "Codigix Infotech Pvt. Ltd. – Healthcare Marketing Agency". */
export function brandOf(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  let head = n.split(/\s+[–—|:]\s+|\s+-\s+|\s*\|\s*/)[0].trim();
  head = head.replace(/\b(?:pvt\.?|private|ltd\.?|limited|llp|inc\.?|llc|corp\.?)\b.*$/i, '').replace(/^[\s,.-]+|[\s,.-]+$/g, '') || head || n;
  if (head.length > 40 && head.includes(',')) head = head.split(',')[0].trim();
  return head.slice(0, 60);
}

/** Plain text split into pieces: [{ text, kind }] with kind 'primary', 'secondary' or null. For the title and description lines. */
export function splitKeywords(text, primary, secondary, brand) {
  const ex = expression(primary, secondary, brand);
  const src = String(text || '');
  if (!ex || !src) return [{ text: src, kind: null }];
  const out = [];
  let last = 0;
  for (const m of src.matchAll(ex.rx)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), kind: null });
    out.push({ text: m[0], kind: ex.kinds.get(m[0].toLowerCase().replace(/\s+/g, ' ')) || 'secondary' });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), kind: null });
  return out;
}

/** The article's HTML with each keyword wrapped in a coloured <mark> (for checking only). Only text is touched: tags, attributes, scripts and styles are left exactly as they are. */
export function highlightHtml(html, primary, secondary, opts = {}) {
  const ex = expression(primary, secondary, opts.brand);
  if (!ex || !html) return html || '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('strong[data-gz]').forEach(el => { el.setAttribute('style', MARK_STYLE[el.getAttribute('data-gz')] || MARK_STYLE.secondary); }); // the bold the article carries: coloured here, to check it; on your website it is bold only
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('script,style,mark,textarea,strong,b') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT), // inside a saved mark (even in its <strong>) the text is left as it is
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    ex.rx.lastIndex = 0;
    const has = ex.rx.test(text);
    ex.rx.lastIndex = 0; // test() on a global expression moves it on: matchAll must start from the beginning of the text
    if (!has) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(ex.rx)) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      const mark = doc.createElement('mark');
      const kind = ex.kinds.get(m[0].toLowerCase().replace(/\s+/g, ' ')) || 'secondary';
      mark.setAttribute('data-kw', kind);
      mark.setAttribute('style', MARK_STYLE[kind]);
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
  if (opts.flag) { // a paragraph with none of the keywords gets a red bar at its left
    doc.body.querySelectorAll('p').forEach(p => {
      if (p.textContent.trim().split(/\s+/).length >= 6 && !p.querySelector('mark,strong[data-gz]')) { p.setAttribute('style', `${p.getAttribute('style') || ''};border-left:3px solid #fca5a5;padding-left:8px`); p.setAttribute('title', 'No keyword in this paragraph'); }
    });
  }
  return doc.body.innerHTML;
}

const words = (x) => ` ${(String(x || '').toLowerCase().match(/\w+/g) || []).join(' ')} `;

/** How many paragraphs of the article carry the primary keyword or a secondary one: { total, covered, missing: [paragraph numbers] }. */
export function paragraphCoverage(html, primary, secondary) {
  const keys = [primary, ...(secondary || [])].map(k => String(k || '').trim()).filter(Boolean);
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  doc.querySelectorAll('script,style').forEach(n => n.remove());
  const isLabel = (p) => p.children.length === 1 && p.firstElementChild.tagName === 'STRONG' && !p.firstElementChild.hasAttribute('data-gz') && p.firstElementChild.textContent.trim() === p.textContent.trim(); // a bold label such as "Key takeaways"
  const paras = [...doc.querySelectorAll('p')].filter(p => !isLabel(p)).map(p => p.textContent.trim()).filter(x => x.split(/\s+/).length >= 6);
  const missing = [];
  paras.forEach((x, i) => { if (!keys.some(k => words(x).includes(words(k)))) missing.push(i + 1); });
  return { total: paras.length, covered: paras.length - missing.length, missing };
}

/** The breadcrumb Google shows under a result: "slug.example › blog › my-post". */
export function crumb(url) {
  try {
    const u = new URL(url);
    return [u.host.replace(/^www\./, ''), ...u.pathname.split('/').filter(Boolean)].join(' › ');
  } catch { return url || ''; }
}
