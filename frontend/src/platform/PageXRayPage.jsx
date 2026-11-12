import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Check, X, Plus, Search, Globe, Copy, Download, RefreshCw, ChevronDown, ChevronUp, ExternalLink, Loader2, AlertTriangle, ShieldCheck, ShieldAlert, Lock, FileText } from 'lucide-react';
import { SeoShell, Card, Button, Badge } from './SeoUi';
import { api, useApi } from './seoApi';

const MAX_URLS = 3;
const SEC_HEADERS = [['hsts', 'HSTS'], ['csp', 'CSP'], ['x_frame_options', 'X-Frame-Options'], ['x_content_type_options', 'X-Content-Type-Options'], ['referrer_policy', 'Referrer-Policy'], ['permissions_policy', 'Permissions-Policy']];
const SCORE_AREAS = [['seo', 'SEO'], ['aeo', 'AEO'], ['geo', 'GEO']];

const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const dash = (v) => (empty(v) ? '—' : v);
const arr = (v) => (Array.isArray(v) ? v : []);
const normaliseUrl = (u) => { const s = String(u || '').trim(); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const tone = (s) => (s == null ? 'text-slate-400' : s >= 75 ? 'text-emerald-600' : s >= 45 ? 'text-amber-500' : 'text-red-500');
const ringColor = (s) => (s == null ? '#cbd5e1' : s >= 75 ? '#10b981' : s >= 45 ? '#f59e0b' : '#ef4444');
const fmtDate = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const age = (days) => { if (days == null) return '—'; const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30); return y ? `${y} yr${y > 1 ? 's' : ''}${m ? ` ${m} mo` : ''}` : `${m} mo`; };
const secCount = (d) => SEC_HEADERS.filter(([k]) => d?.tech?.security_headers?.[k]).length;
const aiAllowed = (d) => arr(d?.robots?.ai_crawlers).filter(x => x.allowed).length;
const aiTotal = (d) => arr(d?.robots?.ai_crawlers).length;
const analyticsCount = (d) => arr(d?.tech?.analytics).length + arr(d?.tech?.tag_managers).length;

/** CSV cell: quoted, quotes doubled, and a leading = + - @ neutralised so a spreadsheet never runs it as a formula. */
const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
const download = (name, text, mime) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
const copyText = async (text) => { try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignore */ } t.remove(); } };
const slug = (u) => hostOf(u).replace(/[^a-z0-9]+/gi, '-');

function checksCsv(d) {
  const rows = [['area', 'key', 'label', 'passed', 'weight', 'detail', 'fix']];
  for (const [k] of SCORE_AREAS) for (const c of arr(d.scores?.[k]?.checks)) rows.push([k.toUpperCase(), c.key, c.label, c.passed ? 'yes' : 'no', c.weight, c.detail, c.passed ? '' : c.fix]);
  return toCsv(rows);
}

function reportText(d) {
  const lines = [`Page X-Ray: ${d.final_url || d.url}`, `Checked ${d.fetched_at || ''} · status ${dash(d.status)} · ${dash(d.response_ms)} ms`, ''];
  for (const [k, label] of SCORE_AREAS) { const s = d.scores?.[k]; lines.push(`${label}: ${s ? `${s.score}/100 (${s.passed} of ${s.total} checks)` : '—'}`); }
  const fixes = arr(d.summary);
  if (fixes.length) { lines.push('', 'Top fixes:'); fixes.forEach(f => lines.push(`- [${f.area}] ${f.label}${f.fix ? `: ${f.fix}` : ''}`)); }
  for (const [k, label] of SCORE_AREAS) { const bad = arr(d.scores?.[k]?.checks).filter(c => !c.passed); if (bad.length) { lines.push('', `${label} to fix:`); bad.forEach(c => lines.push(`- ${c.label}: ${c.fix || c.detail || ''}`)); } }
  return lines.join('\n');
}

function Ring({ score, size = 76 }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r, s = score == null ? 0 : score;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor(score)} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(s / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="54%" textAnchor="middle" className="fill-slate-900" style={{ fontSize: size * 0.3, fontWeight: 700 }}>{score == null ? '—' : score}</text>
    </svg>
  );
}

function Section({ title, hint, defaultOpen = true, count, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ai-glass-card rounded overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full px-5 py-3.5 flex items-center gap-3 text-left cursor-pointer hover:bg-slate-50/60">
        <span className="flex-1 min-w-0"><span className="text-15 font-semibold text-slate-900">{title}</span>{hint && <span className="text-12.5 text-slate-500"> · {hint}</span>}</span>
        {count != null && <span className="text-12 font-semibold text-slate-500 tabular-nums">{count}</span>}
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-slate-100">{children}</div>}
    </section>
  );
}

const Row = ({ label, children }) => <div className="flex gap-3 py-1.5 text-13"><div className="w-36 shrink-0 text-slate-500">{label}</div><div className="min-w-0 flex-1 text-slate-800 break-words">{children}</div></div>;
const Chips = ({ items, tint = 'bg-slate-100 text-slate-700' }) => (arr(items).length ? <div className="flex flex-wrap gap-1.5">{arr(items).map((x, i) => <span key={`${x}-${i}`} className={`text-12 rounded-full px-2.5 py-0.5 ${tint}`}>{x}</span>)}</div> : <span className="text-slate-400">—</span>);

function Meter({ value, max, label }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const over = value > max, short = value > 0 && value < max * 0.4;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-28 h-1.5 rounded-full bg-slate-100 overflow-hidden shrink-0"><div className={`h-full rounded-full ${over ? 'bg-red-400' : short ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
      <span className={`text-12 tabular-nums ${over ? 'text-red-600' : 'text-slate-500'}`}>{value} / {max} {label}{over ? ' (too long)' : short ? ' (short)' : ''}</span>
    </div>
  );
}

function CheckList({ area }) {
  const checks = arr(area?.checks);
  if (!checks.length) return <p className="text-13 text-slate-400 py-2">No checks were returned.</p>;
  const sorted = [...checks].sort((a, b) => Number(a.passed) - Number(b.passed));
  return (
    <ul className="divide-y divide-slate-100">
      {sorted.map(c => (
        <li key={c.key} className="py-2.5 flex gap-3">
          <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${c.passed ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>{c.passed ? <Check size={13} /> : <X size={13} />}</span>
          <div className="min-w-0 flex-1">
            <div className="text-13 font-medium text-slate-900">{c.label}{c.weight != null && <span className="ml-2 text-11 text-slate-400 font-normal">weight {c.weight}</span>}</div>
            {c.detail && <div className="text-12.5 text-slate-500 mt-0.5 break-words">{c.detail}</div>}
            {!c.passed && c.fix && <div className="text-12.5 text-indigo-700 mt-1">Fix: {c.fix}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Outline({ items }) {
  const list = arr(items).slice(0, 80);
  if (!list.length) return <span className="text-slate-400">—</span>;
  return <ul className="text-12.5 space-y-0.5 max-h-64 overflow-y-auto">{list.map((h, i) => <li key={i} style={{ paddingLeft: `${Math.max(0, (h.level || 1) - 1) * 14}px` }} className="text-slate-700 truncate"><span className="text-slate-400 mr-1.5">H{h.level}</span>{h.text}</li>)}</ul>;
}

function SocialPreview({ d }) {
  const og = d.social?.og || {}, tw = d.social?.twitter || {};
  const title = og.title || tw.title || d.meta?.title, desc = og.description || tw.description || d.meta?.description, img = og.image || tw.image;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-12 font-semibold text-slate-500 mb-1.5">Google result</div>
        <div className="rounded-lg ring-1 ring-slate-200 bg-white p-4">
          <div className="text-12 text-slate-600 truncate">{d.final_url || d.url}</div>
          <div className="text-18 text-blue-700 leading-snug mt-0.5 line-clamp-2">{d.meta?.title ? String(d.meta.title).slice(0, 60) + (String(d.meta.title).length > 60 ? '…' : '') : <span className="text-slate-400">No title tag</span>}</div>
          <div className="text-13 text-slate-600 mt-1 line-clamp-3">{d.meta?.description ? String(d.meta.description).slice(0, 160) + (String(d.meta.description).length > 160 ? '…' : '') : <span className="text-slate-400">No meta description: Google writes its own snippet.</span>}</div>
        </div>
      </div>
      <div>
        <div className="text-12 font-semibold text-slate-500 mb-1.5">When shared (Open Graph / {tw.card || 'Twitter'})</div>
        <div className="rounded-lg ring-1 ring-slate-200 bg-white overflow-hidden">
          {img ? <img src={img} alt="" className="w-full h-40 object-cover bg-slate-100" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <div className="h-24 bg-slate-50 flex items-center justify-center text-12 text-slate-400">No og:image: shared links show no picture</div>}
          <div className="p-3"><div className="text-11.5 uppercase text-slate-400 truncate">{og.site_name || hostOf(d.final_url || d.url)}</div><div className="text-14 font-semibold text-slate-900 line-clamp-2">{title || <span className="text-slate-400 font-normal">No share title</span>}</div><div className="text-12.5 text-slate-600 line-clamp-2 mt-0.5">{desc || ''}</div></div>
        </div>
      </div>
    </div>
  );
}

function Report({ d, onRerun, busy }) {
  const [copied, setCopied] = useState(false);
  const m = d.meta || {}, c = d.content || {}, s = d.schema || {}, t = d.tech || {}, dom = d.domain || {}, ssl = d.ssl || {}, rb = d.robots || {};
  const techGroups = [['CMS', t.cms], ['Frameworks', t.frameworks], ['JavaScript libraries', t.js_libraries], ['Analytics', t.analytics], ['Tag managers', t.tag_managers], ['Ads & pixels', t.ads_pixels], ['CDN', t.cdn], ['Server', [t.server, t.powered_by].flatMap(x => (x ? [x] : []))]];
  const doCopy = async () => { await copyText(reportText(d)); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="space-y-4">
      <div className="ai-glass-card rounded p-4 sticky top-2 z-10 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-56">
            <div className="text-11 font-semibold uppercase tracking-wide text-slate-400">Page</div>
            <a href={d.final_url || d.url} target="_blank" rel="noreferrer" className="text-14 font-semibold text-slate-900 hover:text-indigo-600 inline-flex items-center gap-1 break-all">{d.final_url || d.url}<ExternalLink size={12} className="shrink-0" /></a>
            <div className="text-12 text-slate-500 mt-0.5">HTTP {dash(d.status)} · {dash(d.response_ms)} ms · {dash(d.size_kb)} KB · {d.https ? 'https' : 'not https'}{arr(d.redirects).length > 0 && ` · ${d.redirects.length} redirect${d.redirects.length > 1 ? 's' : ''}`}</div>
          </div>
          <div className="flex gap-4">
            {SCORE_AREAS.map(([k, label]) => { const sc = d.scores?.[k]; return (
              <div key={k} className="flex items-center gap-2" aria-label={`${label} score ${sc ? sc.score : 'not available'}`}>
                <Ring score={sc?.score} />
                <div><div className="text-13 font-semibold text-slate-900">{label}</div><div className={`text-12 tabular-nums ${tone(sc?.score)}`}>{sc ? `${sc.passed} of ${sc.total} checks` : '—'}</div></div>
              </div>
            ); })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={copied ? Check : Copy} onClick={doCopy}>{copied ? 'Copied' : 'Copy report'}</Button>
            <Button size="sm" icon={Download} onClick={() => download(`page-xray-${slug(d.final_url || d.url)}.json`, JSON.stringify(d, null, 2), 'application/json')}>JSON</Button>
            <Button size="sm" icon={Download} onClick={() => download(`page-xray-${slug(d.final_url || d.url)}.csv`, checksCsv(d), 'text/csv;charset=utf-8')}>CSV</Button>
            <Button size="sm" icon={RefreshCw} busy={busy} onClick={onRerun}>Re-run</Button>
          </div>
        </div>
        {arr(d.notes).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{d.notes.map((n, i) => <span key={i} className="text-11.5 text-amber-800 bg-amber-50 rounded-full px-2.5 py-0.5 inline-flex items-center gap-1"><AlertTriangle size={11} />{n}</span>)}</div>}
      </div>

      {arr(d.summary).length > 0 && (
        <Section title="Top fixes" hint="the biggest wins first" count={d.summary.length}>
          <ul className="divide-y divide-slate-100">{d.summary.map((f, i) => <li key={i} className="py-2.5 flex gap-3"><Badge tone={f.area === 'SEO' || f.area === 'seo' ? 'blue' : f.area === 'AEO' || f.area === 'aeo' ? 'violet' : 'green'}>{String(f.area || '').toUpperCase()}</Badge><div className="min-w-0"><div className="text-13 font-medium text-slate-900">{f.label}</div>{f.fix && <div className="text-12.5 text-slate-600 mt-0.5">{f.fix}</div>}</div></li>)}</ul>
        </Section>
      )}

      {SCORE_AREAS.map(([k, label]) => (
        <Section key={k} title={`${label} checks`} hint={k === 'seo' ? 'classic on-page and technical signals' : k === 'aeo' ? 'ready to be quoted as an answer' : 'ready for AI search and crawlers'} defaultOpen={k === 'seo'} count={d.scores?.[k] ? `${d.scores[k].passed}/${d.scores[k].total}` : undefined}>
          <CheckList area={d.scores?.[k]} />
        </Section>
      ))}

      <Section title="Meta & indexing" defaultOpen>
        <Row label="Title"><div>{dash(m.title)}</div><div className="mt-1"><Meter value={m.title_len} max={60} label="characters" /></div></Row>
        <Row label="Description"><div>{dash(m.description)}</div><div className="mt-1"><Meter value={m.description_len} max={160} label="characters" /></div></Row>
        <Row label="Canonical">{m.canonical ? <>{m.canonical}{m.canonical_self != null && <Badge tone={m.canonical_self ? 'green' : 'amber'}>{m.canonical_self ? 'points to itself' : 'points elsewhere'}</Badge>}</> : '—'}</Row>
        <Row label="Robots meta">{dash(m.robots_meta)}</Row>
        <Row label="X-Robots-Tag">{dash(m.x_robots_tag)}</Row>
        <Row label="Language">{dash(m.lang)}</Row>
        <Row label="Charset">{dash(m.charset)}</Row>
        <Row label="Viewport">{dash(m.viewport)}</Row>
        <Row label="Generator">{dash(m.generator)}</Row>
        <Row label="hreflang">{arr(m.hreflang).length ? <ul className="space-y-0.5">{m.hreflang.map((h, i) => <li key={i} className="text-12.5"><b>{h.lang}</b> <span className="text-slate-500 break-all">{h.url}</span></li>)}</ul> : '—'}</Row>
        {arr(d.redirects).length > 0 && <Row label="Redirects"><ul className="space-y-0.5">{d.redirects.map((r, i) => <li key={i} className="text-12.5 break-all"><b>{r.status}</b> {r.url}</li>)}</ul></Row>}
      </Section>

      <Section title="Social preview" hint="how it looks in Google and when shared" defaultOpen={false}><SocialPreview d={d} /></Section>

      <Section title="Content" defaultOpen={false}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {[['Words', c.word_count], ['Reading ease', c.reading_ease], ['Images', c.images?.total], ['Missing alt', c.images?.missing_alt], ['Internal links', c.links?.internal], ['External links', c.links?.external], ['Nofollow', c.links?.nofollow], ['Lazy images', c.images?.lazy]].map(([l, v]) => <div key={l} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-11.5 text-slate-500">{l}</div><div className="text-16 font-bold text-slate-900 tabular-nums">{dash(v)}</div></div>)}
        </div>
        <Row label="Headings"><div className="flex flex-wrap gap-1.5">{['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(h => <span key={h} className="text-12 rounded bg-slate-100 text-slate-700 px-2 py-0.5 tabular-nums">{h.toUpperCase()} {c.headings?.[h] ?? '—'}</span>)}</div></Row>
        <Row label="H1 text">{arr(c.h1_texts).length ? c.h1_texts.join(' · ') : '—'}</Row>
        <Row label="Outline"><Outline items={c.outline} /></Row>
      </Section>

      <Section title="Structured data" defaultOpen={false}>
        <Row label="Types"><Chips items={arr(s.types)} tint="bg-indigo-50 text-indigo-700" /></Row>
        <Row label="JSON-LD blocks">{arr(s.json_ld).length ? <div className="flex flex-wrap gap-1.5">{s.json_ld.map((j, i) => <span key={i} className={`text-12 rounded-full px-2.5 py-0.5 inline-flex items-center gap-1 ${j.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{j.valid ? <Check size={11} /> : <X size={11} />}{j.type || 'unknown'}</span>)}</div> : '—'}</Row>
        <Row label="Microdata / RDFa">{`${s.microdata ?? '—'} / ${s.rdfa ?? '—'}`}</Row>
        {arr(s.errors).length > 0 && <Row label="Problems"><ul className="list-disc pl-4 text-12.5 text-red-700 space-y-0.5">{s.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Row>}
      </Section>

      <Section title="Tech stack" defaultOpen>
        {techGroups.map(([label, items]) => <Row key={label} label={label}><Chips items={items} /></Row>)}
        <Row label="Compression">{dash(t.compression)}</Row>
        <Row label="Cache-Control">{dash(t.cache_control)}</Row>
        <Row label="Security headers">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{SEC_HEADERS.map(([k, l]) => { const ok = Boolean(t.security_headers?.[k]); return <span key={k} className={`text-12.5 inline-flex items-center gap-1.5 ${ok ? 'text-emerald-700' : 'text-slate-400'}`}>{ok ? <Check size={13} /> : <X size={13} />}{l}</span>; })}</div>
          <div className="text-12 text-slate-500 mt-1">{secCount(d)} of 6 present</div>
        </Row>
      </Section>

      <Section title="Domain & SSL" defaultOpen={false}>
        <Row label="Domain">{dash(dom.domain)}</Row>
        <Row label="Domain age">{age(dom.age_days)}</Row>
        <Row label="Registered">{fmtDate(dom.registered_at)}</Row>
        <Row label="Expires">{fmtDate(dom.expires_at)}</Row>
        <Row label="Registrar">{dash(dom.registrar)}</Row>
        <Row label="Nameservers"><Chips items={dom.nameservers} /></Row>
        {dom.error && <Row label="Domain lookup"><span className="text-amber-700">{dom.error}</span></Row>}
        <Row label="SSL certificate">{ssl.valid == null ? '—' : <span className={`inline-flex items-center gap-1.5 ${ssl.valid ? 'text-emerald-700' : 'text-red-600'}`}>{ssl.valid ? <Lock size={13} /> : <ShieldAlert size={13} />}{ssl.valid ? 'Valid' : 'Not valid'}</span>}</Row>
        <Row label="Issuer">{dash(ssl.issuer)}</Row>
        <Row label="Expires">{ssl.days_left != null ? <span className={ssl.days_left < 30 ? 'text-red-600 font-medium' : ''}>{fmtDate(ssl.expires_at)} · {ssl.days_left} days left{ssl.days_left < 30 ? ' (renew soon)' : ''}</span> : fmtDate(ssl.expires_at)}</Row>
        {ssl.error && <Row label="SSL check"><span className="text-amber-700">{ssl.error}</span></Row>}
      </Section>

      <Section title="Crawlers & AI access" defaultOpen={false}>
        <Row label="robots.txt">{rb.found == null ? '—' : <span className="inline-flex items-center gap-1.5">{rb.found ? <Check size={13} className="text-emerald-600" /> : <X size={13} className="text-red-500" />}{rb.found ? 'Found' : 'Not found'}{rb.url && <a href={rb.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-12">open</a>}</span>}</Row>
        <Row label="This page is">{rb.allows_page == null ? '—' : <Badge tone={rb.allows_page ? 'green' : 'red'}>{rb.allows_page ? 'allowed to crawl' : 'blocked by robots.txt'}</Badge>}</Row>
        <Row label="Sitemaps">{arr(rb.sitemaps).length ? <ul className="space-y-0.5">{rb.sitemaps.map((x, i) => <li key={i} className="text-12.5 break-all">{x}</li>)}</ul> : '—'}</Row>
        <Row label="llms.txt">{d.llms_txt?.found == null ? '—' : <span className="inline-flex items-center gap-1.5">{d.llms_txt.found ? <Check size={13} className="text-emerald-600" /> : <X size={13} className="text-red-500" />}{d.llms_txt.found ? 'Found' : 'Not found'}{d.llms_txt.url && d.llms_txt.found && <a href={d.llms_txt.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-12">open</a>}</span>}</Row>
        <Row label="AI crawlers">{arr(rb.ai_crawlers).length ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{rb.ai_crawlers.map(x => <span key={x.bot} className={`text-12.5 inline-flex items-center gap-1.5 ${x.allowed ? 'text-emerald-700' : 'text-red-600'}`}>{x.allowed ? <Check size={13} /> : <X size={13} />}{x.bot} {x.allowed ? 'allowed' : 'blocked'}</span>)}</div> : '—'}</Row>
      </Section>
    </div>
  );
}

// Rows of the comparison table. dir: 'high' = bigger is better, 'low' = smaller is better, null = no ranking.
const COMPARE = [
  ['SEO score', d => d.scores?.seo?.score, 'high'], ['AEO score', d => d.scores?.aeo?.score, 'high'], ['GEO score', d => d.scores?.geo?.score, 'high'],
  ['Title length', d => d.meta?.title_len, null], ['Description length', d => d.meta?.description_len, null], ['Word count', d => d.content?.word_count, 'high'],
  ['H1 count', d => d.content?.headings?.h1, null], ['Images missing alt', d => d.content?.images?.missing_alt, 'low'],
  ['Schema types', d => arr(d.schema?.types).join(', ') || null, null, 'text'], ['CMS', d => arr(d.tech?.cms).join(', ') || null, null, 'text'],
  ['Analytics tools', d => analyticsCount(d), 'high'], ['Security headers (of 6)', d => secCount(d), 'high'],
  ['Domain age (days)', d => d.domain?.age_days, 'high', 'age'], ['SSL days left', d => d.ssl?.days_left, null],
  ['AI crawlers allowed', d => (aiTotal(d) ? aiAllowed(d) : null), 'high', 'ai'], ['llms.txt', d => (d.llms_txt?.found == null ? null : d.llms_txt.found ? 'Yes' : 'No'), null, 'text'],
  ['Response time (ms)', d => d.response_ms, 'low']
];

function Compare({ items, onOpen, active }) {
  const cols = items.filter(i => i.data);
  const cell = (d, def) => { const [, get, , kind] = def; const v = get(d); if (v == null || v === '') return '—'; if (kind === 'age') return age(v); if (kind === 'ai') return `${v} of ${aiTotal(d)}`; if (typeof v === 'number' && def[0].includes('Security')) return `${v}/6`; return String(v); };
  const rank = (def) => {
    const [, get, dir] = def; if (!dir) return {};
    const vals = cols.map(c => get(c.data)).map(v => (typeof v === 'number' ? v : null));
    const nums = vals.filter(v => v != null); if (nums.length < 2 || Math.min(...nums) === Math.max(...nums)) return {};
    const best = dir === 'high' ? Math.max(...nums) : Math.min(...nums), worst = dir === 'high' ? Math.min(...nums) : Math.max(...nums);
    return { best, worst };
  };
  const exportCsv = () => download('page-xray-comparison.csv', toCsv([['Metric', ...cols.map(c => c.data.final_url || c.url)], ...COMPARE.map(def => [def[0], ...cols.map(c => cell(c.data, def))])]), 'text/csv;charset=utf-8');
  return (
    <Card title="Comparison" subtitle="Best value in each row is green, the weakest is red. Click a page to open its full report below." action={<Button size="sm" icon={Download} onClick={exportCsv}>Download comparison CSV</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full text-13">
          <thead><tr className="border-b border-slate-200"><th className="p-2 text-left font-medium text-slate-500 w-44">Metric</th>
            {cols.map(c => <th key={c.url} className="p-2 text-left"><button type="button" onClick={() => onOpen(c.url)} className={`text-left font-semibold cursor-pointer hover:text-indigo-600 break-all ${active === c.url ? 'text-indigo-700' : 'text-slate-900'}`}>{hostOf(c.data.final_url || c.url)}<span className="block text-11 font-normal text-slate-400">{active === c.url ? 'shown below' : 'open report'}</span></button></th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {COMPARE.map(def => { const r = rank(def); return (
              <tr key={def[0]}><td className="p-2 text-slate-600">{def[0]}</td>
                {cols.map(c => { const raw = def[1](c.data); const num = typeof raw === 'number' ? raw : null; const cls = num != null && r.best != null ? (num === r.best ? 'bg-emerald-50 text-emerald-800 font-semibold' : num === r.worst ? 'bg-red-50 text-red-700' : '') : ''; return <td key={c.url} className={`p-2 tabular-nums ${cls}`}>{cell(c.data, def)}</td>; })}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function XRay({ b }) {
  const [input, setInput] = useState('');
  const [urls, setUrls] = useState([]);
  const [results, setResults] = useState({}); // url -> {state, data, error}
  const [active, setActive] = useState(null);
  const [formError, setFormError] = useState('');
  const seq = useRef(0);
  const comps = useApi(`/businesses/${b.id}/gbp/competitors`);
  const comps2 = useApi(`/competitors?business_id=${b.id}`);

  const suggestions = useMemo(() => {
    const out = [];
    for (const c of [...arr(comps.data?.competitors), ...(Array.isArray(comps2.data) ? comps2.data : [])]) {
      if (c?.website && !out.some(o => hostOf(o.url) === hostOf(c.website))) out.push({ url: c.website, name: c.name || hostOf(c.website) });
    }
    return out.slice(0, 6);
  }, [comps.data, comps2.data]);

  const run = useCallback(async (list) => {
    const mine = ++seq.current;
    setResults(r => ({ ...r, ...Object.fromEntries(list.map(u => [u, { state: 'loading' }])) }));
    const settled = await Promise.allSettled(list.map(u => api(`/businesses/${b.id}/page-xray`, { method: 'POST', body: { url: u } })));
    if (mine !== seq.current && list.length > 1) { /* a newer run started: keep the latest answers per url anyway */ }
    setResults(r => {
      const next = { ...r };
      settled.forEach((s, i) => { next[list[i]] = s.status === 'fulfilled' ? { state: 'done', data: s.value } : { state: 'error', error: s.reason?.message || 'The page could not be inspected.' }; });
      return next;
    });
  }, [b.id]);

  const add = (raw) => {
    const u = normaliseUrl(raw);
    if (!u || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u)) { setFormError('Enter a full web address, for example https://example.com/page'); return null; }
    setFormError('');
    if (urls.includes(u)) return u;
    if (urls.length >= MAX_URLS) { setFormError(`You can compare up to ${MAX_URLS} pages. Remove one first.`); return null; }
    setUrls(x => [...x, u]);
    return u;
  };
  const remove = (u) => { setUrls(x => x.filter(i => i !== u)); setResults(r => { const n = { ...r }; delete n[u]; return n; }); if (active === u) setActive(null); };
  const addOnly = (raw) => { const u = add(raw); if (u) setInput(''); };
  const inspect = async () => {
    let list = urls;
    if (input.trim()) { const u = add(input); if (!u) return; list = urls.includes(u) ? urls : [...urls, u]; setInput(''); }
    if (!list.length) { setFormError('Enter a page address to inspect.'); return; }
    setActive(list[0]);
    await run(list);
  };
  const useSite = () => { if (b.website) { const u = add(b.website); if (u) { setActive(u); run(urls.includes(u) ? urls : [...urls, u]); } } };
  const items = urls.map(u => ({ url: u, ...(results[u] || { state: 'idle' }) }));
  const loading = items.some(i => i.state === 'loading');
  const done = items.filter(i => i.state === 'done');
  const shown = items.find(i => i.url === active && i.state === 'done') || (done.length === 1 ? done[0] : null);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Globe size={15} className="absolute left-3 top-3 text-slate-400" aria-hidden="true" />
            <input value={input} onChange={e => { setInput(e.target.value); setFormError(''); }} onKeyDown={e => { if (e.key === 'Enter') inspect(); }} placeholder="https://… any page" aria-label="Page address to inspect" inputMode="url"
              className="w-full h-10 pl-9 pr-3 text-13 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 placeholder-slate-400" />
          </div>
          <Button variant="primary" icon={Search} busy={loading} onClick={inspect} className="h-10 px-5">Inspect</Button>
          <Button icon={Plus} disabled={!input.trim() || urls.length >= MAX_URLS} onClick={() => addOnly(input)} title="Keep this page and add another to compare">Add to compare</Button>
        </div>
        {formError && <p className="text-12.5 text-red-600 mt-2" role="alert">{formError}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {b.website && <button type="button" onClick={useSite} className="h-7 px-3 rounded-full text-12 font-semibold ring-1 ring-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer">Use my website · {hostOf(b.website)}</button>}
          {suggestions.length > 0 && <span className="text-11.5 text-slate-400 ml-1">Competitors:</span>}
          {suggestions.map(s => <button key={s.url} type="button" onClick={() => addOnly(s.url)} disabled={urls.length >= MAX_URLS} title={s.url} className="h-7 px-3 rounded-full text-12 ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"><Plus size={11} />{s.name.length > 24 ? `${s.name.slice(0, 22)}…` : s.name}</button>)}
        </div>
        {urls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
            {items.map(i => (
              <span key={i.url} className={`inline-flex items-center gap-2 rounded-lg ring-1 px-3 py-1.5 text-12.5 ${i.state === 'error' ? 'ring-red-200 bg-red-50 text-red-800' : i.state === 'done' ? 'ring-emerald-200 bg-emerald-50 text-emerald-900' : 'ring-slate-200 bg-white text-slate-700'}`}>
                {i.state === 'loading' ? <Loader2 size={13} className="animate-spin" /> : i.state === 'done' ? <Check size={13} /> : i.state === 'error' ? <AlertTriangle size={13} /> : <FileText size={13} />}
                <span className="max-w-[260px] truncate" title={i.url}>{hostOf(i.url)}{(() => { try { const p = new URL(i.url).pathname; return p && p !== '/' ? p : ''; } catch { return ''; } })()}</span>
                <button type="button" onClick={() => remove(i.url)} aria-label={`Remove ${i.url}`} className="text-slate-400 hover:text-red-600 cursor-pointer"><X size={13} /></button>
              </span>
            ))}
          </div>
        )}
        {items.filter(i => i.state === 'error').map(i => <p key={i.url} className="text-12.5 text-red-600 mt-2" role="alert"><b>{hostOf(i.url)}:</b> {i.error}</p>)}
        <div className="sr-only" aria-live="polite">{loading ? 'Inspecting pages…' : done.length ? `${done.length} page${done.length > 1 ? 's' : ''} inspected` : ''}</div>
      </Card>

      {loading && done.length === 0 && <Card><div className="py-10 flex flex-col items-center gap-2 text-slate-500"><Loader2 className="animate-spin" /><div className="text-13">Opening the page and reading its HTML, headers, certificate, domain record and robots.txt…</div></div></Card>}

      {done.length === 0 && !loading && urls.length === 0 && (
        <Card><div className="py-8 text-center max-w-xl mx-auto">
          <span className="inline-flex w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 items-center justify-center"><ShieldCheck size={22} /></span>
          <div className="text-16 font-semibold text-slate-900 mt-3">Inspect any page in one click</div>
          <p className="text-13 text-slate-500 mt-1">Type a page address, or press <b>Use my website</b>. You get SEO, AEO and GEO checks, the tech stack, domain age, SSL, security headers and AI-crawler access, all read live from the page. Add up to three pages to compare them side by side.</p>
        </div></Card>
      )}

      {done.length >= 2 && <Compare items={items} onOpen={setActive} active={shown?.url} />}
      {done.length >= 2 && !shown && <p className="text-13 text-slate-500 text-center">Click a page name in the table to open its full report.</p>}
      {shown && <Report key={shown.url + (shown.data?.fetched_at || '')} d={shown.data} busy={shown.state === 'loading'} onRerun={() => run([shown.url])} />}
    </div>
  );
}

export default function PageXRayPage() {
  return (
    <SeoShell title="Page X-Ray" subtitle="Inspect any page in one click: SEO, answer-engine (AEO) and AI-search (GEO) readiness, tech stack, domain and security. Real data from the live page.">
      {(b) => <XRay key={b.id} b={b} />}
    </SeoShell>
  );
}
