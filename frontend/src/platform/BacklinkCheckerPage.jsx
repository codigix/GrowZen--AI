import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, HelpCircle, Link2, Loader2, RefreshCw, Search, Trash2, XCircle } from 'lucide-react';
import { SeoShell, Button } from './SeoUi';
import Select from '../components/Select';
import { api } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const when = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const Card = ({ children, className = '' }) => <section className={`bg-white rounded-xl border border-slate-200 shadow-sm min-w-0 ${className}`}>{children}</section>;
const Chip = ({ children, cls = 'bg-slate-100 text-slate-700', title }) => <span title={title} className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium whitespace-nowrap ${cls}`}>{children}</span>;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function State({ r }) {
  if (r.lost) return <Chip cls="bg-red-50 text-red-700" title="It worked at the check before and is gone now"><XCircle size={12} />Link lost</Chip>;
  if (r.state === 'working') return <Chip cls="bg-emerald-50 text-emerald-700"><CheckCircle2 size={12} />Working</Chip>;
  if (r.state === 'link_missing') return <Chip cls="bg-amber-50 text-amber-800" title="The page opens but has no link to your site"><XCircle size={12} />Link missing</Chip>;
  if (r.state === 'unconfirmed') return <Chip cls="bg-violet-50 text-violet-700" title={r.error}><HelpCircle size={12} />Cannot confirm</Chip>;
  return <Chip cls="bg-red-50 text-red-700" title={r.error}><AlertTriangle size={12} />Page error{r.http_status ? ` ${r.http_status}` : ''}</Chip>;
}

const FOLLOW = { dofollow: ['Follow', 'bg-emerald-50 text-emerald-700'], nofollow: ['Nofollow', 'bg-slate-100 text-slate-700'], sponsored: ['Sponsored', 'bg-slate-100 text-slate-700'], ugc: ['UGC', 'bg-slate-100 text-slate-700'] };
const Moz = ({ v, on }) => (v == null ? <span className="text-slate-300" title={on ? 'Moz has no data for this page' : 'Needs a Moz API key'}>—</span> : <span className="tabular-nums text-slate-800">{v}</span>);

function BacklinkChecker({ b }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('all');
  const [follow, setFollow] = useState('all');
  const [openId, setOpenId] = useState(null);
  const load = useCallback(async () => {
    try { const r = await api(`/businesses/${b.id}/backlink-check`); setD(r); setTarget(t => t || r.default_target || ''); setError(''); } catch (e) { setError(e.message || 'Could not load the saved checks.'); }
  }, [b.id]);
  useEffect(() => { setD(null); load(); }, [load]);

  const run = async (sources) => {
    const list = [...new Set(sources.map(s => s.trim()).filter(Boolean))];
    if (!list.length) { setNote('Add at least one page address to check.'); return; }
    setBusy(true); setNote('');
    try {
      const r = await api(`/businesses/${b.id}/backlink-check`, { method: 'POST', body: { target: target.trim() || null, sources: list.slice(0, d?.limit || 25) }, timeout: 170000 });
      setNote(r.note || '');
      await load();
    } catch (e) { setNote(e.message || 'The check did not finish.'); } finally { setBusy(false); }
  };
  const fromCrawler = async () => {
    setBusy(true); setNote('');
    try { const r = await api(`/businesses/${b.id}/backlink-check/candidates`); if (r.urls?.length) setText(r.urls.slice(0, d?.limit || 25).join('\n')); setNote(r.note || `${r.urls.length} pages found by the crawler were added to the list: press Check links.`); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const remove = async (id) => { try { await api(`/businesses/${b.id}/backlink-check/${id}`, { method: 'DELETE' }); await load(); } catch (e) { setNote(e.message); } };

  const rows = useMemo(() => arr(d?.rows).filter(r => (status === 'all' || (status === 'lost' ? r.lost : r.state === status)) && (follow === 'all' || (follow === 'nofollow' ? ['nofollow', 'sponsored', 'ugc'].includes(r.follow) : r.follow === follow))), [d, status, follow]);
  const csv = () => {
    const head = ['Source page', 'Status', 'HTTP', 'Follow', 'Anchor', 'Category', 'Placement', 'Page indexable', 'DA', 'PA', 'Spam score', 'Referring domains', 'Target', 'Checked'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat(rows.map(r => [r.source_url, r.lost ? 'lost' : r.state, r.http_status, r.follow, r.link?.anchor, r.category?.label, r.link?.placement, r.page_noindex == null ? '' : r.page_noindex ? 'noindex' : 'yes', r.moz?.da, r.moz?.pa, r.moz?.spam, r.moz?.ref_domains, r.target, r.checked_at].map(q).join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'backlink-check.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (error && !d) return <Card className="p-6 text-13 text-red-700">{error} <button type="button" className="font-semibold underline cursor-pointer" onClick={load}>Try again</button></Card>;
  if (!d) return <div className="space-y-4" role="status" aria-busy="true"><div className="h-40 rounded-xl bg-slate-100 animate-pulse" /><div className="h-64 rounded-xl bg-slate-100 animate-pulse" /></div>;
  const s = d.summary || {};
  const tiles = [['Working', s.working, 'text-emerald-700'], ['Link missing', s.missing, 'text-amber-700'], ['Cannot confirm', s.unconfirmed, 'text-violet-700'], ['Page errors', s.errors, 'text-red-700'], ['Follow', s.dofollow, 'text-slate-900'], ['Nofollow', s.nofollow, 'text-slate-900'], ['Noindex pages', s.noindex, 'text-slate-900']];
  return (
    <div className="space-y-5 min-w-0">
      <Card className="p-4 sm:p-5">
        <h3 className="text-15 font-semibold text-slate-900 flex items-center gap-2"><Link2 size={16} className="text-indigo-600" />Check your backlinks</h3>
        <p className="mt-1 text-12.5 text-slate-500">Paste the pages that should link to you. Each is opened live: is the link there, follow or nofollow, its anchor text, and what kind of site it is.</p>
        <div className="mt-3 grid lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4">
          <div><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="bc-target">Links must point to</label>
            <input id="bc-target" value={target} onChange={e => setTarget(e.target.value)} placeholder="yoursite.com or yoursite.com/page" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-14" />
            <p className="mt-1 text-12 text-slate-500">A website, or one page of it.</p></div>
          <div><label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor="bc-urls">Pages that link to you (one per line, up to {d.limit})</label>
            <textarea id="bc-urls" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={'https://blog.example.com/best-salons\nhttps://directory.example/listing/yours'} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-13 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" icon={busy ? Loader2 : Search} disabled={busy} onClick={() => run(text.split(/\s+/))}>{busy ? 'Checking pages…' : 'Check links'}</Button>
          <Button icon={RefreshCw} disabled={busy || !d.rows.length} onClick={() => run(d.rows.slice(0, d.limit).map(r => r.source_url))} title="Open the saved pages again">Re-check saved pages</Button>
          <Button disabled={busy} onClick={fromCrawler}>Use pages found by our crawler</Button>
        </div>
        {note && <p className="mt-3 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{note}</p>}
        {!d.moz && <p className="mt-3 text-12.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />Domain Authority, Page Authority, Spam Score and referring domains are Moz's numbers and appear only with a Moz API key (MOZ_ACCESS_ID and MOZ_SECRET_KEY in the server settings). Everything else here is read live from the page. Nothing is estimated.</p>}
      </Card>

      {d.rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5">{tiles.map(([l, v, c]) => <div key={l} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-12 text-slate-500">{l}</div><div className={`text-22 font-semibold tabular-nums ${c}`}>{v || 0}</div></div>)}</div>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
              <span className="text-14 font-semibold text-slate-900">{rows.length} of {d.rows.length} pages</span>
              <Select className="h-9 w-44 rounded-lg border border-slate-300 bg-white px-3 text-13" aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="all">Every status</option><option value="working">Working</option><option value="link_missing">Link missing</option><option value="lost">Lost since last check</option><option value="unconfirmed">Cannot confirm</option><option value="page_error">Page error</option></Select>
              <Select className="h-9 w-40 rounded-lg border border-slate-300 bg-white px-3 text-13" aria-label="Follow" value={follow} onChange={e => setFollow(e.target.value)}>
                <option value="all">Follow and nofollow</option><option value="dofollow">Follow only</option><option value="nofollow">Nofollow only</option></Select>
              <span className="flex-1" /><Button size="sm" icon={Download} onClick={csv}>Download CSV</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-13.5 min-w-[1100px]">
                <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200">
                  {['Linking page', 'Status', 'Link type', 'Anchor text', 'Kind of site', 'Indexable', 'DA', 'PA', 'Spam', 'Ref. domains', 'Checked', ''].map((h, i) => <th key={i} className={`px-3 py-2.5 font-medium whitespace-nowrap ${i >= 6 && i <= 9 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody>{rows.map(r => (
                  <React.Fragment key={r.id}>
                    <tr className="border-b border-slate-100 align-top hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                      <td className="px-3 py-3 max-w-[300px]"><div className="font-medium text-slate-900 truncate">{host(r.source_url)}</div><div className="text-12 text-slate-500 truncate" title={r.source_url}>{r.title || r.source_url}</div></td>
                      <td className="px-3 py-3"><State r={r} /></td>
                      <td className="px-3 py-3">{r.follow ? <Chip cls={(FOLLOW[r.follow] || FOLLOW.nofollow)[1]}>{(FOLLOW[r.follow] || FOLLOW.nofollow)[0]}</Chip> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3 max-w-[200px] truncate" title={r.link?.anchor || ''}>{r.link ? (r.link.anchor || <span className="text-slate-400">({r.link.type} link)</span>) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-700">{r.category?.label || '—'}</td>
                      <td className="px-3 py-3">{r.page_noindex == null ? <span className="text-slate-300">—</span> : r.page_noindex ? <Chip cls="bg-red-50 text-red-700">Noindex</Chip> : <span className="text-slate-600">Yes</span>}</td>
                      <td className="px-3 py-3 text-right"><Moz v={r.moz?.da} on={d.moz} /></td><td className="px-3 py-3 text-right"><Moz v={r.moz?.pa} on={d.moz} /></td>
                      <td className="px-3 py-3 text-right"><Moz v={r.moz?.spam != null ? `${r.moz.spam}%` : null} on={d.moz} /></td><td className="px-3 py-3 text-right"><Moz v={r.moz?.ref_domains} on={d.moz} /></td>
                      <td className="px-3 py-3 text-12 text-slate-500 whitespace-nowrap">{when(r.checked_at)}<div>{r.checks}× checked</div></td>
                      <td className="px-3 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}><a href={r.source_url} target="_blank" rel="noreferrer noopener" className="text-slate-500 hover:text-indigo-600 inline-block mr-2" aria-label="Open the page"><ExternalLink size={14} /></a>
                        <button type="button" onClick={() => remove(r.id)} className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove from the list"><Trash2 size={14} /></button></td>
                    </tr>
                    {openId === r.id && (
                      <tr className="bg-slate-50/70"><td colSpan={12} className="px-5 py-4 text-13">
                        <div className="grid md:grid-cols-2 gap-x-10 gap-y-3">
                          <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Result</div>{r.state === 'working' ? `The link was found${r.links.length > 1 ? ` (${r.links.length} links to your site)` : ''}. ${r.follow === 'dofollow' ? 'It passes link value (no nofollow).' : 'It does not pass link value (nofollow, sponsored or user-generated).'}` : r.error || (r.state === 'link_missing' ? 'The page opens, but it has no link to your site.' : '')}{r.lost && ' It worked at the previous check.'}</div>
                          <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Why the kind of site</div>{r.category?.why || '—'} (decided by fixed rules on the address and page, not by a score)</div>
                          {r.links?.length > 0 && <div className="md:col-span-2"><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Links to your site on this page</div>
                            <ul className="space-y-1">{r.links.map((l, i) => <li key={i} className="break-all"><span className="text-slate-700">{l.anchor || `(${l.type} link)`}</span> → <span className="text-slate-500">{l.href}</span> <span className="text-12 text-slate-400">· {l.placement}{l.rel?.length ? ` · rel ${l.rel.join(' ')}` : ' · no rel'}</span></li>)}</ul></div>}
                          {r.page_noindex && <p className="md:col-span-2 text-red-700">This page is marked noindex: Google will not index it, so the link is worth little.</p>}
                          {r.page_nofollow && <p className="md:col-span-2 text-amber-800">The page tells search engines not to follow any link on it.</p>}
                          {r.canonical_elsewhere && <p className="md:col-span-2 text-amber-800">The page names another address as its main version: {r.canonical_elsewhere}</p>}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {d.rows.length === 0 && <Card className="p-8 text-center text-13 text-slate-500">No page has been checked yet. Paste the pages that should link to you above and press Check links.</Card>}
    </div>
  );
}

export default function BacklinkCheckerPage() {
  return (
    <SeoShell step="links" title="Backlink Checker" subtitle="Which of your backlinks really work: live status, follow or nofollow, anchor text and kind of site. Authority scores appear with a Moz key.">
      {(b) => <BacklinkChecker key={b.id} b={b} />}
    </SeoShell>
  );
}
