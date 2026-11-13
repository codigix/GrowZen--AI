import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, Plus, ChevronDown, ChevronRight, Trophy, MapPin, ExternalLink, ScanLine, CheckCircle2, AlertTriangle, Info, HelpCircle, Check } from 'lucide-react';
import { SeoShell, Card, Button, ErrorNote, Badge, inputCls, useAction, useToast } from './SeoUi';
import { api } from './seoApi';

const DASH = '—';
const fmt = (n) => (n == null ? DASH : Number(n).toLocaleString('en-IN'));
const age = (days) => {
  if (days == null) return DASH;
  const y = Math.floor(days / 365.25), m = Math.floor((days - y * 365.25) / 30.44);
  return y >= 1 ? `${y}y ${m}m` : `${m}m`;
};
const LEVEL = {
  critical: ['bg-red-50 ring-red-200 text-red-900', AlertTriangle, 'text-red-500'],
  warning: ['bg-amber-50 ring-amber-200 text-amber-900', AlertTriangle, 'text-amber-500'],
  info: ['bg-sky-50 ring-sky-200 text-sky-900', Info, 'text-sky-500'],
  good: ['bg-emerald-50 ring-emerald-200 text-emerald-900', CheckCircle2, 'text-emerald-500']
};

// One CSV cell that a spreadsheet cannot run as a formula.
const cell = (v) => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
const downloadCsv = (r, name) => {
  const head = ['position', 'title', 'url', 'domain', 'is_you', 'domain_age_days', 'registrar', 'word_count', 'headings_h2_h3', 'has_faq', 'schema_types', 'cms', 'analytics', 'comparable', 'note'];
  const lines = [head.join(',')].concat(r.results.map(x => [x.position, x.title, x.url, x.domain, x.is_you, x.domain_age_days, x.registrar, x.word_count, x.headings, x.has_faq, x.schema_types, x.cms, x.analytics, x.comparable, x.note].map(cell).join(',')));
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
};

const FEATURE_CHIPS = (f) => [
  f.featured_snippet && 'Featured snippet', f.people_also_ask?.length && `People also ask (${f.people_also_ask.length})`, f.local_pack?.length && `Local pack (${f.local_pack.length})`,
  f.knowledge_graph && 'Knowledge panel', f.videos > 0 && `Videos (${f.videos})`, f.images && 'Images', f.top_stories > 0 && `Top stories (${f.top_stories})`, f.shopping && 'Shopping',
  f.related_searches?.length && `Related searches (${f.related_searches.length})`
].filter(Boolean);

function Row({ r }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={`align-top ${r.is_you ? 'bg-indigo-50/70' : ''}`}>
        <td className="p-2.5"><span className={`w-7 h-7 rounded-full text-12 font-bold flex items-center justify-center ${r.is_you ? 'bg-indigo-600 text-white' : r.position <= 3 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.position}</span></td>
        <td className="p-2.5 min-w-[240px] max-w-[360px]">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-start gap-1.5 text-left cursor-pointer w-full">
            {open ? <ChevronDown size={14} className="mt-1 text-slate-400 shrink-0" /> : <ChevronRight size={14} className="mt-1 text-slate-400 shrink-0" />}
            <span className="min-w-0"><span className="block text-13 font-medium text-slate-900 line-clamp-2">{r.title}{r.is_you && <span className="ml-1.5 text-10 font-bold uppercase bg-indigo-600 text-white rounded px-1.5 py-0.5 align-middle">You</span>}</span>
              <span className="block text-11.5 text-slate-500 truncate">{r.url}</span></span>
          </button>
        </td>
        <td className="p-2.5 text-13 tabular-nums whitespace-nowrap" title={r.registrar || ''}>{age(r.domain_age_days)}</td>
        <td className="p-2.5 text-13 tabular-nums" title={r.note || ''}>{r.fetched ? <span className={r.comparable ? '' : 'text-slate-400'}>{fmt(r.word_count)}</span> : DASH}</td>
        <td className="p-2.5 text-13 tabular-nums">{r.fetched ? fmt(r.headings) : DASH}</td>
        <td className="p-2.5">{r.has_faq == null ? DASH : r.has_faq ? <Check size={15} className="text-emerald-600" aria-label="Has an FAQ" /> : <span className="text-slate-300">no</span>}</td>
        <td className="p-2.5 max-w-[170px]">{r.schema_types?.length ? <div className="flex flex-wrap gap-1">{r.schema_types.slice(0, 3).map(t => <span key={t} className="text-10.5 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{t}</span>)}{r.schema_types.length > 3 && <span className="text-10.5 text-slate-400">+{r.schema_types.length - 3}</span>}</div> : <span className="text-slate-300">{r.fetched ? 'none' : DASH}</span>}</td>
        <td className="p-2.5 text-12.5 text-slate-700">{r.cms || DASH}</td>
        <td className="p-2.5 text-12 text-slate-600 max-w-[140px]">{r.analytics?.length ? r.analytics.join(', ') : DASH}</td>
        <td className="p-2.5 text-right whitespace-nowrap">{r.url && <Link to={`/page-xray?url=${encodeURIComponent(r.url)}`} className="text-12.5 font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"><ScanLine size={13} />X-Ray</Link>}</td>
      </tr>
      {open && (
        <tr className={r.is_you ? 'bg-indigo-50/40' : 'bg-slate-50/60'}>
          <td />
          <td colSpan={9} className="px-2.5 pb-3 text-12.5 text-slate-600">
            {r.snippet ? <p className="max-w-2xl">{r.snippet}</p> : <p className="text-slate-400">No snippet.</p>}
            {r.sitelinks?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">{r.sitelinks.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{s.title}</a>)}</div>}
            {r.note && <p className="mt-1.5 text-amber-700">{r.note}</p>}
            <p className="mt-1.5 text-slate-400">{r.registrar ? `Registrar: ${r.registrar}. ` : ''}{r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">Open page <ExternalLink size={11} /></a>}</p>
          </td>
        </tr>
      )}
    </>
  );
}

function XRay({ b }) {
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [data, setData] = useState(null);
  const [busy, error, run, setError] = useAction();
  const [toast, toastNode] = useToast();
  const go = (k) => run('xray', async () => {
    const q = (k ?? keyword).trim();
    if (q.length < 2) throw new Error('Type a search of at least 2 letters.');
    setData(null);
    setData(await api(`/businesses/${b.id}/serp-xray`, { method: 'POST', body: { keyword: q, location: location.trim() || null } }));
  });
  const again = (q) => { setKeyword(q); go(q); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const track = () => run('track', async () => { await api(`/businesses/${b.id}/keywords`, { method: 'POST', body: [{ keyword: data.keyword }] }); toast(`“${data.keyword}” is now tracked. Check it in Position Tracking.`); });
  useEffect(() => { setData(null); setError(''); }, [b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = data?.features;
  const chips = f ? FEATURE_CHIPS(f) : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label htmlFor="sx-kw" className="text-12 font-medium text-slate-500 block mb-1">Search to inspect</label>
            <input id="sx-kw" className={inputCls} value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={b.primary_category ? `e.g. ${b.primary_category.toLowerCase()} in ${b.city || 'your city'}` : 'e.g. clothing rental in pune'} onKeyDown={e => e.key === 'Enter' && go()} />
          </div>
          <div className="w-60 max-w-full">
            <label htmlFor="sx-loc" className="text-12 font-medium text-slate-500 block mb-1">Location (optional)</label>
            <input id="sx-loc" className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="Defaults to the project's area" onKeyDown={e => e.key === 'Enter' && go()} />
          </div>
          <Button variant="primary" icon={Search} busy={busy === 'xray'} onClick={() => go()}>X-Ray this search</Button>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <p className="mt-2 text-11.5 text-slate-400">Live Google results through Serper, then each top page is opened and measured. Nothing is estimated. It can take up to a minute.</p>
      </Card>

      {busy === 'xray' && <Card><div role="status" aria-live="polite" className="py-10 text-center text-13 text-slate-500">Reading Google and opening the top 10 pages…</div></Card>}

      {data && (
        <>
          <div className={`rounded-xl ring-1 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 ${data.your.found ? (data.your.position <= 3 ? 'bg-emerald-50 ring-emerald-200' : 'bg-indigo-50 ring-indigo-200') : 'bg-amber-50 ring-amber-200'}`}>
            <span className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-indigo-600 shrink-0"><Trophy size={20} /></span>
            <div className="flex-1 min-w-[220px]">
              <div className="text-12 font-semibold uppercase tracking-wide text-slate-500">Your position for “{data.keyword}”</div>
              {!data.your.domain ? <div className="text-15 font-semibold text-slate-900">Add the project’s website to see where you rank</div>
                : data.your.found ? <div className="text-20 font-bold text-slate-900">#{data.your.position} <span className="text-13 font-medium text-slate-600">on Google page {data.your.page} · {data.your.domain}</span></div>
                  : <div className="text-15 font-semibold text-slate-900">{data.your.domain} is not in the top 100</div>}
              {data.your.url && <a href={data.your.url} target="_blank" rel="noreferrer" className="text-12 text-indigo-600 hover:underline break-all">{data.your.url}</a>}
              {data.your.maps_position && <div className="text-12.5 text-slate-600 inline-flex items-center gap-1 mt-0.5"><MapPin size={12} />#{data.your.maps_position} in the Google Maps pack</div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={Plus} busy={busy === 'track'} onClick={track}>Track this keyword</Button>
              <Button icon={Download} onClick={() => downloadCsv(data, `serp-xray-${data.keyword.replace(/\W+/g, '-')}.csv`)}>Download CSV</Button>
            </div>
          </div>
          <p className="text-11.5 text-slate-400 -mt-2 px-1">Checked {new Date(data.fetched_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} · {data.location}</p>

          {chips.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="SERP features on this search">{chips.map(c => <Badge key={c} tone="blue">{c}</Badge>)}</div>}

          {data.insights.length > 0 && (
            <Card title="What this means" subtitle="Worked out from the live results below">
              <ul className="space-y-2.5">{data.insights.map((i, k) => { const [cls, Icon, ic] = LEVEL[i.level] || LEVEL.info; return (
                <li key={k} className={`rounded-lg ring-1 px-4 py-3 flex gap-3 ${cls}`}><Icon size={17} className={`${ic} mt-0.5 shrink-0`} /><div><div className="text-13.5 font-semibold">{i.title}</div><div className="text-12.5 opacity-90 mt-0.5">{i.fix}</div></div></li>
              ); })}</ul>
            </Card>
          )}

          <Card title="The top 10 results" subtitle="Click a row for its snippet. Page measurements come from opening each page; domain age from public registry data (RDAP).">
            <div className="overflow-x-auto">
              <table className="w-full text-13">
                <thead className="text-12 text-slate-500 border-b border-slate-200"><tr>
                  {['#', 'Result', 'Domain age', 'Words', 'H2/H3', 'FAQ', 'Schema', 'CMS', 'Analytics', ''].map((h, i) => <th key={i} className="p-2 text-left font-medium whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">{data.results.map(r => <Row key={`${r.position}-${r.url}`} r={r} />)}</tbody>
              </table>
            </div>
            {data.results.length === 0 && <p className="text-13 text-slate-500 py-6 text-center">Google returned no results for this search.</p>}
          </Card>

          {(f.featured_snippet || f.people_also_ask.length > 0 || f.related_searches.length > 0 || f.local_pack.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              {f.featured_snippet && (
                <Card title="Featured snippet">
                  <div className="text-13.5 font-semibold text-slate-900">{f.featured_snippet.title || 'Answer box'}</div>
                  {f.featured_snippet.text && <p className="text-13 text-slate-700 mt-1">{f.featured_snippet.text}</p>}
                  {f.featured_snippet.url && <a href={f.featured_snippet.url} target="_blank" rel="noreferrer" className="text-12 text-indigo-600 hover:underline break-all inline-flex items-center gap-1 mt-1.5">{f.featured_snippet.url}<ExternalLink size={11} /></a>}
                </Card>
              )}
              {f.local_pack.length > 0 && (
                <Card title="Local map pack">
                  <ul className="divide-y divide-slate-100">{f.local_pack.map((p, i) => <li key={i} className="py-2 flex items-center gap-3 text-13"><span className="w-6 text-slate-400 tabular-nums">{i + 1}</span><span className="flex-1 font-medium text-slate-900">{p.name}</span><span className="text-slate-500">{p.rating != null ? `${p.rating}★` : DASH}{p.reviews != null ? ` · ${fmt(p.reviews)}` : ''}</span></li>)}</ul>
                </Card>
              )}
              {f.people_also_ask.length > 0 && (
                <Card title="People also ask" subtitle="Real questions Google shows for this search. Click one to X-Ray it.">
                  <ul className="divide-y divide-slate-100">{f.people_also_ask.map((q, i) => (
                    <li key={i} className="py-2.5"><button type="button" onClick={() => again(q.question)} className="text-left text-13.5 font-medium text-indigo-700 hover:underline cursor-pointer inline-flex items-start gap-1.5"><HelpCircle size={14} className="mt-0.5 shrink-0" />{q.question}</button>{q.snippet && <p className="text-12.5 text-slate-500 mt-0.5 line-clamp-2">{q.snippet}</p>}</li>
                  ))}</ul>
                </Card>
              )}
              {f.related_searches.length > 0 && (
                <Card title="Related searches" subtitle="Click one to X-Ray it.">
                  <div className="flex flex-wrap gap-2">{f.related_searches.map(q => <button key={q} type="button" onClick={() => again(q)} className="h-8 px-3 rounded-full ring-1 ring-slate-300 hover:ring-indigo-400 hover:bg-indigo-50 text-12.5 text-slate-700 cursor-pointer">{q}</button>)}</div>
                </Card>
              )}
            </div>
          )}

          {data.notes.length > 0 && <ul className="text-12 text-slate-500 list-disc pl-5 space-y-0.5">{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </>
      )}
      {toastNode}
    </div>
  );
}

export default function SerpXRayPage() {
  return (
    <SeoShell title="SERP X-Ray" subtitle="See exactly who ranks for a search and why: the live Google results, with each top page measured, and where your site stands.">
      {(b) => <XRay key={b.id} b={b} />}
    </SeoShell>
  );
}
