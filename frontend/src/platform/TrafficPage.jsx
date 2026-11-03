import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend as ChartLegend } from 'recharts';
import { Activity, Users, UserPlus, MousePointerClick, Zap, Eye, Clock, Gauge, PlugZap, RefreshCw, Radio, Search } from 'lucide-react';
import { SeoShell, Card, Stat, Badge, Button, ErrorNote, Field, Empty, Tabs, inputCls, SERIES, INK, SkPage } from './SeoUi';
import { api, useApi, fmt } from './seoApi';

/**
 * Website traffic from Google Analytics 4 for a connected Google account / website.
 * Data: GET /analytics/ga4/by-email (needs the account connected once through GET /analytics/ga4/start).
 */

const KEY = 'traffic.last';
const readLast = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const saveLast = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ } };

const dur = (s) => { const t = Math.floor(s || 0); const m = Math.floor(t / 60); return m ? `${m}m ${t % 60}s` : `${t}s`; };
const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(2).replace(/\.00$/, '')}%`);
const dayLabel = (d) => String(d || '').slice(5);
// GA4 hides "(not set)" rows in its cards
const shown = (rows) => (rows || []).filter(r => !Object.values(r).includes('(not set)'));
const share = (v, total) => (total ? `${((v / total) * 100).toFixed(1)}%` : '—');

function Table({ cols, rows, empty = 'No data for this period.' }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-13">
        <thead>
          <tr className="text-11 font-semibold text-slate-400 border-b border-slate-100">
            {cols.map(c => <th key={c.label} className={`py-2 pr-4 font-semibold ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className={r.__total ? 'font-semibold bg-slate-50' : 'hover:bg-slate-50/60'}>
              {cols.map(c => <td key={c.label} className={`py-2 pr-4 text-slate-700 ${c.right ? 'text-right tabular-nums' : 'truncate max-w-[320px]'}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ r }) {
  const t = r.totals || {};
  const ch = r.change_percent || {};
  const channels = r.channels || [];
  const channelNames = useMemo(() => channels.map(c => c.channel), [channels]);
  const channelSeries = useMemo(() => {
    const by = {};
    (r.channel_timeline || []).forEach(p => { (by[p.date] = by[p.date] || { date: p.date })[p.channel] = p.sessions; });
    return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
  }, [r.channel_timeline]);
  const nvr = useMemo(() => {
    const by = {};
    (r.new_vs_returning || []).forEach(p => { (by[p.date] = by[p.date] || { date: p.date, new: 0, returning: 0 })[p.kind] = p.active_users; });
    return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
  }, [r.new_vs_returning]);
  const pathRows = useMemo(() => (r.paths?.length ? [{ __total: true, path: 'Total', views: t.screenPageViews, active_users: t.activeUsers, views_per_user: t.activeUsers ? Number((t.screenPageViews / t.activeUsers).toFixed(2)) : 0, engagement_per_user: t.engagementTimePerUser, event_count: t.eventCount, key_events: t.keyEvents }, ...r.paths] : []), [r.paths, t]);
  const totalSessions = channels.reduce((a, c) => a + (c.sessions || 0), 0);
  const totalUsers = (r.countries || []).reduce((a, c) => a + (c.active_users || 0), 0);
  const rt = r.realtime || { active_users_30_min: 0, by_country: [] };
  const sum = (key) => (r.timeline || []).reduce((a, p) => a + (p[key] || 0), 0);
  const period = r.period || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-12 text-slate-500">
        <Badge tone="blue">{r.property_name || r.property}</Badge>
        {r.account && <span>{r.account}</span>}
        {(r.websites || []).map(w => <Badge key={w} tone="gray">{w}</Badge>)}
        <span className="ml-auto">{period.start} to {period.end} ({period.days} days, compared with the {period.days} days before)</span>
      </div>

      {Object.keys(r.errors || {}).length > 0 && <ErrorNote>{Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}</ErrorNote>}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active users" value={fmt(t.activeUsers)} delta={ch.activeUsers} icon={Users} hint="vs previous period" />
        <Stat label="New users" value={fmt(t.newUsers)} delta={ch.newUsers} icon={UserPlus} />
        <Stat label="Sessions" value={fmt(t.sessions)} delta={ch.sessions} icon={Activity} />
        <Stat label="Engaged sessions" value={fmt(t.engagedSessions)} delta={ch.engagedSessions} icon={MousePointerClick} />
        <Stat label="Engagement rate" value={pct(t.engagementRate)} delta={ch.engagementRate} icon={Gauge} />
        <Stat label="Avg engagement time" value={dur(t.engagementTimePerUser)} delta={ch.engagementTimePerUser} icon={Clock} hint={`per active user · ${dur(t.averageSessionDuration)} per session`} />
        <Stat label="Event count" value={fmt(t.eventCount)} delta={ch.eventCount} icon={Zap} />
        <Stat label="Page views" value={fmt(t.screenPageViews)} delta={ch.screenPageViews} icon={Eye} hint={`${fmt(t.keyEvents)} key events`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Realtime */}
        <Card title="Active users in last 30 minutes" subtitle="Live from Google Analytics" action={<Radio size={16} className="text-emerald-500" />}>
          <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{fmt(rt.active_users_30_min)}</div>
          <div className="mt-3">
            <Table cols={[{ label: 'Country', render: x => x.country }, { label: 'Active users', right: true, render: x => fmt(x.active_users) }]} rows={rt.by_country} empty="No active users right now." />
          </div>
        </Card>

        {/* Users and sessions over time */}
        <Card className="lg:col-span-2" title="Users and sessions per day" subtitle={`${fmt(sum('active_users'))} user-days · ${fmt(sum('sessions'))} sessions · ${fmt(sum('events'))} events`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={r.timeline || []} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} />
                <Tooltip />
                <ChartLegend />
                <Area type="monotone" dataKey="sessions" name="Sessions" stroke={SERIES[1]} fill={SERIES[1]} fillOpacity={0.12} strokeWidth={2} />
                <Area type="monotone" dataKey="active_users" name="Active users" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Traffic acquisition */}
      <Card title="Traffic acquisition" subtitle="Sessions by primary channel group">
        {channelSeries.length > 0 && (
          <div className="h-64 mb-5">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={channelSeries} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} />
                <Tooltip />
                <ChartLegend />
                {channelNames.map((n, i) => <Line key={n} type="monotone" dataKey={n} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <Table
          cols={[
            { label: 'Channel', render: c => c.channel },
            { label: 'Sessions', right: true, render: c => `${fmt(c.sessions)} (${share(c.sessions, totalSessions)})` },
            { label: 'Engaged sessions', right: true, render: c => fmt(c.engagedSessions) },
            { label: 'Engagement rate', right: true, render: c => pct(c.engagementRate) },
            { label: 'Avg engagement time', right: true, render: c => dur(c.averageSessionDuration) },
            { label: 'Events per session', right: true, render: c => Number(c.eventsPerSession || 0).toFixed(2) },
            { label: 'Event count', right: true, render: c => fmt(c.eventCount) }
          ]}
          rows={channels}
        />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Active users by country">
          <Table cols={[{ label: 'Country', render: c => c.country }, { label: 'Active users', right: true, render: c => `${fmt(c.active_users)} (${share(c.active_users, totalUsers)})` }, { label: 'Sessions', right: true, render: c => fmt(c.sessions) }]} rows={r.countries} />
        </Card>
        <Card title="Top pages/screens" subtitle="Page title and screen class">
          <Table cols={[{ label: 'Page title', render: p => p.title }, { label: 'Views', right: true, render: p => fmt(p.views) }, { label: 'Active users', right: true, render: p => fmt(p.active_users) }, { label: 'Event count', right: true, render: p => fmt(p.event_count) }, { label: 'Bounce rate', right: true, render: p => pct(p.bounce_rate) }]} rows={shown(r.pages)} />
        </Card>
        <Card title="Devices">
          <Table cols={[{ label: 'Device', render: d => d.device }, { label: 'Active users', right: true, render: d => fmt(d.active_users) }, { label: 'Sessions', right: true, render: d => fmt(d.sessions) }]} rows={r.devices} />
        </Card>
        <Card title="Source / medium">
          <Table cols={[{ label: 'Source / medium', render: s => s.source_medium }, { label: 'Sessions', right: true, render: s => fmt(s.sessions) }, { label: 'Active users', right: true, render: s => fmt(s.active_users) }]} rows={shown(r.sources)} />
        </Card>
        <Card title="Active users by first user source / medium">
          <Table cols={[{ label: 'First user source / medium', render: s => s.source_medium }, { label: 'Active users', right: true, render: s => fmt(s.active_users) }]} rows={shown(r.first_sources)} />
        </Card>
        <Card title="Active users by city">
          <Table cols={[{ label: 'City', render: c => c.city }, { label: 'Active users', right: true, render: c => fmt(c.active_users) }]} rows={shown(r.cities)} />
        </Card>
        <Card title="New vs returning users" subtitle="Active users per day">
          {nvr.length ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={nvr} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} />
                  <Tooltip />
                  <ChartLegend />
                  <Line type="monotone" dataKey="new" name="new" stroke={SERIES[1]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="returning" name="returning" stroke="#7cb342" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No data available.</Empty>}
        </Card>
        <Card title="Key events by platform">
          <Table cols={[{ label: 'Platform', render: k => k.platform }, { label: 'Key events', right: true, render: k => fmt(k.key_events) }]} rows={r.key_events_platform} empty="No data available." />
        </Card>
        <Card title="Active users by audience name">
          <Table cols={[{ label: 'Audience name', render: a => a.audience }, { label: 'Active users', right: true, render: a => fmt(a.active_users) }]} rows={r.audiences} empty="No data available." />
        </Card>
      </div>

      <Card title="Pages and screens" subtitle="Page path and screen class">
        <Table
          cols={[
            { label: 'Page path and screen class', render: p => p.path },
            { label: 'Views', right: true, render: p => fmt(p.views) },
            { label: 'Active users', right: true, render: p => fmt(p.active_users) },
            { label: 'Views per active user', right: true, render: p => Number(p.views_per_user || 0).toFixed(2) },
            { label: 'Avg engagement time per active user', right: true, render: p => dur(p.engagement_per_user) },
            { label: 'Event count', right: true, render: p => fmt(p.event_count) },
            { label: 'Key events', right: true, render: p => fmt(p.key_events) }
          ]}
          rows={pathRows}
        />
      </Card>
    </div>
  );
}

/** GA4's "Reports snapshot": the headline numbers and the top-7 cards, in the same layout. Built from the same report data as the Overview tab. */
function Snapshot({ r }) {
  const t = r.totals || {};
  const period = r.period || {};
  const nvr = useMemo(() => {
    const by = {};
    (r.new_vs_returning || []).forEach(p => { (by[p.date] = by[p.date] || { date: p.date, new: 0, returning: 0 })[p.kind] = p.active_users; });
    return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
  }, [r.new_vs_returning]);
  const Kpi = ({ label, value }) => (
    <div className="px-5 py-3 min-w-0 border-l first:border-l-0 border-slate-100">
      <div className="text-14 text-slate-600 truncate">{label}</div>
      <div className="text-3xl font-normal text-slate-900 mt-1 tabular-nums">{value}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-12 text-slate-500">
        <Badge tone="blue">{r.property_name || r.property}</Badge>
        <span className="ml-auto">Last {period.days} days · {period.start} to {period.end}</span>
      </div>
      {Object.keys(r.errors || {}).length > 0 && <ErrorNote>{Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}</ErrorNote>}

      <Card pad={false}>
        <div className="grid grid-cols-2 lg:grid-cols-4 py-3">
          <Kpi label="Active users" value={fmt(t.activeUsers)} />
          <Kpi label="New users" value={fmt(t.newUsers)} />
          <Kpi label="Average engagement time" value={dur(t.engagementTimePerUser)} />
          <Kpi label="Event count" value={fmt(t.eventCount)} />
        </div>
      </Card>

      <Card title="Top pages/screens" subtitle="Page title and screen class">
        <Table cols={[{ label: 'Page title and screen class', render: p => p.title }, { label: 'Views', right: true, render: p => fmt(p.views) }, { label: 'Active users', right: true, render: p => fmt(p.active_users) }, { label: 'Event count', right: true, render: p => fmt(p.event_count) }, { label: 'Bounce rate', right: true, render: p => pct(p.bounce_rate) }]} rows={shown(r.pages).slice(0, 7)} />
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Active users by first user source / medium">
          <Table cols={[{ label: 'First user source / medium', render: x => x.source_medium }, { label: 'Active users', right: true, render: x => fmt(x.active_users) }]} rows={shown(r.first_sources).slice(0, 7)} />
        </Card>
        <Card title="Sessions by session source / medium">
          <Table cols={[{ label: 'Session source / medium', render: x => x.source_medium }, { label: 'Sessions', right: true, render: x => fmt(x.sessions) }]} rows={shown(r.sources).slice(0, 7)} />
        </Card>
        <Card title="New vs returning users">
          {nvr.length ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={nvr} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} />
                  <Tooltip />
                  <ChartLegend />
                  <Line type="monotone" dataKey="new" name="new" stroke="#1a73e8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="returning" name="returning" stroke="#7cb342" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No data available.</Empty>}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Key events by platform">
          <Table cols={[{ label: 'Platform', render: k => k.platform }, { label: 'Key events', right: true, render: k => fmt(k.key_events) }]} rows={r.key_events_platform} empty="No data available" />
        </Card>
        <Card title="Active users by city">
          <Table cols={[{ label: 'City', render: c => c.city }, { label: 'Active users', right: true, render: c => fmt(c.active_users) }]} rows={shown(r.cities).slice(0, 7)} />
        </Card>
        <Card title="Active users by audience name">
          <Table cols={[{ label: 'Audience name', render: a => a.audience }, { label: 'Active users', right: true, render: a => fmt(a.active_users) }]} rows={r.audiences} empty="No data available" />
        </Card>
      </div>
    </div>
  );
}

/** Shown while Google Analytics answers (it can take several seconds): a radar pulse, rotating status lines and skeleton cards. */
function LiveLoader({ steps, pages }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(n => (n + 1) % steps.length), 1800); return () => clearInterval(t); }, [steps.length]);
  const bar = 'rounded bg-slate-100 animate-pulse';
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <style>{`@keyframes gz-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}@keyframes gz-rise{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}`}</style>
      <div className="ai-glass-card rounded px-5 py-6 flex flex-col items-center text-center">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-indigo-400/30 animate-ping" />
          <span className="absolute inset-2 rounded-full bg-indigo-400/30 animate-ping" style={{ animationDelay: '.5s' }} />
          <span className="relative w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center"><Radio size={18} /></span>
        </div>
        <div className="mt-4 flex items-end gap-1 h-6" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6].map(n => <span key={n} className="w-1.5 h-full rounded-sm bg-indigo-400 origin-bottom" style={{ animation: 'gz-rise 1.1s ease-in-out infinite', animationDelay: `${n * 0.12}s` }} />)}
        </div>
        <div className="mt-3 text-14 font-semibold text-slate-800">Fetching live data from Google Analytics</div>
        <div key={i} className="text-12.5 text-slate-500 mt-1 min-h-[18px] transition-opacity">{steps[i]}…</div>
        <div className="mt-4 h-1 w-56 max-w-full rounded-full bg-slate-100 overflow-hidden"><div className="h-full w-1/3 rounded-full bg-indigo-500" style={{ animation: 'gz-sweep 1.4s ease-in-out infinite' }} /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {[0, 1].map(n => <div key={n} className="ai-glass-card rounded p-4 space-y-2"><div className={`${bar} h-3 w-2/3`} /><div className={`${bar} h-7 w-1/3`} /></div>)}
      </div>
      <div className="ai-glass-card rounded p-4"><div className={`${bar} h-3 w-40 mb-3`} /><div className="flex items-end gap-1 h-28">{Array.from({ length: 30 }, (_, n) => <div key={n} className={`${bar} flex-1`} style={{ height: `${20 + ((n * 37) % 70)}%`, animationDelay: `${n * 40}ms` }} />)}</div></div>
      {pages && <div className="ai-glass-card rounded p-4 space-y-2">{[0, 1, 2, 3].map(n => <div key={n} className={`${bar} h-4`} style={{ width: `${95 - n * 12}%` }} />)}</div>}
    </div>
  );
}

/** GA4 "Realtime overview" and "Realtime pages" for one property; refreshes every 30 seconds while the tab is visible. */
function Realtime({ email, property, name, pages }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const id = String(property).split('/').pop();
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try { const x = await api(`/analytics/ga4/realtime?email=${encodeURIComponent(email)}&property_id=${id}`); if (alive) { setD(x); setErr(null); } } catch (e) { if (alive) setErr(e); }
    };
    pull();
    const t = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [email, id]);

  if (err && !d) return <ErrorNote>{err.message}</ErrorNote>;
  if (!d) return <LiveLoader pages={pages} steps={['Connecting to your Analytics property', 'Counting active users right now', 'Reading the last 30 minutes of activity', pages ? 'Collecting page views' : 'Collecting locations and events']} />;
  const bars = (d.per_minute || []).map(m => ({ label: `-${m.minutes_ago + 1} min`, active_users: m.active_users }));
  const totalViews = (d.screens || []).reduce((a, x) => a + x.views, 0);
  const totalEvents = (d.events || []).reduce((a, x) => a + x.count, 0);
  const chart = (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} interval={4} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK.muted }} stroke={INK.axis} />
          <Tooltip />
          <Bar dataKey="active_users" name="Active users" fill="#1a73e8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-12 text-slate-500">
        <Badge tone="green">Live</Badge><Badge tone="blue">{name || property}</Badge>
        <span className="ml-auto">Updates every 30 seconds</span>
      </div>
      {Object.keys(d.errors || {}).length > 0 && <ErrorNote>{Object.entries(d.errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}</ErrorNote>}

      {pages ? (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <Stat label="Active users in last 30 minutes" value={fmt(d.active_users_30)} icon={Users} />
            <Stat label="Views in last 30 minutes" value={fmt(d.views_30)} icon={Eye} />
          </div>
          <Card title="Active users per minute">{chart}</Card>
          <Card title="Page title and screen name in last 30 minutes" subtitle="Google's realtime API does not report the page path, so pages are listed by title">
            <Table cols={[{ label: 'Page title and screen name', render: x => x.title }, { label: 'Active users', right: true, render: x => fmt(x.active_users) }, { label: 'Views', right: true, render: x => fmt(x.views) }]} rows={d.screens} empty="No page views in the last 30 minutes." />
          </Card>
        </>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <Stat label="Active users in last 30 minutes" value={fmt(d.active_users_30)} icon={Users} />
            <Stat label="Active users in last 5 minutes" value={fmt(d.active_users_5)} icon={Radio} />
          </div>
          <Card title="Active users per minute">{chart}</Card>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Active users by location" subtitle="Country and city, last 30 minutes">
              <Table cols={[{ label: 'Country', render: x => x.country }, { label: 'City', render: x => x.city }, { label: 'Active users', right: true, render: x => fmt(x.active_users) }]} rows={shown(d.locations)} empty="No active users right now." />
            </Card>
            <Card title="Active users by audience">
              <Table cols={[{ label: 'Audience', render: x => x.audience }, { label: 'Active users', right: true, render: x => fmt(x.active_users) }]} rows={d.audiences} empty="No data available." />
            </Card>
            <Card title="Views by page title and screen name">
              <Table cols={[{ label: 'Page title and screen name', render: x => x.title }, { label: 'Views', right: true, render: x => `${fmt(x.views)} (${share(x.views, totalViews)})` }]} rows={d.screens} empty="No data available." />
            </Card>
            <Card title="Event count by event name">
              <Table cols={[{ label: 'Event name', render: x => x.event }, { label: 'Event count', right: true, render: x => `${fmt(x.count)} (${share(x.count, totalEvents)})` }]} rows={d.events} empty="No data available." />
            </Card>
            <Card title="Key events by event name">
              <Table cols={[{ label: 'Event name', render: x => x.event }, { label: 'Key events', right: true, render: x => fmt(x.count) }]} rows={d.key_events} empty="No data available." />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Page({ defaultEmail = '', defaultWebsite = '', auto = false, view: viewProp, initialView = 'snap' }) {
  const last = readLast();
  const [email, setEmail] = useState(defaultEmail || last.email || '');
  const [website, setWebsite] = useState(defaultWebsite || (defaultEmail ? '' : last.website) || '');
  const [days, setDays] = useState(last.days || 28);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [viewState, setView] = useState(initialView);
  const view = viewProp || viewState; // embedded in a workspace, the view comes from its inner sidebar
  const chosenProperty = useRef(null); // a property picked from the "No property matched" list stays picked while the period changes
  const requestNo = useRef(0); // only the latest request may update the page

  const load = async (propertyId, daysOverride) => {
    if (email.trim().length < 3 && website.trim().length < 3) { setError({ message: 'Enter a website or domain, or the Google account email.' }); return; }
    if (propertyId) chosenProperty.current = propertyId;
    const pid = propertyId || chosenProperty.current;
    const period = daysOverride || days;
    const mine = ++requestNo.current;
    setBusy(true); setError(null);
    try {
      const qs = new URLSearchParams({ days: String(period) });
      if (email.trim()) qs.set('email', email.trim());
      if (website.trim()) qs.set('website', website.trim());
      if (pid) qs.set('property_id', String(pid));
      const result = await api(`/analytics/ga4/by-email?${qs}`);
      if (mine !== requestNo.current) return;
      setData(result);
      saveLast({ email: email.trim(), website: website.trim(), days: period });
    } catch (e) {
      if (mine !== requestNo.current) return;
      setData(null);
      const raw = String(e.message || '');
      // The API's 409 texts point at its own URLs: say the same thing in terms of this page.
      setError(e.status === 409 ? Object.assign(new Error(/disconnected/i.test(raw)
        ? 'This Google account is disconnected. Click "Connect / reconnect this Google account" below and sign in again.'
        : 'Analytics access has not been approved for this Google account yet. Click "Connect / reconnect this Google account" below and approve it.'), { status: 409 }) : e);
    } finally { if (mine === requestNo.current) setBusy(false); }
  };

  // Choosing a period fetches at once; nothing to press. Does nothing on an empty form, so no error pops up.
  const changePeriod = (n) => {
    setDays(n);
    if (data || email.trim().length >= 3 || website.trim().length >= 3) load(undefined, n);
  };

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const { url } = await api(`/analytics/ga4/start${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`);
      window.location.href = url;
    } catch (e) { setError(e); setBusy(false); }
  };

  // Embedded in a client's workspace: load as soon as the client's Google account email is known.
  useEffect(() => { if (auto && email.trim().length >= 3) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needsConnect = error && (error.status === 409 || error.status === 404);

  return (
    <div className="space-y-4">
      <Card title="Find website traffic" subtitle="Enter a website or domain, or the Google account that can open the site's Google Analytics. With only a website, every connected Google account is searched.">
        <form className="grid md:grid-cols-[1.4fr_1fr_140px_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); chosenProperty.current = null; load(); }}>
          <Field label="Website or domain" hint="https://example.com or example.com"><input className={inputCls} placeholder="example.com" value={website} onChange={(e) => setWebsite(e.target.value)} /></Field>
          <Field label="Google account email (optional)" hint="Leave empty to search all connected accounts"><input className={inputCls} type="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Period">
            <select className={inputCls} value={days} onChange={(e) => changePeriod(Number(e.target.value))}>
              {[[7, 'Last 7 days'], [28, 'Last 28 days'], [90, 'Last 3 months'], [180, 'Last 6 months'], [365, 'Last 12 months']].map(([n, label]) => <option key={n} value={n}>{label}</option>)}
            </select>
          </Field>
          <Button variant="primary" icon={data ? RefreshCw : Search} busy={busy} type="submit">{data ? 'Refresh' : 'Show traffic'}</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-12 text-slate-500">
          <Button size="sm" icon={PlugZap} onClick={connect} disabled={busy}>Connect / reconnect this Google account</Button>
          <span>Needed once per account, to allow read-only Analytics access.</span>
        </div>
        {error && <ErrorNote>{error.message}</ErrorNote>}
        {needsConnect && <p className="text-12 text-slate-500 mt-2">Use the connect button above, then sign in with exactly that Google account.</p>}
      </Card>

      {data && data.matched === false && (
        <Card title="No property matched" subtitle={data.message}>
          {data.websites_looked_for?.length > 0 && <p className="text-12 text-slate-500 mb-3">Looked for: {data.websites_looked_for.join(', ')}</p>}
          {data.found_by === 'website' && (
            <div className="text-12 text-slate-500 space-y-1">
              <p>Accounts searched: {data.accounts_checked?.length ? data.accounts_checked.join(', ') : 'none'}</p>
              {Object.entries(data.accounts_skipped || {}).map(([k, v]) => <p key={k} className="text-amber-700">Skipped {k}: {v}</p>)}
            </div>
          )}
          {data.found_by !== 'website' && <Table
            cols={[
              { label: 'Property', render: p => p.name || p.property },
              { label: 'Account', render: p => p.account || '—' },
              { label: 'Websites', render: p => (p.hosts?.length ? p.hosts.join(', ') : '—') },
              { label: '', right: true, render: p => <Button size="sm" onClick={() => load(p.property.split('/').pop())}>View traffic</Button> }
            ]}
            rows={data.properties_available}
            empty="This Google account can't see any Analytics property. Connect the account that owns or has been given access to the property."
          />}
        </Card>
      )}

      {data?.matched && data.found_by === 'website' && <p className="text-12 text-slate-500">Found through the connected Google account <b>{data.email}</b>.</p>}
      {data?.matched && (
        <>
          {!viewProp && <Tabs tabs={[{ id: 'snap', label: 'Reports snapshot' }, { id: 'overview', label: 'Overview' }, { id: 'rt', label: 'Realtime overview' }, { id: 'rtp', label: 'Realtime pages' }]} value={view} onChange={setView} />}
          {view === 'snap' && data.reports.map(r => <Snapshot key={r.property} r={r} />)}
          {view === 'overview' && data.reports.map(r => <Report key={r.property} r={r} />)}
          {(view === 'rt' || view === 'rtp') && data.reports.map(r => <Realtime key={`${r.property}-${view}`} email={data.email} property={r.property} name={r.property_name} pages={view === 'rtp'} />)}
        </>
      )}

      {!data && busy && <LiveLoader pages steps={['Finding your Analytics property', 'Checking access for the connected Google account', 'Loading traffic reports']} />}
      {!data && !error && !busy && <Empty>Enter a website or an email and press "Show traffic" to see users, sessions, channels, countries and top pages.</Empty>}
    </div>
  );
}

/** Website traffic for one client, inside its Business Profile workspace: uses the client's connected Google email and website. */
export function BusinessTraffic({ b, view, initialView }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  if (!live.data) return live.error ? <Empty>{live.error.message}</Empty> : <SkPage header={false} statLabels={["Active users", "New users", "Sessions", "Engaged sessions", "Engagement rate", "Avg engagement time", "Event count", "Page views"]} chartTitle="Users and sessions per day" tableTitle="Pages" tableHeaders={["Page title", "Views", "Active users", "Event count", "Bounce rate"]} />;
  const email = live.data.connection?.email || '';
  return (
    <div id="website-traffic" className="space-y-2 scroll-mt-24">
      <h2 className="text-15 font-semibold text-slate-900 pt-2">Website traffic <span className="text-12 font-normal text-slate-400">· Google Analytics 4</span></h2>
      <Page key={`${b.id}-${email}`} defaultEmail={email} defaultWebsite={b.website || ''} auto view={view} initialView={initialView} />
    </div>
  );
}

export default function TrafficPage() {
  return <SeoShell title="Website Traffic" subtitle="Visitors, sessions, channels, countries and pages from Google Analytics 4" needsBusiness={false} hideSwitcher>{() => <Page />}</SeoShell>;
}
