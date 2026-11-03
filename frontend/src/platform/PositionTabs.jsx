import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip } from 'recharts';
import { ExternalLink, Plus, Check, Info } from 'lucide-react';
import { Card, Badge, Button, useAction } from './SeoUi';
import { api, fmt } from './seoApi';
import { AXIS, PALETTE, Th, Chg, Empty, Filter, Segmented, usePager, path } from './PositionUi';

const host = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
const Bar = ({ v, max, color = '#6658dd' }) => <div className="h-2 w-24 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${max ? Math.min(100, (v / max) * 100) : 0}%`, background: color }} /></div>;
const Dash = <span className="text-slate-300">—</span>;
const Url = ({ u }) => u ? <a href={u} target="_blank" rel="noreferrer" title={u} className="text-indigo-700 hover:underline inline-flex items-center gap-1 max-w-[360px] truncate">{path(u)}<ExternalLink size={10} /></a> : Dash;

/** Overview: one metric over time, and every tracked keyword with where it stood and where it is now. */
export function Overview({ d }) {
  const [metric, setMetric] = useState('visibility');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const defs = {
    visibility: { label: 'Visibility', unit: '%', card: d.cards.visibility, rev: false },
    traffic: { label: 'Est. Traffic', unit: '', card: d.cards.traffic, rev: false },
    avg_position: { label: 'Avg. Position', unit: '', card: d.cards.avg_position, rev: true },
  };
  const m = defs[metric];
  const chart = d.distribution.map(x => ({ date: x.date.slice(5), v: x[metric] })).filter(x => x.v != null);
  const tags = [...new Set(d.all_keywords.map(r => r.tag).filter(Boolean))];
  const rows = useMemo(() => d.all_keywords.filter(r => (!q || r.keyword.toLowerCase().includes(q.toLowerCase())) && (!tag || r.tag === tag)), [d, q, tag]);
  const [slice, footer] = usePager(rows, 25);
  const sel = 'h-9 px-2.5 text-13 rounded border border-slate-200 bg-white text-slate-700 cursor-pointer';
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Segmented value={metric} onChange={setMetric} options={[['visibility', 'Visibility'], ['traffic', 'Est. Traffic'], ['avg_position', 'Avg. Position']]} />
          <span className="text-12 text-slate-500">{d.domain} · {d.period.start} → {d.period.end}</span>
        </div>
        <div className="flex items-baseline gap-2 mb-2"><span className="text-26 font-bold tabular-nums text-slate-900">{m.card.value == null ? '—' : `${metric === 'traffic' ? fmt(Math.round(m.card.value)) : m.card.value}${m.unit}`}</span><Chg v={m.card.change} better={m.rev ? 'down' : 'up'} /></div>
        {chart.length > 1 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
                <defs><linearGradient id="ov-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6658dd" stopOpacity={0.25} /><stop offset="100%" stopColor="#6658dd" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} reversed={m.rev} domain={m.rev ? [1, 'dataMax + 1'] : [0, 'auto']} />
                <Tooltip />
                <Area type="monotone" dataKey="v" name={m.label} stroke="#6658dd" strokeWidth={2} fill="url(#ov-g)" dot={{ r: 3 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>One check so far. The chart draws a line once there are two or more checks.</Empty>}
      </Card>

      <Card title={`Rankings overview (${rows.length})`} subtitle="Every tracked keyword: position at the start and end of the period, and what that is worth" pad={false}
        action={<div className="flex flex-wrap gap-2"><Filter value={q} onChange={setQ} placeholder="Filter by keyword" />{tags.length > 0 && <select className={sel} value={tag} onChange={e => setTag(e.target.value)} aria-label="Tag"><option value="">All tags</option>{tags.map(t => <option key={t}>{t}</option>)}</select>}</div>}>
        <div className="overflow-auto">
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Tag</Th><Th c="text-right">Pos. {d.period.start.slice(5)}</Th><Th c="text-right">Pos. {d.period.end.slice(5)}</Th><Th c="text-right">Diff</Th><Th c="text-right">Visibility</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Volume</Th><Th>URL</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {slice.map(r => (
                <tr key={r.keyword} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-indigo-700 max-w-[260px] truncate" title={r.keyword}>{r.keyword}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.tag || Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.was ?? <span className="text-slate-400">&gt;20</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.rank ?? <span className="text-slate-400 font-normal">&gt;20</span>}</td>
                  <td className="px-4 py-2.5 text-right"><Chg v={r.change} d={0} />{r.change == null && Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.visibility}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.traffic != null ? r.traffic : Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : Dash}</td>
                  <td className="px-4 py-2.5"><Url u={r.url} /></td>
                </tr>))}
              {!slice.length && <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">No keyword matches this filter.</td></tr>}
            </tbody>
          </table>
        </div>
        {footer}
      </Card>
    </div>
  );
}

/** Rankings distribution: visibility, and how many keywords each domain has in the top 3 / 10 / 20, with what changed. */
export function Distribution({ d }) {
  const [scope, setScope] = useState('all');
  const list = (d.competitors_all || []).filter(c => scope === 'all' || c.you).slice(0, scope === 'all' ? 10 : 1);
  const link = (c) => <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} />{c.you && <span className="ml-1 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}</a>;
  const maxVis = Math.max(1, ...list.map(c => c.visibility || 0));
  const num = (v, better = 'up') => v == null ? Dash : <Chg v={v} better={better} d={0} />;
  return (
    <div className="space-y-4">
      <div className="flex"><Segmented value={scope} onChange={setScope} options={[['all', 'All competitors'], ['me', 'My domain only']]} /></div>
      <Card title="Rankings overview" pad={false}>
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Domain</Th><Th c="text-right">Visibility</Th><Th> </Th><Th c="text-right">Diff</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Diff</Th><Th c="text-right">Top 3</Th><Th c="text-right">Top 10</Th><Th c="text-right">Top 20</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{list.map(c => (
            <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : ''}>
              <td className="px-4 py-2.5">{link(c)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.visibility}%</td><td className="px-2"><Bar v={c.visibility || 0} max={maxVis} /></td>
              <td className="px-4 py-2.5 text-right">{num(c.change)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? c.traffic : Dash}</td>
              <td className="px-4 py-2.5 text-right">{d.has_volume ? num(c.traffic_change) : Dash}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.top3.count}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.top10.count}</td><td className="px-4 py-2.5 text-right tabular-nums">{c.top20.count}</td>
            </tr>))}</tbody>
        </table>
      </Card>
      {[[3, 'top3'], [10, 'top10'], [20, 'top20']].map(([n, key]) => {
        const rows = [...list].sort((a, b) => b[key].count - a[key].count);
        const max = Math.max(1, ...rows.map(c => c[key].count));
        return (
          <Card key={key} title={`Rankings in TOP ${n}`} subtitle={`Keywords where the domain is in Google's first ${n} results`} pad={false}>
            <table className="w-full text-13">
              <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Domain</Th><Th c="text-right"># keywords in top {n}</Th><Th> </Th><Th c="text-right">Diff</Th><Th c="text-right">New</Th><Th c="text-right">Improved</Th><Th c="text-right">Lost</Th><Th c="text-right">Declined</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.map(c => (
                <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : ''}>
                  <td className="px-4 py-2.5">{link(c)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{c[key].count}</td><td className="px-2"><Bar v={c[key].count} max={max} color="#f59e0b" /></td>
                  <td className="px-4 py-2.5 text-right">{num(c[key].diff)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c[key].new ?? Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.improved ?? Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c[key].lost ?? Dash}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.declined ?? Dash}</td>
                </tr>))}</tbody>
            </table>
          </Card>
        );
      })}
      {!d.comparable && <p className="text-11.5 text-slate-400">New, Improved, Lost and Declined appear after a second position check.</p>}
    </div>
  );
}

/** Pages: every page of the site that ranks, with new and lost pages against the start of the period. */
export function PagesTab({ d }) {
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const all = d.pages.all || [];
  const news = all.filter(p => p.new);
  const lost = d.pages.lost || [];
  const base = view === 'new' ? news : view === 'lost' ? lost : all;
  const rows = base.filter(p => !q || p.url.toLowerCase().includes(q.toLowerCase()));
  const [slice, footer] = usePager(rows, 25);
  return (
    <Card title={`Pages (${rows.length})`} subtitle="Pages of your site that Google shows for the tracked keywords" pad={false}
      action={<div className="flex flex-wrap gap-2 items-center"><Filter value={q} onChange={setQ} placeholder="Filter by URL" /><Segmented value={view} onChange={setView} options={[['all', 'All URLs', all.length], ['new', 'New', news.length], ['lost', 'Lost', lost.length]]} /></div>}>
      {slice.length ? (
        <table className="w-full text-13">
          <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>URL</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. position</Th><Th c="text-right">Est. traffic</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">{slice.map(p => (
            <tr key={p.url} className="hover:bg-slate-50">
              <td className="px-4 py-2.5"><Url u={p.url} />{p.new && <Badge tone="green" className="ml-2">New</Badge>}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{p.keywords}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{p.avg_position} <Chg v={p.avg_position_change} better="down" /></td>
              <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? <>{p.traffic} <Chg v={p.traffic_change} /></> : Dash}</td>
            </tr>))}</tbody>
        </table>
      ) : <Empty>{view === 'lost' ? 'No page dropped out of the results in this period.' : view === 'new' ? 'No new page started ranking in this period.' : 'No page of this site ranked in the top 20 for a tracked keyword.'}</Empty>}
      {footer}
    </Card>
  );
}

/** Cannibalization: keywords where more than one page of the site competes in Google. */
export function Cannibalization({ d }) {
  const c = d.cannibal;
  const [slice, footer] = usePager(c.rows || [], 10);
  const col = c.health >= 80 ? '#10b981' : c.health >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="space-y-4">
      <Card title="Cannibalization health" subtitle="Keywords where more than one page of your site shows in the results">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <div><div className="text-12 text-slate-500">Affected keywords</div><div className="text-22 font-bold tabular-nums">{c.affected} <span className="text-14 text-slate-400 font-normal">/ {c.keywords}</span></div></div>
          <div><div className="text-12 text-slate-500">Cannibal pages</div><div className="text-22 font-bold tabular-nums">{c.pages}</div></div>
          <div><div className="text-12 text-slate-500">Health</div><div className="text-22 font-bold tabular-nums" style={{ color: col }}>{c.health}%</div></div>
          <div><div className="text-12 text-slate-500">Change</div><div className="pt-1.5"><Chg v={c.health_change} d={0} unit=" pts" />{c.health_change == null && Dash}</div></div>
        </div>
      </Card>
      <Card title="Affected keywords" subtitle="Pick one page to own each keyword, then merge or redirect the others" pad={false}>
        {slice.length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th c="text-right">Best pos.</Th><Th c="text-right">Volume</Th><Th>Competing pages</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slice.map(r => (
              <tr key={r.keyword} className="align-top">
                <td className="px-4 py-2.5 font-medium text-indigo-700">{r.keyword}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.rank ?? Dash}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.volume != null ? fmt(r.volume) : Dash}</td>
                <td className="px-4 py-2.5"><ul className="space-y-1">{r.urls.map(u => <li key={u}><Url u={u} /></li>)}</ul></td>
              </tr>))}</tbody>
          </table>
        ) : <Empty>No keyword has two of your pages competing in Google. Nothing to merge.</Empty>}
        {footer}
      </Card>
    </div>
  );
}

/** Competitors discovery: the domains in the results of your keywords, with a depth, a map and one-click tracking. */
export function Competitors({ d, b, onChanged }) {
  const [depth, setDepth] = useState('top20');
  const [q, setQ] = useState('');
  const [busy, error, run] = useAction();
  const tracked = new Set((d.tracked_competitors || []).map(host));
  const all = d.competitors_all || [];
  const rows = all.filter(c => (!q || c.domain.includes(q.toLowerCase())) && c[depth].count > 0).sort((a, z) => z[depth].count - a[depth].count || (z.visibility || 0) - (a.visibility || 0));
  const [slice, footer, off] = usePager(rows, 10);
  const maxVis = Math.max(1, ...rows.map(c => c.visibility || 0));
  const add = (domain) => run(domain, async () => { await api(`/businesses/${b.id}/seo/track-competitor`, { method: 'POST', body: { domain } }); onChanged(); });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-12.5 text-slate-500 font-semibold">Depth</span>
        <Segmented value={depth} onChange={setDepth} options={[['top20', 'Top 20'], ['top10', 'Top 10'], ['top3', 'Top 3']]} />
        <Filter value={q} onChange={setQ} placeholder="Filter by domain" />
      </div>
      <Card title="Competition map" subtitle="Across: keywords the domain appears for. Up: better average position. Size: visibility.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 16, left: -4, bottom: 8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" />
              <XAxis type="number" dataKey="keywords" name="Keywords" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, 'dataMax + 2']} />
              <YAxis type="number" dataKey="avg_position" name="Avg. position" reversed tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[1, 'dataMax + 1']} />
              <ZAxis type="number" dataKey="visibility" range={[160, 1400]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-12"><b>{payload[0].payload.domain}{payload[0].payload.you ? ' (you)' : ''}</b><div>{payload[0].payload.keywords} keywords · avg position {payload[0].payload.avg_position}</div><div>Visibility {payload[0].payload.visibility}%</div></div> : null} />
              {rows.slice(0, 15).map((c, i) => <Scatter key={c.domain} name={c.domain} data={[c]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.55} />)}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title={`Competitors (${rows.length})`} subtitle={`${d.competitor_total} domains appear in the results of your tracked keywords`} pad={false}>
        <div className="overflow-auto">
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>#</Th><Th>Domain</Th><Th c="text-right">Visibility</Th><Th> </Th><Th c="text-right">Diff</Th><Th c="text-right">Est. traffic</Th><Th c="text-right">Keywords</Th><Th c="text-right">Avg. pos.</Th><Th> </Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slice.map((c, i) => (
              <tr key={c.domain} className={c.you ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{off + i + 1}</td>
                <td className="px-4 py-2.5"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{c.domain}<ExternalLink size={10} /></a>{c.you && <span className="ml-2 text-11 text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">You</span>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.visibility}%</td><td className="px-2"><Bar v={c.visibility || 0} max={maxVis} /></td>
                <td className="px-4 py-2.5 text-right"><Chg v={c.change} />{c.change == null && Dash}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d.has_volume ? c.traffic : Dash}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.keywords}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.avg_position} {c.avg_position_change != null && <span className="text-11 text-slate-400">±{Math.abs(c.avg_position_change)}</span>}</td>
                <td className="px-4 py-2.5 text-right">{c.you ? null : tracked.has(c.domain) ? <Badge tone="green"><Check size={11} /> Tracked</Badge> : <Button size="sm" icon={Plus} busy={busy === c.domain} onClick={() => add(c.domain)}>Track</Button>}</td>
              </tr>))}
              {!slice.length && <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">No domain matches. Competitors appear after the first position check.</td></tr>}
            </tbody>
          </table>
        </div>
        {footer}
        {error && <p className="px-4 pb-3 text-12 text-rose-600">{error}</p>}
      </Card>
    </div>
  );
}

/** Featured snippets: where Google shows an answer box, and which of them you hold. */
export function Snippets({ d }) {
  const [view, setView] = useState('opp');
  const all = d.snippets || [];
  const has = all.filter(s => s.yours);
  const opp = all.filter(s => !s.yours);
  const fresh = all.filter(s => !s.was);
  const rows = view === 'has' ? has : view === 'new' ? fresh : opp;
  const pct = (n) => all.length ? Math.round(n / all.length * 100) : 0;
  const [slice, footer] = usePager(rows, 25);
  return (
    <div className="space-y-4">
      <Card title={`${all.length} keyword${all.length !== 1 ? 's' : ''} with featured snippets on the results page`}>
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          {[['Already featured', has.length, '#10b981'], ['Opportunities', opp.length, '#6658dd']].map(([l, n, c]) => (
            <div key={l}><div className="flex justify-between text-13"><span className="font-semibold text-slate-700">{l}</span><span className="tabular-nums"><b style={{ color: c }}>{n}</b> <span className="text-slate-400">{pct(n)}%</span></span></div><div className="h-2 mt-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${pct(n)}%`, background: c }} /></div></div>
          ))}
        </div>
      </Card>
      <Card title="Featured snippets" subtitle="Answer boxes, featured snippets and People-also-ask seen on the latest check" pad={false}
        action={<Segmented value={view} onChange={setView} options={[['opp', 'Opportunities', opp.length], ['has', 'Already featured', has.length], ['new', 'New on SERP', fresh.length]]} />}>
        {slice.length ? (
          <table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 text-slate-500"><tr><Th>Keyword</Th><Th>Feature</Th><Th c="text-right">Volume</Th><Th c="text-right">Est. traffic potential</Th><Th c="text-right">You</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{slice.map(s => (
              <tr key={s.keyword}><td className="px-4 py-2.5 font-medium text-indigo-700">{s.keyword}</td><td className="px-4 py-2.5 text-slate-600">{s.feature}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.volume != null ? fmt(s.volume) : Dash}</td><td className="px-4 py-2.5 text-right tabular-nums">{s.potential ?? Dash}</td>
                <td className="px-4 py-2.5 text-right">{s.yours ? <Badge tone="green"><Check size={11} /> Yours</Badge> : s.rank ? <span className="tabular-nums">#{s.rank}</span> : Dash}</td></tr>))}</tbody>
          </table>
        ) : <Empty>{all.length ? 'Nothing in this view. Try another tab above the table.' : 'No snippet or answer box was seen on the latest checks.'}</Empty>}
        {footer}
        {opp.length > 0 && <p className="px-4 py-3 text-12 text-slate-500 border-t border-slate-100 flex gap-1.5"><Info size={12} className="mt-0.5 shrink-0" />To win one: add a 40-60 word direct answer under a question heading, plus FAQ schema, on the page that ranks.</p>}
      </Card>
    </div>
  );
}
