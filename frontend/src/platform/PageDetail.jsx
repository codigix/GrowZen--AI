import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, ExternalLink, RefreshCw, Copy, Download, Loader2 } from 'lucide-react';
import { Drawer, Button, Badge, Tabs, ErrorNote } from './SeoUi';
import { api } from './seoApi';
import { downloadFile } from './DataTable';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const nice = (v) => (v ? String(v).replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : '—');

const LOOK = {
  good: ['bg-emerald-50 ring-emerald-200', 'text-emerald-600', CheckCircle2],
  warn: ['bg-amber-50 ring-amber-200', 'text-amber-600', AlertTriangle],
  bad: ['bg-rose-50 ring-rose-200', 'text-rose-600', XCircle],
  none: ['bg-slate-50 ring-slate-200', 'text-slate-500', HelpCircle],
};

/** The big answer at the top: a coloured icon, one sentence, and the line under it. */
function Verdict({ tone, title, text, children }) {
  const [box, ic, Icon] = LOOK[tone] || LOOK.none;
  return (
    <div className={`rounded-xl ring-1 ring-inset p-4 ${box}`}>
      <div className="flex items-start gap-3"><Icon size={26} className={`${ic} shrink-0 mt-0.5`} /><div className="min-w-0 flex-1"><div className="text-16 font-semibold text-slate-900">{title}</div>{text && <p className="text-13 text-slate-700 mt-0.5">{text}</p>}{children}</div></div>
    </div>
  );
}

/** A labelled list of facts, one per line, like the tables in Search Console. */
const Facts = ({ title, rows }) => (
  <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
    <div className="px-4 py-2 bg-slate-50 text-12 font-semibold uppercase tracking-wide text-slate-500">{title}</div>
    <dl className="divide-y divide-slate-100">
      {rows.filter(r => r[2] !== false).map(([k, v, , hint]) => (
        <div key={k} className="px-4 py-2 grid grid-cols-[170px_1fr] gap-3 text-13" title={hint}><dt className="text-slate-500">{k}</dt><dd className="text-slate-900 break-words min-w-0">{v ?? '—'}</dd></div>))}
    </dl>
  </div>
);

const A = ({ href }) => (href ? <a href={href} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline break-all">{href}</a> : '—');

function GoogleView({ d }) {
  const g = d.google;
  if (!g) return <Verdict tone="none" title="Google has not told us about this page" text={d.google_error || 'Connect Search Console for this project to ask Google.'} />;
  const tone = g.state === 'indexed' ? 'good' : g.state === 'blocked' ? 'bad' : g.state === 'not_indexed' ? 'warn' : 'none';
  const title = g.state === 'indexed' ? 'URL is on Google' : g.state === 'blocked' ? 'URL is blocked from Google' : g.state === 'not_indexed' ? 'URL is not on Google' : 'Google gave no clear answer';
  const sameCanon = g.google_canonical && g.user_canonical && g.google_canonical === g.user_canonical;
  return (
    <div className="space-y-3">
      <Verdict tone={tone} title={title} text={g.coverage || undefined}>
        {g.advice && <p className="text-12.5 text-slate-700 mt-2">{g.advice}</p>}
        {g.link && <div className="mt-3"><a href={g.link} target="_blank" rel="noreferrer noopener"><Button size="sm" variant="primary" icon={ExternalLink}>{g.state === 'indexed' ? 'Open in Search Console' : 'Open in Search Console to request indexing'}</Button></a></div>}
      </Verdict>
      <Facts title="Page availability" rows={[
        ['Coverage', g.coverage], ['Last crawl', when(g.last_crawl)], ['Crawled as', nice(g.crawled_as)], ['Page fetch', nice(g.fetch)],
        ['Allowed by robots.txt', g.robots === 'ALLOWED' ? 'Yes' : g.robots === 'DISALLOWED' ? 'No: blocked by robots.txt' : nice(g.robots)], ['Indexing allowed', nice(g.indexing).replace('Indexing state unspecified', 'No restriction found')],
        ['Page you declared as canonical', <A key="u" href={g.user_canonical} />], ['Canonical Google chose', g.google_canonical ? <span key="g"><A href={g.google_canonical} />{sameCanon && <Badge tone="green"> same</Badge>}</span> : 'Not shown'],
      ]} />
      {(g.sitemaps.length > 0 || g.referring.length > 0) && <Facts title="Discovery" rows={[['Sitemaps', g.sitemaps.length ? g.sitemaps.map(s => <div key={s}><A href={s} /></div>) : '—'], ['Referring pages', g.referring.length ? g.referring.map(s => <div key={s}><A href={s} /></div>) : '—']]} />}
      <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 text-12 font-semibold uppercase tracking-wide text-slate-500">Enhancements &amp; experience</div>
        <div className="px-4 py-3 text-13 space-y-3">
          {g.mobile && g.mobile.verdict && g.mobile.verdict !== 'VERDICT_UNSPECIFIED' && <div><b>Mobile usability:</b> {nice(g.mobile.verdict)}{g.mobile.issues.map((i, k) => <div key={k} className="text-amber-800 text-12.5">• {i.message || nice(i.type)}</div>)}</div>}
          {g.rich?.items?.length > 0 ? g.rich.items.map(r => (
            <div key={r.type}><b>{r.type}</b> <span className="text-slate-500">({r.items.length})</span>{r.items.flatMap(i => i.issues).map((x, k) => <div key={k} className={x.severity === 'ERROR' ? 'text-rose-700 text-12.5' : 'text-amber-800 text-12.5'}>• {x.message}</div>)}</div>))
            : !(g.mobile && g.mobile.verdict && g.mobile.verdict !== 'VERDICT_UNSPECIFIED') && <p className="text-slate-600">URL has no enhancements.</p>}
        </div>
      </div>
      <p className="text-11.5 text-slate-500">This is what Google holds for the page from its last crawl. Press <b>Request indexing</b> only works inside Search Console: Google does not allow it from other software.</p>
    </div>
  );
}

function LiveView({ d, onRetest, busy }) {
  const l = d.live;
  const [tab, setTab] = useState('info');
  const [copied, setCopied] = useState(false);
  if (!l.ok) return <Verdict tone="bad" title="The page could not be loaded" text={l.error} />;
  const v = l.check?.verdict;
  const tone = v === 'indexable' ? 'good' : v === 'blocked' ? 'bad' : 'warn';
  const copy = async () => { try { await navigator.clipboard.writeText(l.html); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return (
    <div className="space-y-3">
      <Verdict tone={tone} title={v === 'indexable' ? 'Page can be indexed' : v === 'blocked' ? 'Page cannot be indexed' : 'Page can be indexed, with warnings'} text={`Tested on ${when(l.tested_at)}, answered HTTP ${l.status} in ${l.ms} ms.`}>
        {(l.check?.reasons || []).map((r, i) => <p key={i} className={`text-12.5 mt-1.5 ${r.level === 'blocked' ? 'text-rose-800' : 'text-amber-900'}`}>• {r.text}</p>)}
        <div className="mt-3"><Button size="sm" icon={busy ? Loader2 : RefreshCw} disabled={busy} onClick={onRetest}>Test again</Button></div>
      </Verdict>
      <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
        <div className="px-4 pt-2 flex items-center gap-2 border-b border-slate-100"><span className="text-12 font-semibold uppercase tracking-wide text-slate-500 mr-2">Tested page</span>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'info', label: 'More info' }, { id: 'html', label: 'HTML' }]} /></div>
        {tab === 'info' ? (
          <dl className="divide-y divide-slate-100">
            {[['HTTP status', l.status], ['Final address', <A key="f" href={l.final_url} />], ['Redirects', l.redirects.length ? l.redirects.map(r => <div key={r}>{r}</div>) : 'None'], ['Load time', `${l.ms} ms`], ['Size', `${(l.bytes / 1024).toFixed(1)} KB`],
              ['Content type', l.content_type], ['X-Robots-Tag header', l.x_robots || 'None'], ['Robots meta tag', l.robots_meta || 'None'], ['Canonical tag', <A key="c" href={l.canonical} />], ['Language', l.lang],
              ['Title', l.title], ['Meta description', l.description], ['Main heading (H1)', l.h1.length ? l.h1.join(' | ') : 'None found'], ['Structured data', l.schema_types.length ? l.schema_types.join(', ') : 'None found'],
              ['Open Graph', Object.keys(l.og).length ? Object.entries(l.og).map(([k, x]) => <div key={k}><span className="text-slate-500">{k}:</span> {x}</div>) : 'None'], ['Words readable without JavaScript', l.check?.words ?? '—']].map(([k, val]) => (
              <div key={k} className="px-4 py-2 grid grid-cols-[190px_1fr] gap-3 text-13"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900 break-words min-w-0">{val ?? '—'}</dd></div>))}
          </dl>
        ) : (
          <div>
            <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-100"><Button size="sm" icon={Copy} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button><Button size="sm" icon={Download} onClick={() => downloadFile('page.html', l.html, 'text/html')}>Download</Button>{l.html_truncated && <span className="text-11.5 text-amber-700">Only the first 60,000 characters are shown.</span>}</div>
            <pre className="p-4 text-11.5 leading-relaxed font-mono bg-slate-900 text-slate-100 overflow-auto max-h-[520px] whitespace-pre-wrap break-all">{l.html || 'The page is not HTML.'}</pre>
          </div>
        )}
      </div>
      <p className="text-11.5 text-slate-500">This is our own test: the page is loaded now the way a crawler loads it. Google's live test and screenshot exist only inside Search Console and are not offered to other software.</p>
    </div>
  );
}

/** One page in full, like Search Console's URL inspection: what Google holds for it, and a fresh test of the page itself. */
export default function PageDetail({ bid, url, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('google');
  const load = async (first = false) => {
    setBusy(true); setError('');
    try { setD(await api(`/businesses/${bid}/indexing/page-detail`, { method: 'POST', body: { url }, timeout: 90000 })); if (!first) onChanged?.(); } catch (e) { setError(e.message || 'Could not read the page.'); } finally { setBusy(false); }
  };
  useEffect(() => { setD(null); if (url) load(true); }, [url]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when another page is opened
  return (
    <Drawer open={Boolean(url)} onClose={onClose} width="max-w-3xl" title="URL inspection" subtitle={url}>
      <ErrorNote>{error}</ErrorNote>
      {!d ? <div className="py-16 text-center text-13 text-slate-500 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />Asking Google and testing the page…</div> : (
        <div className="space-y-3">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'google', label: 'Google index' }, { id: 'live', label: 'Live test' }]} />
          {tab === 'google' ? <GoogleView d={d} /> : <LiveView d={d} onRetest={() => load(false)} busy={busy} />}
        </div>
      )}
    </Drawer>
  );
}
