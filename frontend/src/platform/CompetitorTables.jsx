import React, { useMemo, useState } from 'react';
import { ExternalLink, Globe, Lightbulb, MapPin, Star } from 'lucide-react';
import { Badge, Button } from './SeoUi';
import DataTable from './DataTable';

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const slug = (s) => String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dist = (m) => (m == null ? '—' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const MATCH_TONE = { direct: 'green', related: 'amber', unrelated: 'gray' };

/** A position as a chip: the number is always shown, colour only backs it up. */
export const Pos = ({ value, maps }) => {
  if (!value) return <span className="inline-flex items-center justify-center w-9 h-6 rounded-md text-12 text-slate-400 bg-slate-50 border border-slate-200" title="Not in the results">—</span>;
  const cls = value <= 3 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : value <= 10 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`inline-flex items-center justify-center min-w-9 h-6 px-1.5 rounded-md text-12 font-bold tabular-nums border ${cls}`} title={`${maps ? 'Google Maps' : 'Google'} position ${value}`}>#{value}</span>;
};

const band = (v) => (v == null ? 'none' : v <= 3 ? 'top3' : v <= 10 ? 'page1' : v <= 20 ? 'page2' : 'deeper');
const BANDS = [['top3', 'Top 3'], ['page1', 'Page 1 (4 to 10)'], ['page2', 'Page 2 (11 to 20)'], ['deeper', 'Beyond 20'], ['none', 'Not ranking']];
const DISTANCE = [['1000', 'Within 1 km'], ['2000', 'Within 2 km'], ['5000', 'Within 5 km'], ['10000', 'Within 10 km']];

// ---------------------------------------------------------------------------------------------------------------------------------- Google Maps competitors
/** The businesses Google Maps showed for your searches around the place, with how well each matches, how far it is and how it ranks. */
export function MapsTable({ r }) {
  const you = { name: `${r.business.name} (you)`, rating: r.business.rating, reviews: r.business.reviews || 0, appearances: r.summary.local_ranked, best: Math.min(...Object.values(r.you.local), Infinity), visibility: r.summary.local_visibility, mine: true };
  const rows = useMemo(() => [you, ...r.local_competitors].map(e => ({ ...e, best: Number.isFinite(e.best) ? e.best : null })), [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = r.keywords.length;
  const cols = [
    { id: 'name', header: 'Business', first: 'asc', value: e => e.name, cell: e => <div><div className={`font-medium ${e.mine ? 'text-emerald-800' : 'text-slate-900'}`}>{e.name}</div>{e.category && <div className="text-12 text-slate-500">{e.category}</div>}{e.relevance?.reason && <div className="text-11.5 text-slate-400 max-w-[300px] truncate" title={e.relevance.reason}>{e.relevance.reason}</div>}</div>, className: 'px-3 py-2.5 min-w-[220px]' },
    { id: 'match', header: 'Match', value: e => (e.mine ? null : e.relevance?.score ?? null), first: 'desc', tip: { what: 'How well the business matches yours on nine factors: product, location, keyword overlap, SERP overlap, category, search intent, top page, missing keywords and traffic.' }, cell: e => (e.mine ? <Badge tone="green">You</Badge> : e.relevance ? <span className="inline-flex items-center gap-2"><b className="tabular-nums">{e.relevance.score}</b><Badge tone={MATCH_TONE[e.relevance.label] || 'gray'}>{e.relevance.label_text}</Badge></span> : '—') },
    { id: 'dist', header: 'Distance', right: true, value: e => e.distance_m ?? null, cell: e => (e.mine ? '' : dist(e.distance_m)) },
    { id: 'vis', header: 'Maps visibility', right: true, first: 'desc', value: e => e.visibility ?? null, cell: e => <b>{e.visibility ?? 0}%</b> },
    { id: 'best', header: 'Best Maps position', value: e => e.best, cell: e => <Pos value={e.best} maps /> },
    { id: 'res', header: 'Searches it appears in', right: true, first: 'desc', value: e => e.appearances ?? 0, cell: e => `${e.appearances ?? 0}/${total}` },
    { id: 'rating', header: 'Rating', right: true, first: 'desc', value: e => e.rating ?? null, cell: e => <span className="inline-flex items-center gap-1"><Star size={12} className={e.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />{e.rating ? Number(e.rating).toFixed(1) : '—'}</span> },
    { id: 'rev', header: 'Reviews', right: true, first: 'desc', value: e => e.reviews ?? null },
    { id: 'site', header: 'Website', value: e => e.domain || e.website || '', cell: e => (e.website ? <a href={e.website} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1"><Globe size={12} />{e.domain || 'site'}</a> : <span className="text-slate-400">none</span>) },
  ];
  const filters = [
    { id: 'match', label: 'Match', options: [['direct', 'Direct competitor'], ['related', 'Related business'], ['unrelated', 'Not a competitor'], ['you', 'You']], test: (e, v) => (v === 'you' ? e.mine : !e.mine && e.relevance?.label === v) },
    { id: 'dist', label: 'Distance', options: DISTANCE, test: (e, v) => e.mine || (e.distance_m != null && e.distance_m <= Number(v)) },
    { id: 'rating', label: 'Rating', options: [['4.5', '4.5 and up'], ['4', '4 and up'], ['3', '3 and up']], test: (e, v) => (e.rating || 0) >= Number(v) },
    { id: 'pos', label: 'Maps position', options: [['top3', 'Top 3'], ['top10', 'Top 10'], ['none', 'Not in Maps']], test: (e, v) => (v === 'none' ? !e.best : v === 'top3' ? e.best && e.best <= 3 : e.best && e.best <= 10) },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={e => e.name} filters={filters} initialSort={{ key: 'match', dir: 'desc' }} exportName={`google-maps-competitors-${slug(r.business?.name)}`} searchPlaceholder="Search businesses" label="businesses" rowClass={e => (e.mine ? 'bg-emerald-50/50' : 'hover:bg-slate-50')} minWidth={900} />;
}

// ---------------------------------------------------------------------------------------------------------------------------------- rankings on your keywords
/** Your keywords: where you and the main competitors rank on Google, and who holds the first place. */
export function RankingsTable({ r, onKeyword, onIdeas }) {
  const cols3 = r.profiles.slice(0, 5);
  const rows = useMemo(() => r.serps.map(s => {
    const theirs = cols3.map(p => p.positions?.[s.keyword]).filter(Boolean);
    const best = theirs.length ? Math.min(...theirs) : null;
    return { ...s, best, ahead: best != null && (!s.you_organic || best < s.you_organic), inTop10: theirs.filter(p => p <= 10).length };
  }), [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = [
    { id: 'kw', header: 'Keyword', first: 'asc', value: s => s.keyword, cell: s => <button type="button" onClick={() => onKeyword(s)} className="font-semibold text-slate-900 hover:text-indigo-700 text-left cursor-pointer" title="Open the full Google and Maps results">{s.keyword}</button>, className: 'px-3 py-2.5 min-w-[200px]' },
    { id: 'g', header: 'You: Google', value: s => s.you_organic ?? null, cell: s => <Pos value={s.you_organic} /> },
    { id: 'm', header: 'You: Maps', value: s => s.you_local ?? null, cell: s => <Pos value={s.you_local} maps /> },
    ...cols3.map(p => ({ id: `c:${p.domain}`, header: p.domain, value: s => p.positions?.[s.keyword] ?? null, cell: s => <Pos value={p.positions?.[s.keyword]} />, thClass: 'px-3 py-3 max-w-[140px] truncate' })),
    { id: 'top', header: '#1 on Google', value: s => s.organic[0]?.domain || '', cell: s => <span className="text-slate-600 truncate max-w-[200px] inline-block">{s.organic[0]?.domain || '—'}</span> },
    { id: 'n', header: 'Competitors in top 10', right: true, first: 'desc', value: s => s.inTop10 },
    { id: 'gap', header: 'Gap to best competitor', right: true, value: s => (s.best && s.you_organic ? s.you_organic - s.best : s.best ? 100 : null), cell: s => (s.best == null ? <span className="text-slate-300">—</span> : !s.you_organic ? <span className="text-rose-600 font-semibold">you do not rank</span> : s.you_organic > s.best ? <span className="text-rose-600 font-semibold">{s.you_organic - s.best} behind</span> : <span className="text-emerald-600 font-semibold">ahead</span>) },
  ];
  const filters = [
    { id: 'you', label: 'You on Google', options: BANDS, test: (s, v) => band(s.you_organic) === v },
    { id: 'maps', label: 'You in Maps', options: [['yes', 'In the results'], ['no', 'Not in the results']], test: (s, v) => (v === 'yes' ? !!s.you_local : !s.you_local) },
    { id: 'ahead', label: 'Competitor', options: [['ahead', 'Ranks above you'], ['behind', 'You rank above']], test: (s, v) => (v === 'ahead' ? s.ahead : !s.ahead && !!s.you_organic) },
  ];
  return (
    <DataTable columns={cols} rows={rows} rowKey={s => s.keyword} filters={filters} initialSort={{ key: 'gap', dir: 'desc' }} exportName={`competitor-rankings-${slug(r.business?.name)}`} searchPlaceholder="Search keywords" label="keywords" minWidth={900}
      toolbar={<Button size="sm" icon={Lightbulb} onClick={onIdeas}>Keyword ideas ({r.ideas.competitor_keywords.length + r.ideas.questions.length + r.ideas.related.length})</Button>} />
  );
}

export { band, BANDS, DISTANCE };
