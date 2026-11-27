import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AlertTriangle, ArrowRight, Info, Phone, Navigation, MousePointerClick, Eye, Star, Users, Wrench, FileText, ArrowUpRight, ArrowDownRight, Minus, CheckCircle2, Clock, ListChecks, Send, Search, Globe, BookOpen, MessageSquare, Link2, ClipboardCheck } from 'lucide-react';
import { Card, Badge, ChartTooltip, Legend, SERIES, INK } from './SeoUi';
import { useApi, fmt } from './seoApi';
import { usePager, Pager, useSorted, SortTh } from './DataTable';
import Select from '../components/Select';

const C = { calls: SERIES[0], directions: SERIES[1], website_clicks: SERIES[2] };

const ago = (iso) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return 'just now';
  if (m < 90) return `${m} min ago`;
  if (m < 2880) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

function Change({ m, days }) {
  if (!m || !m.compare) return null;
  if (!m.delta) return <span className="text-11.5 text-slate-400 inline-flex items-center gap-0.5"><Minus size={12} />same as the {days} days before</span>;
  const up = m.delta > 0;
  const I = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`text-11.5 font-semibold inline-flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-red-600'}`}><I size={13} />{up ? '+' : ''}{fmt(m.delta)}{m.pct != null ? ` (${m.pct > 0 ? '+' : ''}${m.pct}%)` : ''} vs the {days} days before</span>;
}

function Kpi({ icon: Icon, label, m, days, total }) {
  return (
    <div className="ai-glass-card rounded p-4 flex items-start gap-3 min-w-0">
      <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><Icon size={17} /></span>
      <div className="min-w-0">
        <div className="text-12 font-semibold text-slate-500 truncate">{label}</div>
        <div className="text-24 leading-tight font-bold text-slate-900 tabular-nums">{fmt(m?.total || 0)}</div>
        <Change m={m} days={days} />
        {total != null && m && m.compare && <div className="text-11 text-slate-400">{fmt(total)} in total</div>}
      </div>
    </div>
  );
}

function Bars({ data, keys, height = 220, stacked }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK?.secondary || '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK?.secondary || '#64748b' }} tickLine={false} axisLine={false} width={42} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
          {keys.map(([k, name, color]) => <Bar key={k} dataKey={k} name={name} fill={color} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [3, 3, 0, 0]} maxBarSize={26} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ text }) { return <div className="h-[220px] flex items-center justify-center text-13 text-slate-400 text-center px-6">{text}</div>; }

function Stand({ icon: Icon, label, value, sub, bar, to }) {
  const inner = (
    <div className="ai-glass-card rounded p-4 h-full">
      <div className="flex items-center gap-2 text-12 font-semibold text-slate-500"><Icon size={14} className="text-indigo-500" />{label}</div>
      <div className="mt-1 text-22 font-bold text-slate-900 tabular-nums">{value}</div>
      {bar != null && <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(2, Math.min(100, bar))}%` }} /></div>}
      {sub && <div className="mt-1.5 text-11.5 text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block hover:ring-1 hover:ring-indigo-200 rounded">{inner}</Link> : inner;
}

/** Counts, progress week by week or month by month, and the actions taken on this project. */
const RANGES = [['all', 'All time'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['180d', 'Last 6 months'], ['365d', 'Last 12 months'], ['this_month', 'This month'], ['custom', 'Custom dates']];
const nice = (iso) => { try { return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; } };
const kwValue = (k, key) => (key === 'keyword' ? k.keyword : key === 'rank' ? (k.rank || null) : key === 'volume' ? (k.volume ?? null) : null);

function TopKeywords({ rows: all }) {
  const { sorted, sort, onSort } = useSorted(all, kwValue);
  const pager = usePager(sorted, { size: 10 });
  return (
    <>
      <table className="w-full text-13">
        <thead className="text-11.5 text-slate-500"><tr><SortTh id="keyword" sort={sort} onSort={onSort} className="py-1.5">Keyword</SortTh><SortTh id="rank" sort={sort} onSort={onSort} right className="py-1.5">Position</SortTh><SortTh id="volume" sort={sort} onSort={onSort} right first="desc" className="py-1.5">Searches / month</SortTh></tr></thead>
        <tbody className="divide-y divide-slate-100">{pager.rows.map(k => {
          const move = k.rank && k.prev_rank ? k.prev_rank - k.rank : 0;
          return (<tr key={k.keyword}><td className="py-2 pr-2 text-slate-900">{k.keyword}{!k.tracked && <span className="ml-2 text-11 text-slate-400">not tracked</span>}</td>
            <td className="py-2  tabular-nums">{k.rank ? <>#{k.rank}{move !== 0 && <span className={`ml-1.5 text-11.5 font-semibold ${move > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{move > 0 ? '▲' : '▼'}{Math.abs(move)}</span>}</> : <span className="text-slate-400">not read yet</span>}</td>
            <td className="py-2  tabular-nums text-slate-600">{k.volume != null ? fmt(k.volume) : '—'}</td></tr>);
        })}</tbody>
      </table>
      <Pager p={pager} label="keywords" />
    </>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

const LEVEL = {
  high: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700', word: 'Fix first' },
  medium: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800', word: 'Do next' },
  low: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700', word: 'When you can' }
};

/** What to do next on this project, most important first: each line says what is wrong, why it matters and opens the page that fixes it in a new tab. */
export function Attention({ b }) {
  const r = useApi(`/businesses/${b.id}/dashboard?range=all`);
  const all = r.data?.attention;
  const [more, setMore] = useState(false);
  if (r.error) return null;
  const items = all && !more ? all.slice(0, 4) : all;
  return (
    <section id="attention" className="scroll-mt-24" aria-label="What needs attention">
      <Card title="What needs attention" subtitle={items ? (items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} to do, the most important first` : 'Nothing urgent: keep it up') : 'Checking this project…'}>
        {!items ? <p className="text-13 text-slate-400 py-2">Checking…</p> : items.length === 0 ? (
          <p className="text-13 text-emerald-700 py-2 inline-flex items-center gap-2"><CheckCircle2 size={16} />Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((x, i) => {
              const L = LEVEL[x.level] || LEVEL.low;
              const Icon = x.level === 'low' ? Info : AlertTriangle;
              return (
                <li key={i} className="py-3 flex items-start gap-3">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${L.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-13.5 font-semibold text-slate-900 flex flex-wrap items-center gap-2">{x.title}<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-11 font-semibold ${L.chip}`}><Icon size={11} />{L.word}</span></div>
                    <div className="text-12.5 text-slate-500 mt-0.5">{x.why}</div>
                  </div>
                  <Link to={x.to} target="_blank" rel="noopener noreferrer" className="shrink-0 h-8 px-3 inline-flex items-center gap-1 rounded ring-1 ring-slate-300 text-12.5 font-semibold text-slate-700 hover:bg-slate-50">Open <ArrowRight size={13} /></Link>
                </li>
              );
            })}
          </ul>
        )}
        {all && all.length > 4 && <button type="button" onClick={() => setMore(v => !v)} className="mt-2 text-12.5 font-semibold text-indigo-600 hover:underline cursor-pointer">{more ? 'Show fewer' : `Show ${all.length - 4} more`}</button>}
      </Card>
    </section>
  );
}

/** Everything so far by default; a date range narrows it. Counts, progress over time and the actions taken on this project. */
export default function ProgressSection({ b, view = 'progress' }) {
  const [range, setRange] = useState('all');
  const [group, setGroup] = useState('auto');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today());
  const custom = range === 'custom';
  const ready = !custom || (from && to);
  const q = new URLSearchParams({ range, ...(group !== 'auto' ? { group } : {}), ...(custom && ready ? { start: from, end: to } : {}) });
  const r = useApi(ready ? `/businesses/${b.id}/dashboard?${q.toString()}` : null);
  const d = r.data;
  const days = d?.range?.days || 0;
  const sel = 'h-9 rounded border border-slate-300 bg-white px-2.5 text-13 text-slate-800 cursor-pointer';
  const toggle = (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Date range" className={sel} value={range} onChange={e => setRange(e.target.value)}>{RANGES.map(([id, t]) => <option key={id} value={id}>{t}</option>)}</Select>
      {custom && <>
        <input type="date" aria-label="From" className={sel} value={from} max={to || today()} onChange={e => setFrom(e.target.value)} />
        <span className="text-12 text-slate-500">to</span>
        <input type="date" aria-label="To" className={sel} value={to} min={from || undefined} max={today()} onChange={e => setTo(e.target.value)} />
      </>}
      <Select aria-label="Group by" className={sel} value={group} onChange={e => setGroup(e.target.value)}>
        <option value="auto">Group: automatic</option><option value="week">Group: weekly</option><option value="month">Group: monthly</option>
      </Select>
      {range !== 'all' && <button type="button" onClick={() => { setRange('all'); setGroup('auto'); }} className="h-9 px-3 rounded text-12.5 font-semibold text-indigo-600 hover:bg-indigo-50 cursor-pointer">Show everything</button>}
    </div>
  );
  const unit = d?.range?.group === 'month' ? 'month' : 'week';
  const only = view === 'overview';

  if (r.error) return <Card title="Progress" action={toggle}><p className="text-13 text-red-600">{r.error.message}</p></Card>;
  if (!ready) return <Card title="Progress" action={toggle}><p className="text-13 text-slate-500">Choose the first date to show the range.</p></Card>;
  if (!d) return <Card title="Progress" action={toggle}><div className="h-40 flex items-center justify-center text-13 text-slate-400">Loading this project's numbers…</div></Card>;

  const rows = d.labels.map((label, i) => ({ label, ...Object.fromEntries(Object.entries(d.series).map(([k, v]) => [k, v[i]])), health: d.health[i] }));
  const any = (k) => (d.series[k] || []).some(Boolean);
  const m = d.movement;
  const c = d.counts;
  const fixPct = c.fixes_total ? Math.round((c.fixes_done / c.fixes_total) * 100) : 0;
  const idxPct = c.pages_known ? Math.round((c.pages_indexed / c.pages_known) * 100) : 0;
  const nothing = !Object.values(d.series).some(v => v.some(Boolean)) && !d.health.some(x => x != null);

  return (
    <section id="progress" className="space-y-5 scroll-mt-24" aria-label={only ? 'Overview' : 'Progress'}>
      {view === 'overview' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi icon={Navigation} label="Directions" m={m.directions} days={days} />
            <Kpi icon={MousePointerClick} label="Website clicks" m={m.website_clicks} days={days} />
            <Kpi icon={Star} label="Reviews" m={m.reviews} days={days} />
            <Kpi icon={Wrench} label="Issues fixed" m={m.fixes} days={days} />
            <Kpi icon={Link2} label="Backlinks found" m={m.backlinks} days={days} />
          </div>

          <div>
            <h3 className="text-15 font-semibold text-slate-900 mb-2">Where the project stands</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              <Stand icon={ClipboardCheck} label="Growth Plan issues fixed" value={`${c.fixes_done} / ${c.fixes_total}`} bar={fixPct} sub={`${c.fixes_open} still to do · ${fixPct}% done`} to="/growth" />
              <Stand icon={Search} label="Keywords tracked" value={`${fmt(c.keywords_tracked)}${c.keywords_saved > c.keywords_tracked ? ` / ${fmt(c.keywords_saved)}` : ''}`} sub={`${fmt(c.keywords_suggested)} suggestions found${c.ranking_any ? ` · ${c.ranking_top3} top 3 · ${c.ranking_top10} top 10` : ' · positions not read yet'}`} to="/keyword-management/tracked" />
              <Stand icon={Link2} label="Backlinks found" value={c.backlinks_tracked ? fmt(c.backlinks) : '—'} sub={c.backlinks_tracked ? `${fmt(c.referring_domains)} referring domains · ${fmt(c.backlinks_verified)} verified` : 'The site is not tracked yet'} to="/backlinks/links" />
              <Stand icon={Send} label="Link opportunities" value={fmt(c.link_opportunities)} sub={c.link_opportunities ? `${c.link_opportunities_contacted} contacted · ${c.link_opportunities_live} live` : 'None planned yet'} to="/backlinks/opportunities" />
              <Stand icon={Globe} label="Pages indexed on Google" value={`${c.pages_indexed} / ${c.pages_known}`} bar={c.pages_known ? idxPct : null} sub={c.pages_known ? `${idxPct}% of the pages found` : 'Run the page scan'} to="/page-indexing" />
              <Stand icon={BookOpen} label="Articles" value={fmt(c.articles)} sub={`${c.articles_live} live on the website`} to="/ai-content-generation/articles" />
              <Stand icon={Send} label="Google posts" value={fmt(c.posts_published)} sub={c.posts_waiting ? `${c.posts_waiting} waiting or scheduled` : 'None waiting'} to="/google-posts" />
              <Stand icon={MessageSquare} label="Reviews" value={c.rating ? `${c.rating}★ · ${fmt(c.reviews)}` : fmt(c.reviews)} sub={!c.reviews ? 'No reviews yet' : c.reviews_unreplied ? `${c.reviews_unreplied} without a reply` : 'All answered'} to="/reviews" />
              <Stand icon={ListChecks} label="Waiting for your approval" value={fmt(c.approvals_waiting)} sub={c.approvals_waiting ? 'Open to approve or reject' : 'Nothing waiting'} to="/automation" />
            </div>
          </div>


          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <Card title="Actions taken" subtitle={`${m.actions.total} action${m.actions.total === 1 ? '' : 's'} logged ${d.range.key === 'all' ? 'so far' : 'in this range'}${m.actions.compare ? `, ${m.actions.before} in the ${days} days before` : ''}`}>
              {d.timeline.length === 0 ? <p className="text-13 text-slate-500 py-2">No actions logged yet.</p> : (
                <ul className="divide-y divide-slate-100">
                  {d.timeline.map((a, i) => (
                    <li key={i} className="py-2.5 flex items-start gap-3">
                      <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0"><div className="text-13 text-slate-900">{a.what}</div><div className="text-11.5 text-slate-500">{a.who} · {ago(a.at)}</div></div>
                      {a.pushed && <Badge tone="green">Sent to Google</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Recently approved and published" subtitle="What the assistant prepared and you approved">
              {d.recent_tasks.length === 0 ? <p className="text-13 text-slate-500 py-2">Nothing approved yet.</p> : (
                <ul className="divide-y divide-slate-100">
                  {d.recent_tasks.map((t, i) => (
                    <li key={i} className="py-2.5 flex items-center gap-3 text-13">
                      <Clock size={15} className="text-indigo-500 shrink-0" /><span className="flex-1 min-w-0 truncate text-slate-800">{t.title}</span>
                      <Badge tone={t.status === 'applied' ? 'green' : 'blue'}>{t.status === 'applied' ? 'Done' : t.status === 'scheduled' ? 'Scheduled' : 'Approved'}</Badge><span className="text-11.5 text-slate-400 shrink-0">{ago(t.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-18 font-semibold text-slate-900">Progress</h2><p className="text-13 text-slate-500">{d.range.key === 'all' ? `Everything so far: from ${nice(d.range.start)} (the first thing stored for this project) to today, ${days} days.` : `${nice(d.range.start)} to ${nice(d.range.end)} (${days} days), shown ${unit} by ${unit}. The change is against the ${days} days before.`}</p></div>
            {toggle}
          </div>

          {nothing && <div className="rounded bg-sky-50 ring-1 ring-inset ring-sky-100 px-4 py-3 text-13 text-sky-900">Nothing has happened in {d.range.key === 'all' ? 'this project' : 'this date range'} yet. Connect the Google profile, run a website audit and start the Growth Plan: each action shows up here as it happens.</div>}

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi icon={Phone} label="Calls" m={m.calls} days={days} />
            <Kpi icon={Navigation} label="Directions" m={m.directions} days={days} />
            <Kpi icon={MousePointerClick} label="Website clicks" m={m.website_clicks} days={days} />
            <Kpi icon={Eye} label="Profile views" m={m.views} days={days} />
            <Kpi icon={Star} label="New reviews" m={m.reviews} days={days} total={c.reviews} />
            <Kpi icon={Users} label="Leads" m={m.leads} days={days} total={c.leads} />
            <Kpi icon={Wrench} label="Issues fixed" m={m.fixes} days={days} total={c.fixes_done} />
            <Kpi icon={FileText} label="Articles written" m={m.articles} days={days} total={c.articles} />
            <Kpi icon={Search} label="Keywords added" m={m.keywords} days={days} total={c.keywords_saved} />
            <Kpi icon={Link2} label="Backlinks gained" m={m.backlinks} days={days} total={c.backlinks} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Google activity" subtitle="Calls, directions and website clicks from the Google profile" action={<Legend items={[['Calls', C.calls], ['Directions', C.directions], ['Website clicks', C.website_clicks]]} />}>
              {any('calls') || any('directions') || any('website_clicks') ? <Bars data={rows} stacked keys={[['calls', 'Calls', C.calls], ['directions', 'Directions', C.directions], ['website_clicks', 'Website clicks', C.website_clicks]]} /> : <Empty text="No Google profile activity yet. Connect the Google account and it fills in after the next sync." />}
            </Card>
            <Card title="Work done" subtitle="Issues fixed, articles written and Google posts published" action={<Legend items={[['Issues fixed', SERIES[0]], ['Articles', SERIES[1]], ['Posts', SERIES[2]]]} />}>
              {any('fixes') || any('articles') || any('posts') ? <Bars data={rows} keys={[['fixes', 'Issues fixed', SERIES[0]], ['articles', 'Articles', SERIES[1]], ['posts', 'Posts', SERIES[2]]]} /> : <Empty text="No fixes, articles or posts in this period yet." />}
            </Card>
            <Card title="Site health" subtitle="The average audit score in each period">
              {d.health.some(x => x != null) ? (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rows} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={42} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="health" name="Site health" stroke={SERIES[0]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty text="No website audit has finished in this period." />}
            </Card>
            <Card title="Keywords and backlinks" subtitle="Keywords added and new backlinks found" action={<Legend items={[['Keywords', SERIES[0]], ['Backlinks', SERIES[2]]]} />}>
              {any('keywords') || any('backlinks') ? <Bars data={rows} keys={[['keywords', 'Keywords', SERIES[0]], ['backlinks', 'Backlinks', SERIES[2]]]} /> : <Empty text="No keywords added or backlinks found in this period." />}
            </Card>
            <Card title="Reviews and leads" subtitle="New Google reviews and enquiries" action={<Legend items={[['Reviews', SERIES[1]], ['Leads', SERIES[3] || SERIES[2]]]} />}>
              {any('reviews') || any('leads') ? <Bars data={rows} keys={[['reviews', 'Reviews', SERIES[1]], ['leads', 'Leads', SERIES[3] || SERIES[2]]]} /> : <Empty text="No new reviews or leads in this period." />}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <Card title="Keywords" subtitle={`${fmt(c.keywords_saved)} saved · ${fmt(c.keywords_tracked)} tracked · ${fmt(c.keywords_suggested)} suggestions`} action={<Link to="/keyword-management/tracked" className="text-12.5 font-semibold text-indigo-600 hover:underline">All keywords</Link>}>
              {d.top_keywords.length === 0 ? <p className="text-13 text-slate-500 py-2">No keywords saved yet. {c.keywords_suggested ? 'Suggestions are waiting in Keyword Research.' : 'Find some in Keyword Research.'}</p> : (
                <TopKeywords rows={d.top_keywords} />
              )}
            </Card>
            <Card title="Latest backlinks" subtitle={d.backlink_domain ? `Links to ${d.backlink_domain} found by our crawler · ${fmt(c.backlinks)} in total from ${fmt(c.referring_domains)} domains` : 'The website of this project is not tracked yet'} action={<Link to="/backlinks/links" className="text-12.5 font-semibold text-indigo-600 hover:underline">All backlinks</Link>}>
              {d.latest_backlinks.length === 0 ? <p className="text-13 text-slate-500 py-2">{d.backlink_domain ? 'The crawler has not found a link to this site yet. It checks regularly: new links appear here.' : 'Add the website to the project to start finding backlinks.'}</p> : (
                <ul className="divide-y divide-slate-100">
                  {d.latest_backlinks.map((l, i) => (
                    <li key={i} className="py-2.5 flex items-start gap-3"><Link2 size={15} className="text-indigo-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0"><div className="text-13 text-slate-900 truncate">{l.from}</div><div className="text-11.5 text-slate-500 truncate">{l.anchor ? `“${l.anchor}”` : 'no anchor text'} · {l.first_seen ? ago(l.first_seen) : 'date unknown'}</div></div>
                      {l.verified && <Badge tone="green">Verified</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

        </>
      )}
    </section>
  );
}
