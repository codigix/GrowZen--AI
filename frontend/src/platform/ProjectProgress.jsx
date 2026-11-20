import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Phone, Navigation, MousePointerClick, Eye, Star, Users, Wrench, FileText, ArrowUpRight, ArrowDownRight, Minus, CheckCircle2, Clock, ListChecks, Send, Search, Globe, BookOpen, MessageSquare, Link2, ClipboardCheck } from 'lucide-react';
import { Card, Badge, ChartTooltip, Legend, SERIES, INK } from './SeoUi';
import { useApi, fmt } from './seoApi';

const C = { calls: SERIES[0], directions: SERIES[1], website_clicks: SERIES[2] };

const ago = (iso) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 2) return 'just now';
  if (m < 90) return `${m} min ago`;
  if (m < 2880) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

function Change({ m, unit }) {
  if (!m) return null;
  if (!m.delta) return <span className="text-11.5 text-slate-400 inline-flex items-center gap-0.5"><Minus size={12} />same as last {unit}</span>;
  const up = m.delta > 0;
  const I = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`text-11.5 font-semibold inline-flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-red-600'}`}><I size={13} />{up ? '+' : ''}{fmt(m.delta)}{m.pct != null ? ` (${m.pct > 0 ? '+' : ''}${m.pct}%)` : ''} vs last {unit}</span>;
}

function Kpi({ icon: Icon, label, m, unit, total }) {
  return (
    <div className="ai-glass-card rounded p-4 flex items-start gap-3 min-w-0">
      <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><Icon size={17} /></span>
      <div className="min-w-0">
        <div className="text-12 font-semibold text-slate-500 truncate">{label}</div>
        <div className="text-24 leading-tight font-bold text-slate-900 tabular-nums">{fmt(m?.now || 0)}</div>
        <Change m={m} unit={unit} />
        {total != null && <div className="text-11 text-slate-400">{fmt(total)} in total</div>}
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
export default function ProgressSection({ b }) {
  const [period, setPeriod] = useState('week');
  const r = useApi(`/businesses/${b.id}/dashboard?period=${period}`);
  const d = r.data;
  const unit = period === 'month' ? 'month' : 'week';
  const toggle = (
    <div className="inline-flex p-0.5 rounded bg-slate-100" role="tablist" aria-label="Period">
      {[['week', 'Week by week'], ['month', 'Month by month']].map(([id, t]) => (
        <button key={id} type="button" role="tab" aria-selected={period === id} onClick={() => setPeriod(id)} className={`h-8 px-3 rounded text-12.5 font-semibold cursor-pointer ${period === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{t}</button>
      ))}
    </div>
  );

  if (r.error) return <Card title="Progress"><p className="text-13 text-red-600">{r.error.message}</p></Card>;
  if (!d) return <Card title="Progress" action={toggle}><div className="h-40 flex items-center justify-center text-13 text-slate-400">Loading this project's numbers…</div></Card>;

  const rows = d.labels.map((label, i) => ({ label, ...Object.fromEntries(Object.entries(d.series).map(([k, v]) => [k, v[i]])), health: d.health[i] }));
  const any = (k) => (d.series[k] || []).some(Boolean);
  const m = d.movement;
  const c = d.counts;
  const fixPct = c.fixes_total ? Math.round((c.fixes_done / c.fixes_total) * 100) : 0;
  const idxPct = c.pages_known ? Math.round((c.pages_indexed / c.pages_known) * 100) : 0;
  const nothing = !Object.values(d.series).some(v => v.some(Boolean)) && !d.health.some(x => x != null);

  return (
    <section className="space-y-5" aria-label="Progress">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-18 font-semibold text-slate-900">Progress</h2><p className="text-13 text-slate-500">{period === 'month' ? 'The last 6 months' : 'The last 12 weeks'}, from what is stored for this project. The change shown is the latest {unit} against the {unit} before.</p></div>
        {toggle}
      </div>

      {nothing && <div className="rounded bg-sky-50 ring-1 ring-inset ring-sky-100 px-4 py-3 text-13 text-sky-900">Nothing has happened in this period yet. Connect the Google profile, run a website audit and start the Growth Plan: each action shows up here as it happens.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Phone} label={`Calls · this ${unit}`} m={m.calls} unit={unit} />
        <Kpi icon={Navigation} label={`Directions · this ${unit}`} m={m.directions} unit={unit} />
        <Kpi icon={MousePointerClick} label={`Website clicks · this ${unit}`} m={m.website_clicks} unit={unit} />
        <Kpi icon={Eye} label={`Profile views · this ${unit}`} m={m.views} unit={unit} />
        <Kpi icon={Star} label={`New reviews · this ${unit}`} m={m.reviews} unit={unit} total={c.reviews} />
        <Kpi icon={Users} label={`Leads · this ${unit}`} m={m.leads} unit={unit} total={c.leads} />
        <Kpi icon={Wrench} label={`Issues fixed · this ${unit}`} m={m.fixes} unit={unit} total={c.fixes_done} />
        <Kpi icon={FileText} label={`Articles written · this ${unit}`} m={m.articles} unit={unit} total={c.articles} />
        <Kpi icon={Search} label={`Keywords added · this ${unit}`} m={m.keywords} unit={unit} total={c.keywords_saved} />
        <Kpi icon={Link2} label={`Backlinks gained · this ${unit}`} m={m.backlinks} unit={unit} total={c.backlinks} />
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
        <Card title="Keywords" subtitle={`${fmt(c.keywords_saved)} saved · ${fmt(c.keywords_tracked)} tracked · ${fmt(c.keywords_suggested)} suggestions`} action={<Link to="/keyword-management/tracked" className="text-12.5 font-semibold text-indigo-600 hover:underline">All keywords</Link>}>
          {d.top_keywords.length === 0 ? <p className="text-13 text-slate-500 py-2">No keywords saved yet. {c.keywords_suggested ? 'Suggestions are waiting in Keyword Research.' : 'Find some in Keyword Research.'}</p> : (
            <table className="w-full text-13">
              <thead className="text-11.5 text-slate-500"><tr><th className="py-1.5 text-left font-semibold">Keyword</th><th className="py-1.5 text-right font-semibold">Position</th><th className="py-1.5 text-right font-semibold">Searches / month</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.top_keywords.map(k => {
                const move = k.rank && k.prev_rank ? k.prev_rank - k.rank : 0;
                return (<tr key={k.keyword}><td className="py-2 pr-2 text-slate-900">{k.keyword}{!k.tracked && <span className="ml-2 text-11 text-slate-400">not tracked</span>}</td>
                  <td className="py-2 text-right tabular-nums">{k.rank ? <>#{k.rank}{move !== 0 && <span className={`ml-1.5 text-11.5 font-semibold ${move > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{move > 0 ? '▲' : '▼'}{Math.abs(move)}</span>}</> : <span className="text-slate-400">not read yet</span>}</td>
                  <td className="py-2 text-right tabular-nums text-slate-600">{k.volume != null ? fmt(k.volume) : '—'}</td></tr>);
              })}</tbody>
            </table>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card title="Actions taken" subtitle={`${m.actions.now} logged this ${unit}${m.actions.before ? `, ${m.actions.before} last ${unit}` : ''}`}>
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
    </section>
  );
}
