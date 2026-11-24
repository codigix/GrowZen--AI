import React, { useMemo, useState } from 'react';
import { MapPin, Plus, Loader2, Globe, FileText, HelpCircle, Megaphone, ExternalLink, PenLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Drawer, Button, Badge, ErrorNote, inputCls } from './SeoUi';
import { useApi } from './seoApi';
import DataTable from './DataTable';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const MONTH = (m) => String(m || '').slice(0, 3).replace(/^./, c => c.toUpperCase()).replace(/(?<=.)./g, c => c.toLowerCase());
const kd = (v) => (v == null ? ['No figure', 'gray'] : v <= 30 ? ['Easy', 'green'] : v <= 60 ? ['Medium', 'amber'] : ['Hard', 'red']);

/** One keyword place by place: searches per month and the competition index in each location, its difficulty, the cost, and the last twelve months. */
export default function KeywordLocations({ b, keyword, onClose }) {
  const [extra, setExtra] = useState([]);
  const [typed, setTyped] = useState('');
  const [chart, setChart] = useState(null); // the place whose months are drawn
  const q = keyword ? `/businesses/${b.id}/keyword-workspace/locations?keyword=${encodeURIComponent(keyword)}${extra.length ? `&extra=${encodeURIComponent(extra.join(','))}` : ''}` : null;
  const r = useApi(q);
  const use = useApi(keyword ? `/businesses/${b.id}/keyword-workspace/usage?keyword=${encodeURIComponent(keyword)}` : null);
  const u = use.data;
  const d = r.data;
  const rows = d?.locations || [];
  const city = rows.find(x => x.kind === 'City' && x.monthly?.length) || rows.find(x => x.monthly?.length);
  const place = rows.find(x => x.name === chart && x.monthly?.length) || city;
  const months = (place?.monthly || []).map(m => ({ name: `${MONTH(m.month)} ${String(m.year).slice(2)}`, Searches: m.searches }));
  const country = rows.find(x => x.kind === 'Country');
  const top = Math.max(1, ...rows.map(x => x.volume || 0));
  const [lab, tn] = kd(d?.difficulty);
  const add = () => { const v = typed.trim(); if (v && extra.length < 3 && !extra.includes(v)) setExtra([...extra, v]); setTyped(''); };

  return (
    <Drawer open={Boolean(keyword)} onClose={onClose} width="max-w-4xl" title={keyword || ''} subtitle="Searches per month, competition index and difficulty, place by place (Google Ads Keyword Planner)">
      <div className="space-y-4">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-14 font-semibold text-slate-900">Where this keyword is used</div>
          {!u ? <p className="px-4 py-4 text-13 text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Reading your pages, blogs, FAQs and posts…</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              {[
                ['Website pages', Globe, u.pages.length, u.pages.map(p => <li key={p.url} className="truncate"><a href={p.url} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline" title={p.url}>{p.path}</a> <span className="text-slate-500">in the {p.places.join(', ')}</span></li>), <Link to="/keyword-management/mapping" className="text-indigo-600 hover:underline">Map it to a page</Link>],
                ['Blogs', FileText, u.blogs.length, u.blogs.map(x => <li key={x.id} className="truncate">{x.url ? <a href={x.url} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline">{x.title}</a> : x.title} <span className="text-slate-500">· {x.state}{x.in_title ? ', in the title' : ''}</span></li>), <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(keyword)}`} className="text-indigo-600 hover:underline inline-flex items-center gap-1"><PenLine size={11} />Write a blog on it</Link>],
                ['FAQs', HelpCircle, u.faqs.length, u.faqs.map((f, i) => <li key={i} className="truncate" title={f.q}>{f.q}</li>), <Link to="/gmb-profile/profile?sub=faq" className="text-indigo-600 hover:underline">Add it to an FAQ</Link>],
                ['Google posts', Megaphone, u.posts.length, u.posts.map(p => <li key={p.id} className="truncate" title={p.text}>{p.text} <span className="text-slate-500">· {p.state}</span></li>), <Link to="/google-posts" className="text-indigo-600 hover:underline">Post about it</Link>],
              ].map(([label, Icon, n, items, action]) => (
                <div key={label} className="p-3 min-w-0">
                  <div className="flex items-center gap-1.5 text-12 font-semibold text-slate-500"><Icon size={13} className={n ? 'text-emerald-600' : 'text-slate-400'} />{label}</div>
                  <div className={`text-24 font-bold tabular-nums ${n ? 'text-slate-900' : 'text-slate-300'}`}>{n}</div>
                  {n > 0 ? <ul className="mt-1 space-y-0.5 text-12 text-slate-700 max-h-28 overflow-auto">{items.slice(0, 6)}</ul> : <p className="mt-1 text-12 text-slate-500">Not used here yet. {action}</p>}
                </div>))}
            </div>)}
          {u && (u.profile.description || u.profile.services) && <p className="px-4 py-2 text-12 text-slate-600 border-t border-slate-100">Also in your Google profile: {[u.profile.description && 'the description', u.profile.services && 'the services'].filter(Boolean).join(' and ')}.</p>}
        </div>
        {!d ? (r.error ? <ErrorNote>{r.error.message}</ErrorNote> : <p className="py-6 text-center text-13 text-slate-500 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" />Asking Google for each location…</p>) : (
        <div className="space-y-4">
          {d.reason && <ErrorNote>{d.reason}</ErrorNote>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Difficulty</div><div className="mt-1 flex items-baseline gap-2"><span className="text-24 font-bold tabular-nums text-slate-900">{d.difficulty ?? '—'}</span><Badge tone={tn}>{lab}</Badge></div><div className="text-11.5 text-slate-500">0 to 100, higher is harder</div></div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Searches / month</div><div className="mt-1 text-24 font-bold tabular-nums text-slate-900">{n0(country?.volume)}</div><div className="text-11.5 text-slate-500">{country?.name || 'country'}</div></div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Competition index</div><div className="mt-1 text-24 font-bold tabular-nums text-slate-900">{country?.index ?? '—'}</div><div className="text-11.5 text-slate-500">{country?.competition ? country.competition.toLowerCase() : 'advertiser competition'}</div></div>
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3"><div className="text-12 font-semibold text-slate-500">Cost per click (top of page)</div><div className="mt-1 text-24 font-bold tabular-nums text-slate-900">{country?.cpc != null ? `₹${country.cpc}` : '—'}</div><div className="text-11.5 text-slate-500">what advertisers bid</div></div>
          </div>

          <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-100">
              <div className="text-14 font-semibold text-slate-900 mr-auto flex items-center gap-1.5"><MapPin size={14} className="text-indigo-500" />By location</div>
              <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add a place, e.g. Mumbai" aria-label="Add a place" className={`${inputCls} !h-8 w-52 text-12.5`} />
              <Button size="sm" icon={Plus} onClick={add} disabled={!typed.trim() || extra.length >= 3}>Add</Button>
            </div>
            <DataTable bare rows={rows} rowKey={x => x.name} pageSize={10} sizes={[10]} search={false} columnsMenu={false} exportName={`keyword-locations-${keyword}`} label="locations" headClass="bg-slate-100 text-slate-700" minWidth={640}
              rowClass={x => (place && x.name === place.name ? 'bg-indigo-50/60' : '')}
              columns={[
                { id: 'name', header: 'Location', value: x => x.name, className: 'px-3 py-2', cell: x => <button type="button" onClick={() => x.monthly?.length && setChart(x.name)} className="text-left cursor-pointer" title={x.found_as || x.note}><span className="font-semibold text-slate-900">{x.name}</span><span className="block text-11.5 text-slate-500">{x.kind}{x.found_as ? ` · ${x.found_as}` : ''}</span></button> },
                { id: 'volume', header: 'Searches / month', right: true, first: 'desc', value: x => x.volume, className: 'px-3 py-2 text-right', cell: x => (x.volume == null ? <span className="text-slate-300" title={x.note || 'Google has no figure for this place'}>—</span> : <div><div className="tabular-nums font-semibold text-slate-900">{n0(x.volume)}</div><div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${Math.max(3, (x.volume / top) * 100)}%` }} /></div></div>) },
                { id: 'index', header: 'Competition index', right: true, first: 'desc', value: x => x.index, className: 'px-3 py-2 text-right tabular-nums', cell: x => (x.index == null ? '—' : `${x.index}${x.competition ? ` · ${x.competition.toLowerCase()}` : ''}`) },
                { id: 'difficulty', header: 'Difficulty', right: true, value: x => x.index, className: 'px-3 py-2 text-right', cell: x => (x.index == null ? '—' : <Badge tone={kd(x.index)[1]}>{kd(x.index)[0]}</Badge>) },
                { id: 'cpc', header: 'Cost / click', right: true, value: x => x.cpc, className: 'px-3 py-2 text-right tabular-nums', cell: x => (x.cpc != null ? `₹${x.cpc}` : '—') },
              ]} />
            <p className="px-4 py-2 text-11.5 text-slate-500 border-t border-slate-100">Click a location to see its last 12 months. A dash means Google has no figure for that place (small areas often have none): nothing is estimated.</p>
          </div>

          {months.length > 0 && (
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
              <div className="text-14 font-semibold text-slate-900 mb-1">Searches per month in {place.name}</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                    <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                    <Bar dataKey="Searches" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>)}
        </div>)}
      </div>
    </Drawer>
  );
}
