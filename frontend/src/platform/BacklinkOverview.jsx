import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Info, Loader2, Maximize2, Minus, Plus, Search } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, RadarChart, PolarGrid, PolarAngleAxis, Radar, PieChart, Pie, Cell } from 'recharts';
import { Card, Badge, ErrorNote, SkList } from './SeoUi';
import { useApi, fmt } from './seoApi';
import { downloadCsv, usePager, Pager } from './DataTable';

const kfmt = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : Number(n).toLocaleString('en-US'));
const MONTH = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' }); };
const AXIS = { fontSize: 11, fill: '#64748b' };
const INDIGO = '#6366f1';
const TLD_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#0ea5e9', '#94a3b8'];

function Kpi({ label, value, change, sub, tone = 'text-indigo-700', hint }) {
  return (
    <div className="px-4 py-3 min-w-0" title={hint}>
      <div className="text-12.5 text-slate-600">{label}</div>
      <div className="flex items-baseline gap-1.5"><span className={`text-24 font-bold tabular-nums leading-tight ${tone}`}>{value}</span>{change != null && <span className="text-11.5 font-semibold text-emerald-600 tabular-nums">+{change}%</span>}</div>
      {sub && <div className="text-11.5 text-slate-500 truncate">{sub}</div>}
    </div>
  );
}

function Toggle({ value, onChange, options }) {
  return <div className="inline-flex gap-3 text-12.5" role="tablist">{options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`pb-0.5 cursor-pointer border-b-2 ${value === k ? 'border-indigo-500 text-slate-900 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}</div>;
}

function Empty({ children }) { return <p className="py-8 text-center text-13 text-slate-500">{children}</p>; }

/** The crawler's linking sites around the website: each dot is a referring domain, bigger the more links it gives, red when it looks risky. */
const CAT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#a855f7', '#0ea5e9', '#ec4899', '#14b8a6', '#94a3b8'];
/** The crawler's linking sites around the website: each dot is a referring domain, bigger the more links it gives. Colour by kind of site, by risk or by authority; zoom; click a dot for its detail. */
function Network({ nodes, domain, tall, colorBy = 'risk', zoom = 1, onPick, picked, cats = [] }) {
  const R = 118, cx = 150, cy = 140;
  const max = Math.max(1, ...nodes.map(n => n.links));
  const pts = nodes.map((n, i) => { const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2; const r = R * (0.55 + 0.45 * ((i * 7) % 10) / 10); return { ...n, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), s: 3 + (n.links / max) * 9 }; });
  const fill = (p) => (colorBy === 'category' ? CAT_COLORS[Math.max(0, cats.indexOf(p.category)) % CAT_COLORS.length] : colorBy === 'authority' ? (p.da == null ? '#cbd5e1' : p.da >= 50 ? '#059669' : p.da >= 25 ? '#d97706' : '#ef4444') : p.verdict === 'risky' ? '#ef4444' : p.verdict === 'useful' ? '#10b981' : '#818cf8');
  return (
    <svg viewBox="0 0 300 280" className={`w-full ${tall ? 'h-[520px]' : 'h-64'}`} role="img" aria-label="Sites that link to the website">
      <g style={{ transform: `scale(${zoom})`, transformOrigin: '150px 140px', transition: 'transform .2s' }}>
        {pts.map(p => <line key={`l${p.domain}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={picked === p.domain ? '#4f46e5' : '#cbd5e1'} strokeWidth={picked === p.domain ? 1.4 : 0.8} />)}
        {pts.map(p => <circle key={p.domain} cx={p.x} cy={p.y} r={p.s} fill={fill(p)} fillOpacity={picked && picked !== p.domain ? 0.45 : 0.9} stroke={picked === p.domain ? '#312e81' : 'none'} strokeWidth="1.5" style={{ cursor: onPick ? 'pointer' : 'default' }} onClick={() => onPick && onPick(p.domain === picked ? null : p.domain)}><title>{`${p.domain}: ${p.links} link${p.links === 1 ? '' : 's'}${p.verdict ? `, ${p.verdict}` : ''}`}</title></circle>)}
        <circle cx={cx} cy={cy} r="16" fill="#4f46e5" /><text x={cx} y={cy + 30} textAnchor="middle" style={{ fontSize: 10, fontWeight: 600, fill: '#3730a3' }}>{domain}</text>
      </g>
    </svg>
  );
}

function Cloud({ items }) {
  if (!items.length) return <Empty>No anchor text found.</Empty>;
  const max = Math.max(...items.map(i => i.count)), min = Math.min(...items.map(i => i.count));
  const palette = ['#4f46e5', '#7c3aed', '#0ea5e9', '#0f766e', '#b45309', '#64748b'];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-2 py-3 leading-tight">
      {items.slice(0, 30).map((i, n) => <span key={i.text} title={`${i.count} link${i.count === 1 ? '' : 's'}`} className="font-semibold cursor-default" style={{ fontSize: `${11 + (max === min ? 6 : ((i.count - min) / (max - min)) * 20)}px`, color: palette[n % palette.length], opacity: 0.55 + 0.45 * (max === min ? 1 : (i.count - min) / (max - min)) }}>{i.text.length > 34 ? `${i.text.slice(0, 32)}…` : i.text}</span>)}
    </div>
  );
}

function Bars({ rows, labelKey, valueKey, shareKey, tone = INDIGO }) {
  const max = Math.max(1, ...rows.map(r => r[valueKey]));
  return (
    <ul className="space-y-3">{rows.map(r => (
      <li key={r[labelKey]}><div className="flex items-baseline justify-between text-13"><span className="text-slate-800">{r[labelKey]}</span><span className="tabular-nums"><span className="text-slate-500 mr-3">{shareKey ? (r[shareKey] < 1 ? '<1%' : `${r[shareKey]}%`) : ''}</span><span className="text-indigo-700 font-medium">{fmt(r[valueKey])}</span></span></div>
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(r[valueKey] ? 2 : 0, (r[valueKey] / max) * 100)}%`, backgroundColor: tone }} /></div></li>))}</ul>
  );
}

export default function BacklinkOverview({ b }) {
  const r = useApi(`/businesses/${b.id}/backlink-hub/overview`);
  const [range, setRange] = useState('all');
  const [show, setShow] = useState({ new: true, lost: true });
  const d = r.data;
  const series = useMemo(() => { const s = d?.series || []; return (range === '1y' ? s.slice(-12) : s).map(x => ({ ...x, label: MONTH(x.month) })); }, [d, range]);
  const recent = useMemo(() => (d?.series || []).slice(-6).map(x => ({ ...x, label: MONTH(x.month) })), [d]);
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={6} />;
  if (d.state === 'no_target') return <Card><p className="py-8 text-center text-13 text-slate-500">Add the project's website first, so there is a site to read the links of.</p></Card>;
  const t = d.totals, a = d.authority, f = d.follow, p = d.profile;
  const radar = [{ axis: 'Link power', v: a.radar.link_power }, { axis: 'Organic traffic', v: a.radar.organic_traffic }, { axis: 'Natural profile', v: a.radar.natural_profile }];
  const tox = t.toxicity;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-13 text-slate-600"><span className="font-semibold text-slate-900">Backlinks: {d.domain}</span><a href={`https://${d.domain}`} target="_blank" rel="noreferrer" aria-label="Open the website" className="text-slate-400 hover:text-indigo-600"><ExternalLink size={14} /></a>
        <span>· {fmt(t.backlinks)} backlinks from {fmt(t.referring_domains)} sites found by our crawler</span></div>

      <Card pad={false}>
        <div className="grid grid-cols-2 lg:grid-cols-6 divide-x divide-slate-100">
          <Kpi label="Referring domains" value={kfmt(t.referring_domains)} change={t.domains_change} sub={`${t.new_domains_30d} new in 30 days`} hint="Sites with at least one live link to your website, among the links our crawler has found" />
          <Kpi label="Backlinks" value={kfmt(t.backlinks)} change={t.links_change} sub={`${t.lost_backlinks} lost`} hint="Live links to your website that our crawler has found" />
          <Kpi label="Monthly visits" value="n/a" tone="text-slate-400" sub="needs a traffic database" />
          <Kpi label="Organic traffic" value={t.organic_clicks_28d != null ? fmt(t.organic_clicks_28d) : 'n/a'} tone={t.organic_clicks_28d != null ? 'text-indigo-700' : 'text-slate-400'} sub={t.organic_clicks_28d != null ? 'clicks from Google, 28 days' : 'connect Search Console'} hint="Clicks from Google Search to the website in the last 28 days (Search Console)" />
          <Kpi label="Outbound domains" value="n/a" tone="text-slate-400" sub="not read by the crawler" />
          <div className="px-4 py-3"><div className="text-12.5 text-slate-600">Toxicity score</div>
            <div className={`text-24 font-bold tabular-nums leading-tight ${tox == null ? 'text-slate-400' : tox >= 60 ? 'text-rose-600' : tox >= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>{tox ?? 'n/a'}</div>
            <div className="text-11.5 text-slate-500">{tox == null ? 'no site judged yet' : `${t.toxic_domains} risky of ${t.judged_domains} judged`} · <Link to="/backlinks/audit" className="font-semibold text-indigo-700 hover:underline">Backlink audit</Link></div></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="Authority Score" subtitle="How reputable the site is, 0 to 100">
          <div className="flex items-start gap-3"><div className="text-34 font-bold tabular-nums text-slate-900 leading-none">{a.score ?? '—'}</div>{a.verdict && <Badge tone={a.verdict === 'Balanced' ? 'green' : 'blue'}>{a.verdict}</Badge>}</div>
          <div className="h-48 mt-1"><ResponsiveContainer width="100%" height="100%"><RadarChart data={radar} outerRadius="70%"><PolarGrid stroke="#e2e8f0" /><PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#64748b' }} /><Radar dataKey="v" stroke={INDIGO} fill={INDIGO} fillOpacity={0.3} /><Tooltip formatter={(v) => [v, 'out of 100']} /></RadarChart></ResponsiveContainer></div>
          <p className="text-11.5 text-slate-500">Our own score from Moz: Domain Authority {a.da ?? '—'}, {fmt(a.rd ?? t.referring_domains)} referring domains, {a.ranking_keywords != null ? `${fmt(a.ranking_keywords)} ranking keywords` : 'its Search Console clicks'}, spam score {a.spam ?? '—'}.</p>
        </Card>
        <Card title="Authority Score trend" subtitle="Last 12 months">
          <Empty>The trend appears as months pass: we keep no earlier score, and a past score cannot be rebuilt. Today it is <b className="text-slate-800">{a.score ?? '—'}</b>.</Empty>
        </Card>
        <Card title="Network graph" subtitle="The sites that link to you" action={tox != null && <Badge tone={tox >= 60 ? 'red' : tox >= 30 ? 'amber' : 'green'}>{tox >= 60 ? 'Dangerous' : tox >= 30 ? 'Needs attention' : 'Good'}</Badge>}>
          {d.network.length ? <><Network nodes={d.network.slice(0, 40)} domain={d.domain} /><Link to="/backlinks/graph" className="inline-flex rounded-lg bg-slate-900 text-white px-3 py-1.5 text-12.5 font-medium hover:bg-slate-700">View full report</Link></> : <Empty>No linking sites yet.</Empty>}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[['domains', 'Referring domains'], ['backlinks', 'Backlinks']].map(([k, title]) => (
          <Card key={k} title={title} subtitle="Counted from the month our crawler first saw each link" action={<Toggle value={range} onChange={setRange} options={[['1y', '1Y'], ['all', 'All time']]} />}>
            {series.length < 2 ? <Empty>Our crawler first saw these links in {series[0] ? MONTH(series[0].month) : 'one month'}, so there is no earlier history to draw. It fills in as months pass. Now: <b className="text-slate-800">{fmt(series[0]?.[k] ?? 0)}</b>.</Empty> : (
              <div className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}><CartesianGrid stroke="#eef2f7" vertical={false} /><XAxis dataKey="label" tick={AXIS} minTickGap={28} /><YAxis tick={AXIS} width={38} allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey={k} name={title} stroke={INDIGO} fill="#c7d2fe" /></AreaChart></ResponsiveContainer></div>
            )}
          </Card>))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[['domains', 'New and lost referring domains', 'new_domains', 'lost_domains'], ['links', 'New and lost backlinks', 'new_links', 'lost_links']].map(([k, title, nk, lk]) => (
          <Card key={k} title={title} subtitle="Last 6 months" action={<span className="flex items-center gap-3 text-12.5">{[['new', 'New', '#6366f1'], ['lost', 'Lost', '#ef4444']].map(([s, l, c]) => <label key={s} className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={show[s]} onChange={() => setShow(x => ({ ...x, [s]: !x[s] }))} style={{ accentColor: c }} />{l}</label>)}</span>}>
            <div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={recent} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}><CartesianGrid stroke="#eef2f7" vertical={false} /><XAxis dataKey="label" tick={AXIS} /><YAxis tick={AXIS} width={38} allowDecimals={false} /><Tooltip />{show.new && <Bar dataKey={nk} name="New" fill="#6366f1" />}{show.lost && <Bar dataKey={lk} name="Lost" fill="#ef4444" />}</BarChart></ResponsiveContainer></div>
            <p className="mt-1 text-11.5 text-slate-500">New: first seen that month. Lost: no longer found by a later check.</p>
          </Card>))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Categories of referring domains" subtitle="What kind of site links to you">{d.categories.length ? <><Bars rows={d.categories} labelKey="label" valueKey="domains" shareKey="share" /><Link to="/backlinks/domains" className="mt-4 inline-flex rounded-lg bg-slate-900 text-white px-3 py-1.5 text-12.5 font-medium hover:bg-slate-700">View full report</Link></> : <Empty>No linking sites yet.</Empty>}</Card>
        <Card title="Top anchors" subtitle="The words your links use, bigger the more often"><Cloud items={d.anchors} /><Link to="/backlinks/anchors" className="inline-flex rounded-lg bg-slate-900 text-white px-3 py-1.5 text-12.5 font-medium hover:bg-slate-700">View full report</Link></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Referring domains by Authority" subtitle={`Domain Authority (Moz) of the sites that link to you${d.authority_unknown ? `; ${d.authority_unknown} have no figure yet` : ''}`}>
          <ul className="space-y-2">{d.by_authority.map(x => { const tot = Math.max(1, d.authority_known); return (
            <li key={x.range} className="grid grid-cols-[64px_1fr_44px_36px] items-center gap-2 text-13"><span className="text-slate-800">{x.range}</span><div className="h-2.5 rounded bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${(x.domains * 100) / tot}%`, backgroundColor: '#a5b4fc' }} /></div><span className="text-right tabular-nums text-slate-500">{x.domains ? `${Math.round((x.domains * 100) / tot)}%` : '0%'}</span><span className="text-right tabular-nums text-indigo-700">{x.domains}</span></li>); })}</ul>
        </Card>
        <Card title="Link attributes" subtitle="How the links are marked">
          {f.follow_share != null && f.follow_share > 95 && <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-13 text-amber-900"><AlertTriangle size={15} />Do-follow link share is too high: a natural profile has some nofollow links too.</div>}
          <ul className="space-y-3">{[['Follow', f.follow, '#34d399'], ['Nofollow', f.nofollow, '#a5b4fc'], ['Sponsored', f.sponsored, '#a5b4fc'], ['UGC', f.ugc, '#a5b4fc']].map(([l, v, c]) => (
            <li key={l} className="grid grid-cols-[84px_1fr_44px_48px] items-center gap-2 text-13"><span className="text-slate-800">{l}</span><div className="h-2.5 rounded bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${f.total ? (v * 100) / f.total : 0}%`, backgroundColor: c }} /></div><span className="text-right tabular-nums text-slate-500">{f.total ? (v && (v * 100) / f.total < 1 ? '<1%' : `${Math.round((v * 100) / f.total)}%`) : '0%'}</span><span className="text-right tabular-nums text-indigo-700">{fmt(v)}</span></li>))}</ul>
          <div className="mt-4 pt-3 border-t border-slate-100"><div className="text-12.5 font-semibold text-slate-700 mb-1.5">Anchor text</div>
            <div className="flex flex-wrap gap-1.5">{Object.entries(d.anchor_types).sort((x, y) => y[1] - x[1]).map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-12 text-slate-700">{({ branded: 'Brand', naked: 'Web address', money: 'Keyword', generic: 'Generic', compound: 'Brand + words', organic: 'Natural', empty: 'No text', other: 'Other' })[k] || k} <b className="tabular-nums">{fmt(v)}</b></span>)}</div></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="TLD distribution" subtitle="The ending of the linking sites' addresses">
          {d.tlds.length === 0 ? <Empty>No linking sites yet.</Empty> : (
            <div className="grid grid-cols-[170px_1fr] items-center gap-4">
              <div className="h-40"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={d.tlds} dataKey="domains" nameKey="tld" innerRadius={42} outerRadius={70} paddingAngle={1}>{d.tlds.map((x, i) => <Cell key={x.tld} fill={TLD_COLORS[i % TLD_COLORS.length]} />)}</Pie><Tooltip formatter={(v, n) => [`${v} domains`, `.${n}`]} /></PieChart></ResponsiveContainer></div>
              <table className="w-full text-13"><thead><tr className="text-left text-11.5 text-slate-500"><th className="py-1 font-medium">TLD</th><th className="py-1 font-medium text-right">Referring domains</th></tr></thead>
                <tbody>{d.tlds.map((x, i) => <tr key={x.tld} className="border-t border-slate-100"><td className="py-1.5"><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TLD_COLORS[i % TLD_COLORS.length] }} />{x.tld === 'other' ? 'other' : `.${x.tld}`}</span></td><td className="py-1.5 text-right tabular-nums"><span className="text-slate-500 mr-3">{x.share}%</span><span className="text-indigo-700">{x.domains}</span></td></tr>)}</tbody></table>
            </div>)}
        </Card>
        <Card title="Top countries" subtitle="From country endings such as .in or .uk: sites with a general ending (.com) have no country here">
          {d.countries.length === 0 ? <Empty>None of the linking sites has a country ending.</Empty> : <Bars rows={d.countries} labelKey="country" valueKey="domains" shareKey="share" />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Link profile distribution" subtitle="Where the linking sites are hosted (read from DNS)">
          <div className="space-y-3">{[['Ref. domains', p.domains], ['Ref. IPs', p.ips], ['Ref. subnets', p.subnets]].map(([l, v]) => (
            <div key={l}><div className="flex items-baseline justify-between"><span className="text-12.5 text-slate-600">{l}</span><span className="text-20 font-bold tabular-nums text-indigo-700">{fmt(v)}</span></div><div className="mt-1 h-3 rounded bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-300" style={{ width: `${p.domains ? (v * 100) / p.domains : 0}%` }} /></div></div>))}</div>
          <p className="mt-2 text-11.5 text-slate-500">{p.resolved} of {p.domains} sites answered the address lookup. Many links from one IP or subnet look like a link network.</p>
        </Card>
        <Card title="Similar profiles" subtitle="Sites our crawler knows that are linked from the same websites">
          {d.similar.length === 0 ? <Empty>No other site in the crawler shares your linking sites yet.</Empty> : (
            <table className="w-full text-13"><thead><tr className="text-left text-11.5 text-slate-500 border-b border-slate-200"><th className="py-1.5 font-medium">Site</th><th className="py-1.5 font-medium text-right">Shared sites</th><th className="py-1.5 font-medium text-right">Its referring domains</th></tr></thead>
              <tbody>{d.similar.map(x => <tr key={x.domain} className="border-b border-slate-100"><td className="py-1.5"><a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} className="text-slate-400" /></a></td><td className="py-1.5 text-right tabular-nums">{x.shared} <span className="text-slate-400">({x.share}%)</span></td><td className="py-1.5 text-right tabular-nums">{fmt(x.referring_domains)}</td></tr>)}</tbody></table>)}
        </Card>
      </div>

      <Card pad={false} title="Top pages" subtitle="The pages of your website with the most referring domains">
        {d.pages.length === 0 ? <Empty>No links to any page yet.</Empty> : (
          <>
            <table className="w-full text-13"><thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2 text-left font-medium">URL</th><th className="px-3 py-2 text-right font-medium">Referring domains</th><th className="px-5 py-2 text-right font-medium">Backlinks</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.pages.slice(0, 10).map(x => <tr key={x.url}><td className="px-5 py-2.5 max-w-[520px] truncate"><a href={x.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1" title={x.url}>{x.url}<ExternalLink size={11} className="text-slate-400" /></a></td><td className="px-3 py-2.5 text-right tabular-nums text-indigo-700">{fmt(x.domains)}</td><td className="px-5 py-2.5 text-right tabular-nums">{fmt(x.links)}</td></tr>)}</tbody></table>
            <div className="px-5 py-3"><Link to="/backlinks/pages" className="inline-flex rounded-lg bg-slate-900 text-white px-3 py-1.5 text-12.5 font-medium hover:bg-slate-700">View full report</Link></div>
          </>)}
      </Card>

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-12.5 text-slate-600"><Info size={15} className="mt-0.5 shrink-0" /><span>Every figure here counts links our own crawler has found for {d.domain}. Tools with their own web-wide index show many more links; these are the ones we have seen and can check. Monthly visits, outbound domains and the earlier history of the Authority Score are not shown because no source is connected for them.</span></div>
    </div>
  );
}

/** The one overview data set every tab of the Backlinks page reads (kept in the page's cache, so moving between tabs does not ask again). */
function useOverview(b) {
  const r = useApi(`/businesses/${b.id}/backlink-hub/overview`);
  return { r, d: r.data };
}

function Gate({ r, d, children }) {
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!d) return <SkList rows={5} />;
  if (d.state === 'no_target') return <Card><p className="py-8 text-center text-13 text-slate-500">Add the project's website first, so there is a site to read the links of.</p></Card>;
  return children;
}

function SimpleTable({ columns, rows, name, empty, size = 25, searchOf, bar }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (q.trim() && searchOf ? rows.filter(r => searchOf(r).toLowerCase().includes(q.trim().toLowerCase())) : rows), [rows, q, searchOf]);
  const pager = usePager(shown, { size, resetKey: `${name}|${q}` });
  return (
    <>
      {(searchOf || bar) && <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-slate-100">
        {searchOf && <label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" aria-label="Filter" className="h-9 w-64 pl-9 pr-3 text-13 rounded-lg ring-1 ring-inset ring-slate-300 outline-none focus:ring-2 focus:ring-indigo-400" /></label>}
        {bar}
        <span className="ml-auto text-12.5 text-slate-500 tabular-nums">{fmt(shown.length)} of {fmt(rows.length)}</span></div>}
      {!shown.length ? <Empty>{rows.length ? 'Nothing matches the filter.' : empty}</Empty> : (
        <>
          <div className="overflow-x-auto"><table className="w-full text-13">
            <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr>{columns.map(c => <th key={c.h} className={`px-4 py-2.5 font-medium ${c.right ? 'text-right' : 'text-left'}`}>{c.h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{pager.rows.map((r, i) => <tr key={i} className="hover:bg-slate-50 align-top">{columns.map(c => <td key={c.h} className={`px-4 py-2.5 ${c.right ? 'text-right tabular-nums' : ''} ${c.cls || ''}`}>{c.cell(r)}</td>)}</tr>)}</tbody></table></div>
          <div className="border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 pr-4"><Pager p={pager} label="rows" />
            <button type="button" onClick={() => downloadCsv(name, columns.map(c => c.h), shown.map(r => columns.map(c => (c.csv ? c.csv(r) : String(c.cell(r) ?? '')))))} className="text-12.5 font-semibold text-indigo-700 hover:underline cursor-pointer">Export CSV</button></div>
        </>)}
    </>
  );
}

const ago = (iso) => { if (!iso) return '—'; const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); if (d < 1) return 'today'; if (d < 31) return `${d}d ago`; return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

const A_TYPE = { branded: 'Brand', naked: 'Web address', money: 'Keyword', generic: 'Generic', compound: 'Brand + words', organic: 'Natural', empty: 'No text', other: 'Other' };

export function GraphTab({ b }) {
  const { r, d } = useOverview(b);
  const [colorBy, setColorBy] = useState('category');
  const [zoom, setZoom] = useState(1);
  const [picked, setPicked] = useState(null);
  return (
    <Gate r={r} d={d}>
      {d && d.state === 'ok' && (() => {
        const g = d.graph, cats = (g.categories || []).map(x => x.label), node = d.network.find(n => n.domain === picked);
        const tone = g.verdict === 'Good' ? ['bg-emerald-50', 'border-emerald-300', 'text-emerald-800'] : g.verdict === 'Dangerous' ? ['bg-rose-50', 'border-rose-300', 'text-rose-800'] : ['bg-amber-50', 'border-amber-300', 'text-amber-800'];
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
              <div className={`rounded-xl border ${tone[1]} bg-white overflow-hidden`}>
                <div className={`px-5 py-3 border-b ${tone[1]} ${tone[0]}`}><div className={`text-16 font-semibold ${tone[2]}`}>{g.verdict}</div><div className={`text-13 ${tone[2]}`}>{g.verdict === 'Good' ? 'The sites that link to you look natural.' : 'Look at these signs in the sites that link to you before you ask for more links.'}</div></div>
                <ul className="px-5 py-3 space-y-2">{g.reasons.map(x => <li key={x.text} className="flex items-start gap-2 text-13.5 text-slate-800"><span className={`mt-1.5 inline-block w-2 h-2 rounded-full shrink-0 ${x.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />{x.text}</li>)}</ul>
              </div>
              <Card pad={false} title="Top categories" subtitle="What kind of site links to you"><div className="px-5 py-3"><Bars rows={g.categories} labelKey="label" valueKey="domains" shareKey="share" /></div></Card>
            </div>
            <Card pad={false} title="Network graph" subtitle={`The ${d.network.length} linking sites that give you the most links. Click a dot for its detail.`}>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="relative border-b lg:border-b-0 lg:border-r border-slate-100 p-3">
                  <div className="flex items-center gap-2 mb-1"><label className="text-12.5 text-slate-500 flex items-center gap-1.5">Colour by
                    <select value={colorBy} onChange={e => setColorBy(e.target.value)} className="h-8 rounded-lg ring-1 ring-inset ring-slate-300 bg-white px-2 text-12.5 text-slate-800" aria-label="Colour by"><option value="category">Kind of site</option><option value="risk">Risk</option><option value="authority">Authority</option></select></label></div>
                  <div className="absolute right-4 top-12 z-10 flex flex-col gap-1.5">{[[Plus, 'Zoom in', () => setZoom(z => Math.min(2.2, z + 0.25))], [Minus, 'Zoom out', () => setZoom(z => Math.max(0.6, z - 0.25))], [Maximize2, 'Reset the zoom', () => setZoom(1)]].map(([I, l, fn]) => <button key={l} type="button" onClick={fn} aria-label={l} title={l} className="w-8 h-8 rounded-lg bg-white ring-1 ring-slate-300 hover:bg-slate-50 flex items-center justify-center cursor-pointer"><I size={15} /></button>)}</div>
                  <Network nodes={d.network} domain={d.domain} tall colorBy={colorBy} zoom={zoom} onPick={setPicked} picked={picked} cats={cats} />
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-12 text-slate-600">{colorBy === 'category' ? cats.map((c, i) => <span key={c} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />{c}</span>)
                    : (colorBy === 'risk' ? [['#10b981', 'Useful'], ['#818cf8', 'Not judged'], ['#ef4444', 'Risky']] : [['#059669', 'Authority 50+'], ['#d97706', '25 to 49'], ['#ef4444', 'Under 25'], ['#cbd5e1', 'No figure']]).map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />{l}</span>)}<span>Bigger dot: more links</span></div>
                </div>
                <div className="p-5 text-13">
                  {node ? (
                    <div className="space-y-2.5"><div className="text-16 font-semibold text-slate-900 break-all">{node.domain}</div>
                      <dl className="grid grid-cols-[110px_1fr] gap-y-1.5"><dt className="text-slate-500">Links to you</dt><dd className="font-medium">{fmt(node.links)}</dd><dt className="text-slate-500">Kind of site</dt><dd>{node.category}</dd><dt className="text-slate-500">Authority</dt><dd>{node.da ?? '—'}</dd><dt className="text-slate-500">Judged</dt><dd>{node.verdict ? <Badge tone={node.verdict === 'risky' ? 'red' : node.verdict === 'useful' ? 'green' : 'gray'}>{node.verdict}</Badge> : 'not yet'}</dd><dt className="text-slate-500">Risk</dt><dd>{node.risk ?? '—'}</dd></dl>
                      <div className="flex gap-3 pt-1"><a href={`https://${node.domain}`} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">Open the site<ExternalLink size={12} /></a><Link to={`/backlinks/links?q=${encodeURIComponent(node.domain)}`} className="font-semibold text-indigo-700 hover:underline">See its links</Link></div></div>
                  ) : <p className="text-slate-500">Click a dot to see the site: how many links it gives you, what kind of site it is, its authority and whether it looks risky.</p>}
                </div>
              </div>
            </Card>
          </div>
        );
      })()}
    </Gate>
  );
}

export function AnchorsTab({ b }) {
  const { r, d } = useOverview(b);
  return (
    <Gate r={r} d={d}>
      {d && d.state === 'ok' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
            <Card title="Top anchors" subtitle="The words your links use, bigger the more often"><Cloud items={d.anchors} /></Card>
            <Card title="Kinds of anchor text" subtitle="A natural profile is mostly brand, web address and plain words">
              <ul className="space-y-2.5">{Object.entries(d.anchor_types).sort((x, y) => y[1] - x[1]).map(([k, v]) => { const tot = Math.max(1, d.totals.backlinks); return <li key={k} className="grid grid-cols-[110px_1fr_44px_44px] items-center gap-2 text-13"><span>{A_TYPE[k] || k}</span><div className="h-2.5 rounded bg-slate-100 overflow-hidden"><div className="h-full bg-indigo-400" style={{ width: `${(v * 100) / tot}%` }} /></div><span className="text-right tabular-nums text-slate-500">{Math.round((v * 100) / tot)}%</span><span className="text-right tabular-nums text-indigo-700">{fmt(v)}</span></li>; })}</ul>
            </Card>
          </div>
          <Card pad={false} title="Anchors" subtitle={`${fmt(d.anchors.length)} different anchor texts`}>
            <SimpleTable name="backlink-anchors" empty="No anchor text found." rows={d.anchors} searchOf={x => x.text}
              columns={[{ h: 'Anchor text', cell: x => x.text, cls: 'max-w-[460px]' }, { h: 'Kind', cell: x => A_TYPE[x.type] || x.type, csv: x => x.type, cls: 'text-slate-500' },
                { h: 'Backlinks', right: true, cell: x => <span className="text-indigo-700">{fmt(x.count)}</span>, csv: x => x.count }, { h: 'Domains', right: true, cell: x => fmt(x.domains) },
                { h: 'First seen', cell: x => (x.first_seen ? new Date(x.first_seen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'), csv: x => x.first_seen || '' }, { h: 'Last seen', cell: x => ago(x.last_seen), csv: x => x.last_seen || '' }]} />
          </Card>
        </div>
      )}
    </Gate>
  );
}

export function PagesTab({ b }) {
  const r = useApi(`/businesses/${b.id}/backlink-hub/pages`);
  const [broken, setBroken] = useState(false);
  const d = r.data;
  const rows = useMemo(() => (d?.pages || []).filter(p => !broken || p.broken), [d, broken]);
  if (!d && !r.error) return <Card><p className="py-10 text-center text-13 text-slate-500 inline-flex items-center justify-center gap-2 w-full"><Loader2 size={16} className="animate-spin" />Reading your pages, one by one… about 20 seconds.</p></Card>;
  return (
    <Gate r={r} d={d}>
      {d && d.state === 'ok' && (
        <Card pad={false} title="Indexed pages" subtitle={`${fmt(d.pages.length)} pages of your website: the ones with links and the ones your last scan found. Read now from each page.`}>
          <SimpleTable name="backlink-pages" empty="No pages found yet. Run the Website Audit, or wait for the crawler to find links." rows={rows} searchOf={x => `${x.url} ${x.title || ''}`}
            bar={<label className="inline-flex items-center gap-2 text-13 text-slate-700 cursor-pointer"><input type="checkbox" checked={broken} onChange={e => setBroken(e.target.checked)} />Broken pages <span className={`tabular-nums ${d.broken ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>({d.broken})</span></label>}
            columns={[{ h: 'Title and URL', cell: x => <div className="max-w-[460px]">{x.title && <div className="text-slate-900 truncate" title={x.title}>{x.title}</div>}<a href={x.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1 max-w-full" title={x.url}><span className="truncate">{x.url}</span><ExternalLink size={11} className="shrink-0 text-slate-400" /></a></div>, csv: x => x.url },
              { h: 'Status', cell: x => (x.broken ? <Badge tone="red">{x.status ? `Broken (${x.status})` : 'Not reachable'}</Badge> : <Badge tone="green">Loads</Badge>), csv: x => x.status ?? '' },
              { h: 'Backlinks', right: true, cell: x => <span className={x.backlinks ? 'text-indigo-700' : 'text-slate-400'}>{fmt(x.backlinks)}</span>, csv: x => x.backlinks }, { h: 'Domains', right: true, cell: x => fmt(x.domains) },
              { h: 'External links', right: true, cell: x => fmt(x.external) }, { h: 'Internal links', right: true, cell: x => fmt(x.internal) }, { h: 'Last seen', cell: x => ago(x.last_seen), csv: x => x.last_seen || '' }]} />
          {d.broken > 0 && <p className="px-5 py-3 border-t border-slate-100 text-12.5 text-amber-800 bg-amber-50/60">{d.broken} page{d.broken === 1 ? '' : 's'} that {d.broken === 1 ? 'does' : 'do'} not load {rows.some(x => x.broken && x.backlinks) ? 'still have backlinks: the value of those links is lost. Redirect each one to a working page.' : 'were found by your last scan.'}</p>}
        </Card>
      )}
    </Gate>
  );
}

export function OutboundTab({ b }) {
  const r = useApi(`/businesses/${b.id}/backlink-hub/outbound`);
  const d = r.data;
  return (
    <Gate r={r} d={d}>
      {d && d.state === 'ok' && (
        <Card pad={false} title="Outbound domains" subtitle={`The websites your own pages link to, read now from ${d.pages} pages of your site (${fmt(d.total_links)} links to other sites)`}>
          <SimpleTable name="outbound-domains" empty="Your pages link to no other website." rows={d.domains} searchOf={x => `${x.domain} ${x.anchor || ''}`}
            columns={[{ h: 'Website', cell: x => <a href={`https://${x.domain}`} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1">{x.domain}<ExternalLink size={11} className="text-slate-400" /></a>, csv: x => x.domain },
              { h: 'Pages linking', right: true, cell: x => fmt(x.pages) }, { h: 'Links', right: true, cell: x => fmt(x.links) }, { h: 'Nofollow', right: true, cell: x => fmt(x.nofollow) }, { h: 'Example anchor', cell: x => x.anchor || '—', cls: 'text-slate-500 max-w-[260px] truncate' }]} />
        </Card>
      )}
    </Gate>
  );
}
