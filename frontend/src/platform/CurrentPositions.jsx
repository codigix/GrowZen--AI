import React, { useMemo, useState } from 'react';
import { RefreshCw, Search, MapPin, ExternalLink, AlertTriangle, ArrowUp, ArrowDown, Globe } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, SkTable } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';
import { Th, path } from './PositionUi';
import Select from '../components/Select';

/**
 * "Where you rank on Google right now" (GET /businesses/{id}/seo/current-positions, POST /seo/check-ranks): for every tracked keyword,
 * in the project's targeted area, the Google results page and position of the website, the place of its Business Profile in Maps
 * (the local pack is the top 3), the move since the last check and who is first. Everything comes from the saved live checks;
 * a keyword that was never checked, or a site that is not in the results, says so instead of showing a number.
 */

const SORTS = [['position', 'Best position first'], ['keyword', 'Keyword A-Z'], ['change', 'Biggest move first']];

const pageBadge = (o) => {
  if (o.page === 1) return <Badge tone="green">Page 1</Badge>;
  if (o.page === 2) return <Badge tone="amber">Page 2</Badge>;
  if (o.page) return <Badge tone="orange">Page {o.page}</Badge>;
  return <Badge tone="red" title="The website was not among the results Google returned">{`Not in top ${o.depth_checked || 100}`}</Badge>;
};

function Move({ o }) {
  const v = o.change_vs_previous;
  if (v == null) return <span className="text-slate-300" title={o.found ? 'No earlier check to compare with' : 'Not in the results'}>—</span>;
  if (!v) return <span className="text-11.5 text-slate-400">no change</span>;
  return <span className={`inline-flex items-center gap-0.5 text-12 font-semibold ${v > 0 ? 'text-emerald-600' : 'text-red-500'}`} title={`Was #${o.previous_position}, now #${o.position}`}>{v > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(v)}</span>;
}

function Chip({ label, value, tone, active, onClick }) {
  const tones = { green: 'text-emerald-700', amber: 'text-amber-700', orange: 'text-orange-700', red: 'text-red-600', violet: 'text-purple-700', gray: 'text-slate-700' };
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`px-3.5 py-2 rounded ring-1 ring-inset text-left cursor-pointer transition-colors ${active ? 'bg-indigo-50 ring-indigo-300' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
      <div className={`text-20 font-bold tabular-nums leading-none ${tones[tone] || tones.gray}`}>{value}</div>
      <div className="text-11.5 text-slate-500 mt-1 whitespace-nowrap">{label}</div>
    </button>
  );
}

export default function CurrentPositions({ b, onChecked }) {
  const data = useApi(`/businesses/${b.id}/seo/current-positions`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('position');
  const [bucket, setBucket] = useState('all');
  const d = data.data;

  const check = () => run('check', async () => {
    const r = await api(`/businesses/${b.id}/seo/check-ranks`, { method: 'POST', body: {} });
    toast(`Checked ${r.checked} keyword${r.checked !== 1 ? 's' : ''} on Google (${r.credits} Serper credit${r.credits !== 1 ? 's' : ''})`);
    data.reload(true);
    if (onChecked) onChecked();
  });

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = q.trim().toLowerCase();
    const list = d.rows.filter(r => (bucket === 'all' || r.bucket === bucket || (bucket === 'pack' && r.maps.in_pack)) && (!needle || r.keyword.includes(needle)));
    const pos = (r) => (r.organic.found ? r.organic.position : r.checked ? 1000 : 2000); // found first, then "not in top 100", then never checked
    const by = { position: (a, c) => pos(a) - pos(c), keyword: (a, c) => a.keyword.localeCompare(c.keyword), change: (a, c) => Math.abs(c.organic.change_vs_previous || 0) - Math.abs(a.organic.change_vs_previous || 0) };
    return [...list].sort(by[sort]);
  }, [d, q, sort, bucket]);

  const noKey = d && !d.serper;
  const check_btn = <Button variant="primary" icon={RefreshCw} busy={busy === 'check'} disabled={noKey || !d?.summary.keywords} onClick={check}
    title={noKey ? 'Set SERPER_API_KEY on the backend to check Google' : !d?.summary.keywords ? 'Add tracked keywords first' : `Reads Google's top ${d?.depth || 100} results and Maps now, from the targeted area`}>Check positions now</Button>;

  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  return (
    <Card title="Where you rank on Google right now" subtitle="Your website and Google Business Profile for each tracked keyword, from the area you target" action={check_btn} pad={false}>
      {toastNode}
      <div className="px-6 pt-4">
        <ErrorNote>{error}</ErrorNote>
        {data.error && <ErrorNote>{data.error.message}</ErrorNote>}
      </div>
      {!d && !data.error && <div className="px-2 pb-4"><SkTable cols={5} rows={5} headers={['Keyword', 'Google page', 'Position', 'Maps', 'Change']} /></div>}
      {d && (
        <div className="px-6 pb-5 pt-2 space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-12.5 text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-800"><MapPin size={14} className="text-indigo-500" />{d.area.location}</span>
            <span>Device: <b className="font-semibold text-slate-800 capitalize">{d.area.device}</b></span>
            <span>Language: <b className="font-semibold text-slate-800">{d.area.language_name}</b></span>
            {d.domain && <span className="inline-flex items-center gap-1"><Globe size={13} className="text-slate-400" /><b className="font-semibold text-slate-800">{d.domain}</b></span>}
            <span className="text-slate-400 sm:ml-auto">{d.last_checked_at ? `Last checked ${fmtDateTime(d.last_checked_at)}` : 'Not checked yet'}</span>
          </div>

          {noKey && (
            <div className="rounded bg-amber-50 ring-1 ring-inset ring-amber-200 px-4 py-3 text-13 text-amber-900 flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>Positions come from live Google results, which need a Serper key: set <code className="text-12">SERPER_API_KEY</code> in <code className="text-12">backend/.env</code> and restart the backend. {d.summary.checked ? 'The figures below are from the last check.' : ''}</span>
            </div>
          )}

          {!d.summary.keywords ? (
            <div className="rounded bg-slate-50 py-10 text-center text-13 text-slate-500">No keywords are tracked yet. Add keywords in Keyword Strategy Builder or set up tracking, then check positions.</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Chip label="All keywords" value={d.summary.keywords} active={bucket === 'all'} onClick={() => setBucket('all')} />
                <Chip label="On page 1" value={d.summary.page1} tone="green" active={bucket === 'page1'} onClick={() => setBucket('page1')} />
                <Chip label="On page 2" value={d.summary.page2} tone="amber" active={bucket === 'page2'} onClick={() => setBucket('page2')} />
                <Chip label="Page 3 or later" value={d.summary.page3plus} tone="orange" active={bucket === 'page3plus'} onClick={() => setBucket('page3plus')} />
                <Chip label={`Not in top ${d.depth}`} value={d.summary.not_found} tone="red" active={bucket === 'not_found'} onClick={() => setBucket('not_found')} />
                <Chip label="In Maps top 3" value={d.summary.in_pack} tone="violet" active={bucket === 'pack'} onClick={() => setBucket('pack')} />
                {d.summary.unchecked > 0 && <Chip label="Not checked yet" value={d.summary.unchecked} active={bucket === 'unchecked'} onClick={() => setBucket('unchecked')} />}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search keywords" aria-label="Search keywords"
                    className="w-full h-9 pl-8 pr-3 text-13 rounded bg-white ring-1 ring-inset ring-slate-200 focus:ring-indigo-400 outline-none text-slate-900 placeholder-slate-400" />
                </label>
                <Select className={sel} value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                {bucket !== 'all' && <button type="button" onClick={() => setBucket('all')} className="text-12 text-indigo-600 hover:underline cursor-pointer">Show all</button>}
              </div>

              <div className="overflow-auto max-h-[520px] rounded ring-1 ring-inset ring-slate-100">
                <table className="w-full text-13">
                  <thead className="sticky top-0 bg-slate-50 text-11.5 text-slate-500">
                    <tr><Th>Keyword</Th><Th>Google page</Th><Th c="text-right">Position</Th><Th>Maps / local pack</Th><Th c="text-right">Change</Th><Th>Ranking page</Th><Th>Who is #1</Th><Th>Checked</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(r => {
                      const o = r.organic;
                      return (
                        <tr key={r.keyword} className="hover:bg-slate-50 align-top">
                          <td className="px-4 py-3 font-medium text-indigo-700 max-w-[240px]"><span className="block truncate" title={r.keyword}>{r.keyword}</span></td>
                          {!r.checked ? (
                            <td className="px-4 py-3 text-slate-400" colSpan={7}>Not checked yet: press “Check positions now”.</td>
                          ) : (
                            <>
                              <td className="px-4 py-3">{pageBadge(o)}</td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {o.found ? <><span className="font-bold tabular-nums text-slate-900">#{o.position}</span><div className="text-11 text-slate-500">position {o.position_on_page} on page {o.page}</div></>
                                  : <span className="text-slate-400">not in top {o.depth_checked}</span>}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {!r.maps.checked ? <span className="text-slate-300" title="The Maps check was not made for this keyword">—</span>
                                  : r.maps.found ? <span className="inline-flex items-center gap-1.5"><span className="font-bold tabular-nums text-slate-900">#{r.maps.position}</span>{r.maps.in_pack && <Badge tone="violet" title="Inside Google's local pack: the top 3 Maps results"><MapPin size={10} />top-3 pack</Badge>}</span>
                                    : <span className="text-slate-400" title={`Google returned ${r.maps.total} Maps results and none is this profile`}>not in Maps results</span>}
                              </td>
                              <td className="px-4 py-3 text-right"><Move o={o} /></td>
                              <td className="px-4 py-3 max-w-[200px]">{o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline max-w-full" title={o.url}><span className="truncate">{path(o.url)}</span><ExternalLink size={11} className="shrink-0" /></a> : <span className="text-slate-300">—</span>}</td>
                              <td className="px-4 py-3 text-12 text-slate-600 max-w-[200px]">
                                <div className="truncate" title={r.who_is_first.domain || ''}>{r.who_is_first.domain ? <>Google: <b className="font-semibold text-slate-800">{r.who_is_first.domain}</b></> : '—'}</div>
                                {r.who_is_first.maps && <div className="truncate text-slate-500" title={r.who_is_first.maps}>Maps: {r.who_is_first.maps}</div>}
                              </td>
                              <td className="px-4 py-3 text-11.5 text-slate-500 whitespace-nowrap">{fmtDateTime(r.last_checked_at)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {!rows.length && <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">No keyword matches.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-11.5 text-slate-400">Position is the place among Google's top {d.depth} results for the targeted area; page = ten results. Maps position is the place among Google Maps results for the same search; the top 3 form the local pack. A keyword that is not found is shown as such, never estimated.</p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
