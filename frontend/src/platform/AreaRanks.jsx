import React, { useMemo, useState } from 'react';
import { MapPin, Plus, X, Play, ArrowUp, ArrowDown, Loader2, Trophy, Target, Search } from 'lucide-react';
import { Card, Button, Badge, ErrorNote, useAction, SkList } from './SeoUi';
import DataTable from './DataTable';
import { api, useApi, fmtDateTime } from './seoApi';
import PlacePicker from './PlacePicker';

const MAX_KW = 12;
const tone = (r) => (r == null ? 'bg-slate-100 text-slate-400' : r <= 3 ? 'bg-emerald-100 text-emerald-800' : r <= 10 ? 'bg-amber-100 text-amber-800' : 'bg-orange-100 text-orange-800');

/** The rank as a coloured chip, with how it moved since the measurement before (lower is better). */
function RankChip({ cell }) {
  if (!cell?.now) return <span className="text-slate-300" title="Not measured yet">·</span>;
  const r = cell.now.rank, p = cell.before ? cell.before.rank : undefined;
  const move = p === undefined ? null : (r == null && p == null) ? 0 : r == null ? -99 : p == null ? 99 : p - r; // positive = better
  return (
    <span className="inline-flex items-center gap-1" title={`${r == null ? 'Not in the first 20' : `Position ${r}`} · ${fmtDateTime(cell.now.at)}${cell.now.top?.length ? ` · ahead: ${cell.now.top.join(', ')}` : ''}`}>
      <span className={`inline-flex items-center justify-center min-w-[2.25rem] h-7 px-2 rounded-md text-13 font-bold tabular-nums ${tone(r)}`}>{r ?? '—'}</span>
      {move != null && move !== 0 && (move > 0 ? <ArrowUp size={13} className="text-emerald-600" strokeWidth={2.5} /> : <ArrowDown size={13} className="text-rose-600" strokeWidth={2.5} />)}
    </span>
  );
}

/** Add an area: the shared place panel (search Google Maps or click the map). The chosen place goes to the grid with its pin. */
function AddArea({ b, onAdd, busy }) {
  return (
    <div className="flex items-center gap-2">
      <PlacePicker b={b} width={280} placeholder="Add an area, e.g. Hinjewadi" canSave={false} places={[]} onChange={async (name, pin) => {
        if (!name) return;
        let p = pin;
        if (p?.lat == null) { const r = await api(`/businesses/${b.id}/keyword-workspace/area-pin?label=${encodeURIComponent(name)}&country=${encodeURIComponent(b.country || 'IN')}`).catch(() => null); p = r?.pin; }
        onAdd({ name, lat: p?.lat ?? null, lng: p?.lng ?? null });
      }} />
      {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
    </div>
  );
}

/** How the business ranks on Google Maps area by area, for the chosen keywords: measure, then see every area against every keyword, and one area in detail. */
export default function AreaRanks({ b }) {
  const data = useApi(`/businesses/${b.id}/area-ranks`);
  const [busy, error, run] = useAction();
  const [picked, setPicked] = useState(null); // keywords chosen to measure (null = the first ones of the list)
  const [more, setMore] = useState('');
  const [progress, setProgress] = useState('');
  const [openArea, setOpenArea] = useState(null);
  const d = data.data;
  const areas = d?.areas || [];
  const tracked = d?.keywords || [];
  const pool = useMemo(() => [...new Set([...(d?.keywords || []), ...(picked || [])])], [d, picked]);
  const chosen = picked || tracked.slice(0, MAX_KW);
  const cell = useMemo(() => { const m = {}; (d?.cells || []).forEach(c => { m[`${c.area_id}|${c.keyword}`] = c; }); return m; }, [d]);
  const keywordsShown = useMemo(() => [...new Set([...(d?.cells || []).map(c => c.keyword), ...tracked])], [d, tracked]);
  const stat = (a) => {
    const cs = keywordsShown.map(k => cell[`${a.id}|${k}`]).filter(Boolean);
    const ranks = cs.map(c => c.now.rank).filter(r => r != null);
    return { measured: cs.length, found: ranks.length, top3: ranks.filter(r => r <= 3).length, avg: ranks.length ? Math.round((ranks.reduce((x, y) => x + y, 0) / ranks.length) * 10) / 10 : null, at: cs.map(c => c.now.at).sort().at(-1) };
  };
  const toggle = (k) => setPicked(() => { const cur = chosen.includes(k) ? chosen.filter(x => x !== k) : [...chosen, k]; return cur.slice(0, MAX_KW); });
  const addMore = (k) => { const v = k.trim().toLowerCase(); if (v && !chosen.includes(v) && chosen.length < MAX_KW) setPicked([...chosen, v]); setMore(''); };
  const addArea = (a) => run('add', async () => { await api(`/businesses/${b.id}/area-ranks/areas`, { method: 'POST', body: a }); data.reload(true); });
  const removeArea = (a) => run(`rm${a.id}`, async () => { await api(`/businesses/${b.id}/area-ranks/areas/${a.id}`, { method: 'DELETE' }); if (openArea === a.id) setOpenArea(null); data.reload(true); });
  const measure = () => run('scan', async () => {
    let n = 0;
    for (const a of areas) {
      setProgress(`Measuring ${a.name} (${++n} of ${areas.length})…`);
      await api(`/businesses/${b.id}/area-ranks/scan`, { method: 'POST', body: { area_id: a.id, keywords: chosen }, timeout: 120000 });
    }
    setProgress(''); await data.reload(true);
  });
  const detail = areas.find(a => a.id === openArea);
  const requests = areas.length * chosen.length;

  return (
    <div className="space-y-3">
      <Card title="Measure by area" subtitle="Pick the areas and the keywords. Each keyword is searched on Google Maps as if from the centre of each area, and where you show up is recorded.">
        {!d ? <SkList rows={3} avatar={false} /> : (
          <div className="space-y-3">
            <div>
              <div className="text-12 font-semibold text-slate-600 mb-1.5">Areas ({areas.length})</div>
              <div className="flex flex-wrap items-center gap-2">
                {areas.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 h-8 rounded-full bg-indigo-50 ring-1 ring-indigo-100 text-12.5 font-semibold text-indigo-800"><MapPin size={12} />{a.name}
                    <button type="button" onClick={() => removeArea(a)} aria-label={`Remove ${a.name}`} className="w-6 h-6 rounded-full hover:bg-indigo-100 flex items-center justify-center cursor-pointer"><X size={12} /></button></span>))}
                <AddArea b={b} onAdd={addArea} busy={busy === 'add'} />
              </div>
              {areas.length === 0 && <p className="text-12.5 text-slate-500 mt-1">Add the areas you serve: suburbs or regions. The project's own areas were not found on the map.</p>}
            </div>
            <div>
              <div className="text-12 font-semibold text-slate-600 mb-1.5">Keywords ({chosen.length} of {MAX_KW} chosen)<span className="font-normal text-slate-500"> · your tracked keywords; add others below</span></div>
              <div className="flex flex-wrap gap-1.5">
                {pool.map(k => <button key={k} type="button" onClick={() => toggle(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${chosen.includes(k) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{k}</button>)}
                {pool.length === 0 && <span className="text-12.5 text-slate-500">No tracked keywords yet. Add some in My Keywords, or type one below.</span>}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input value={more} list="area-kw-more" onChange={e => setMore(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addMore(more); }} placeholder="Add another keyword from your list…" className="h-9 w-72 px-3 text-13 rounded-lg border border-slate-300 bg-white" aria-label="Add another keyword" />
                <datalist id="area-kw-more">{(d.more_keywords || []).filter(k => !chosen.includes(k)).map(k => <option key={k} value={k} />)}</datalist>
                <Button size="sm" onClick={() => addMore(more)} disabled={!more.trim()}>Add</Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="primary" icon={busy === 'scan' ? Loader2 : Play} disabled={busy === 'scan' || !areas.length || !chosen.length || !d.ready} onClick={measure}>{busy === 'scan' ? 'Measuring…' : `Measure ${areas.length} area${areas.length === 1 ? '' : 's'} × ${chosen.length} keyword${chosen.length === 1 ? '' : 's'}`}</Button>
              <span className="text-12 text-slate-500">{progress || `About ${requests} Google Maps requests. Each measurement is kept, so you can see the change next time.`}</span>
              {!d.ready && <span className="text-12 text-amber-700">Google Maps results are not set up on the server (GOOGLE_PLACES_API_KEY).</span>}
            </div>
            <ErrorNote>{error}</ErrorNote>
          </div>)}
      </Card>

      {d && areas.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {areas.map(a => { const s = stat(a); return (
            <button key={a.id} type="button" onClick={() => setOpenArea(openArea === a.id ? null : a.id)} className={`text-left rounded-xl bg-white ring-1 p-3 cursor-pointer min-w-0 ${openArea === a.id ? 'ring-2 ring-indigo-500' : 'ring-slate-200 hover:ring-indigo-300'}`}>
              <div className="text-12.5 font-semibold text-slate-900 truncate flex items-center gap-1"><MapPin size={12} className="text-indigo-500 shrink-0" />{a.name}</div>
              {s.measured ? (
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <div><div className="text-22 leading-none font-bold tabular-nums text-slate-900">{s.avg ?? '—'}</div><div className="text-11 text-slate-500">average position</div></div>
                  <div className="text-right text-11.5 text-slate-600"><div className="flex items-center gap-1 justify-end"><Trophy size={11} className="text-emerald-600" />{s.top3} in top 3</div><div className="flex items-center gap-1 justify-end"><Target size={11} className="text-indigo-500" />{s.found} of {s.measured} found</div></div>
                </div>) : <div className="mt-1.5 text-12 text-slate-400">Not measured yet</div>}
            </button>); })}
        </div>)}

      {d && areas.length > 0 && keywordsShown.length > 0 && (
        <Card pad={false} title="Every area, every keyword" subtitle="Position in Google Maps from each area's centre. Green is the top 3, amber 4 to 10, orange 11 to 20, a dash is not in the first 20. Arrows show the change since the measurement before.">
          <DataTable bare rows={keywordsShown.map(k => ({ keyword: k }))} rowKey={r => r.keyword} pageSize={15} sizes={[15, 30, 60]} exportName={`area-ranks-${b.name}`} label="keywords" searchPlaceholder="Search keywords" minWidth={Math.max(640, 200 + areas.length * 110)} columnsMenu={false} headClass="bg-slate-100 text-slate-700"
            columns={[
              { id: 'keyword', header: 'Keyword', value: r => r.keyword, className: 'px-3 py-2 font-medium text-slate-900 min-w-[200px]', cell: r => r.keyword },
              ...areas.map(a => ({ id: `a${a.id}`, header: a.name, right: true, first: 'asc', value: r => { const c = cell[`${a.id}|${r.keyword}`]; return c?.now ? (c.now.rank ?? 99) : null; }, className: 'px-3 py-2 text-right', csv: true,
                cell: r => <RankChip cell={cell[`${a.id}|${r.keyword}`]} /> })),
            ]} />
        </Card>)}

      {detail && (
        <Card pad={false} title={`${detail.name}: record by keyword`} subtitle={`Measured from the centre of this area. ${stat(detail).at ? `Last measured ${fmtDateTime(stat(detail).at)}.` : ''}`}
          action={<Button size="sm" onClick={() => setOpenArea(null)}>Close</Button>}>
          <DataTable bare rows={keywordsShown.map(k => ({ keyword: k, c: cell[`${detail.id}|${k}`] })).filter(r => r.c)} rowKey={r => r.keyword} pageSize={15} sizes={[15, 30]} exportName={`area-${detail.name}-${b.name}`} label="keywords" columnsMenu={false} headClass="bg-slate-100 text-slate-700" empty="Nothing measured here yet."
            columns={[
              { id: 'keyword', header: 'Keyword', value: r => r.keyword, className: 'px-3 py-2 font-medium text-slate-900', cell: r => r.keyword },
              { id: 'rank', header: 'Position', right: true, first: 'asc', value: r => r.c.now.rank ?? 99, className: 'px-3 py-2 text-right', cell: r => <RankChip cell={r.c} /> },
              { id: 'before', header: 'Before', right: true, value: r => (r.c.before ? (r.c.before.rank ?? 99) : null), className: 'px-3 py-2 text-right tabular-nums text-slate-500', cell: r => (r.c.before ? (r.c.before.rank ?? '—') : '—') },
              { id: 'top', header: 'Shown ahead of you', value: r => (r.c.now.top || []).join(', '), className: 'px-3 py-2 text-12.5 text-slate-700', cell: r => ((r.c.now.top || []).length ? (r.c.now.top || []).join(' · ') : <Badge tone="green">Nobody listed first</Badge>) },
              { id: 'at', header: 'Measured', first: 'desc', value: r => Date.parse(r.c.now.at) || null, className: 'px-3 py-2 whitespace-nowrap text-12 text-slate-500', cell: r => fmtDateTime(r.c.now.at) },
            ]} />
        </Card>)}
    </div>
  );
}
