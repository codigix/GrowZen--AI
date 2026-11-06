import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend as ChartLegend } from 'recharts';
import { Activity, Users, UserPlus, MousePointerClick, Zap, Eye, Clock, Gauge, PlugZap, RefreshCw, Radio, Search } from 'lucide-react';
import { SeoShell, useBusinesses, Card, Stat, Badge, Button, ErrorNote, Field, Empty, Tabs, inputCls, SERIES, INK, SkPage } from './SeoUi';
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

/**
 * Right-hand panel. Everything is computed from the loaded report, so it changes as the site grows:
 *  - stage (starter / growing / established) from sessions in the period, with different advice for each
 *  - "Based on your data": rules that quote your own numbers, pages, cities and sources, each with an example
 *  - "Today's focus": 3 actions that rotate every day (by date) and can be ticked off; ticks are remembered per day
 *  - "Since your last check": change against the snapshot saved the last time this site was viewed
 */
const SNAP_KEY = 'traffic.snapshot';
const DONE_KEY = 'traffic.done';
const today = () => new Date().toISOString().slice(0, 10);
const dayNo = () => Math.floor(Date.now() / 86400000);
const safeGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ } };

const STAGES = {
  starter: { label: 'Getting started', tone: 'amber', next: 'Goal: 500 sessions per month. Focus on being found: Google Business Profile, core pages, and getting indexed.' },
  growing: { label: 'Growing', tone: 'blue', next: 'Goal: 5,000 sessions per month. Focus on more content, local pages and reviews.' },
  established: { label: 'Established', tone: 'green', next: 'Focus on conversions, repeat visitors and pages that rank 5-15 so they reach the top 3.' }
};

// Daily action pool. `stage` limits who sees it; `ex` is a concrete example. {city} and {page} are filled from the report.
const POOL = [
  { id: 'gbp-post', stage: ['starter', 'growing', 'established'], t: 'Publish one Google Business Profile post', ex: 'Example: "Free ENT check-up camp this Sunday in {city} - call to book".' },
  { id: 'review', stage: ['starter', 'growing', 'established'], t: 'Ask 3 recent patients or customers for a Google review', ex: 'Example: send a WhatsApp message with your review link right after a visit.' },
  { id: 'city-page', stage: ['starter', 'growing'], t: 'Write one page for a service in {city}', ex: 'Example: "Best <service> in {city}" with prices, doctors or team, address and a booking button.' },
  { id: 'index', stage: ['starter'], t: 'Check that your main pages are indexed', ex: 'Example: search "site:yourdomain.com" on Google, then submit missing pages in Search Console.' },
  { id: 'directories', stage: ['starter', 'growing'], t: 'Add or fix one directory listing', ex: 'Example: Justdial, Practo, Sulekha or IndiaMART with the same name, address and phone number.' },
  { id: 'faq', stage: ['starter', 'growing', 'established'], t: 'Add 3 real customer questions as FAQs on "{page}"', ex: 'Example: "How much does it cost?", "How long does it take?", "Is it covered by insurance?".' },
  { id: 'internal', stage: ['growing', 'established'], t: 'Add internal links to "{page}" from 3 related pages', ex: 'Example: link the words "cochlear implant" or your service name to the matching page.' },
  { id: 'title', stage: ['growing', 'established'], t: 'Rewrite one page title to include a search phrase and the city', ex: 'Example: "ENT Surgeon in Pimpri Chinchwad | Hospital Name" (under 60 characters).' },
  { id: 'video', stage: ['growing', 'established'], t: 'Post one short video that answers a common question', ex: 'Example: a 40-second Reel "3 signs your child needs a hearing test", linked to the page.' },
  { id: 'speed', stage: ['starter', 'growing', 'established'], t: 'Run PageSpeed Insights on "{page}"', ex: 'Example: compress images over 200 KB and remove unused scripts to pass the mobile test.' },
  { id: 'update', stage: ['growing', 'established'], t: 'Update your oldest blog post with new facts and the current date', ex: 'Example: refresh costs, add a new FAQ and change the "last updated" line.' },
  { id: 'backlink', stage: ['growing', 'established'], t: 'Ask one partner to link to you', ex: 'Example: an NGO, college, sponsor or local news site that you worked with.' },
  { id: 'conv', stage: ['growing', 'established'], t: 'Check that call, WhatsApp and form clicks are tracked as key events', ex: 'Example: in GA4, mark "click_to_call" and "form_submit" as key events.' },
  { id: 'story', stage: ['established'], t: 'Publish one customer story (with consent)', ex: 'Example: what the problem was, how it was solved, and a quote.' },
  { id: 'reengage', stage: ['established'], t: 'Message past customers about a new service or offer', ex: 'Example: WhatsApp broadcast with one link to the relevant page.' }
];

function Suggestions({ data }) {
  const r = data?.matched ? data.reports?.[0] : null;
  const [done, setDone] = useState(() => { const d = safeGet(DONE_KEY, {}); return d.date === today() ? d : { date: today(), ids: [] }; });
  const [since, setSince] = useState(null);

  const m = useMemo(() => {
    if (!r) return null;
    const t = r.totals || {};
    const channels = r.channels || [];
    const total = channels.reduce((a, c) => a + (c.sessions || 0), 0);
    const chan = (re) => channels.find(c => re.test(c.channel));
    const share = (c) => (total && c ? (c.sessions / total) * 100 : 0);
    const devs = r.devices || [];
    const devTotal = devs.reduce((a, d) => a + (d.sessions || 0), 0);
    const mobile = devs.find(d => /mobile/i.test(d.device));
    const pages = shown(r.pages);
    const cities = shown(r.cities);
    const sessions = t.sessions || 0;
    const days = Math.max(1, r.period?.days || 28);
    const perMonth = (sessions / days) * 30;
    const stage = perMonth < 500 ? 'starter' : perMonth < 5000 ? 'growing' : 'established';
    const nvr = r.new_vs_returning || [];
    return {
      t, ch: r.change_percent || {}, stage, sessions, perMonth, days, pages, cities,
      organic: share(chan(/organic search/i)), social: share(chan(/social/i)), referral: share(chan(/referral/i)),
      mobilePct: devTotal && mobile ? (mobile.sessions / devTotal) * 100 : 0,
      topCity: cities[0]?.city, topPage: pages[0],
      weakPage: pages.filter(p => p.views >= 10 && p.bounce_rate > 70).sort((a, b) => b.views - a.views)[0],
      returning: nvr.filter(p => p.kind === 'returning').reduce((a, p) => a + p.active_users, 0),
      newUsers: nvr.filter(p => p.kind === 'new').reduce((a, p) => a + p.active_users, 0),
      keyEvents: t.keyEvents || 0
    };
  }, [r]);

  // Compare with the snapshot from the last day this site was checked, then save today's numbers (once per day).
  useEffect(() => {
    if (!m) return;
    const all = safeGet(SNAP_KEY, {});
    const prev = all[r.property];
    if (prev && prev.date !== today()) setSince(prev);
    else if (prev && prev.since) setSince(prev.since);
    if (!prev || prev.date !== today()) {
      all[r.property] = {
        date: today(), days: m.days, sessions: m.sessions, organic: m.organic,
        since: prev ? { date: prev.date, days: prev.days, sessions: prev.sessions, organic: prev.organic } : undefined
      };
      safeSet(SNAP_KEY, all);
    }
  }, [m, r]);

  const toggle = (id) => {
    const ids = done.ids.includes(id) ? done.ids.filter(x => x !== id) : [...done.ids, id];
    const next = { date: today(), ids };
    setDone(next); safeSet(DONE_KEY, next);
  };

  if (!m) {
    return (
      <aside className="space-y-4 lg:sticky lg:top-24 self-start">
        <Card title="Suggestions"><p className="text-13 text-slate-500">Load a website's traffic to see suggestions based on its own numbers. They change as the site grows and rotate every day.</p></Card>
      </aside>
    );
  }

  const fill = (txt) => txt.replace(/\{city\}/g, m.topCity || 'your city').replace(/\{page\}/g, m.topPage?.title || 'your main service page');

  // Tips from the data, most important first. Each says what was seen, what to do, and an example.
  const tips = [];
  const { ch, organic, social, referral, mobilePct, topPage, weakPage, stage, keyEvents, returning, newUsers } = m;
  if (m.sessions === 0) tips.push({ tone: 'red', h: 'No visits in this period', t: 'Check that the Analytics tag is on every page and that the website in this form is correct.', ex: 'Example: open your site, then look at "Realtime overview" here; your own visit should appear within a minute.' });
  if (ch.sessions != null && ch.sessions <= -10) tips.push({ tone: 'red', h: `Sessions fell ${Math.abs(ch.sessions).toFixed(0)}%`, t: 'Find which channel dropped, then refresh the pages that lost traffic.', ex: 'Example: if Organic Search fell, open Search Console > Performance, compare dates and update the pages that lost clicks.' });
  if (ch.sessions != null && ch.sessions >= 10) tips.push({ tone: 'green', h: `Sessions grew ${ch.sessions.toFixed(0)}%`, t: 'Find what worked and repeat it.', ex: topPage ? `Example: "${topPage.title}" is your top page; write 2 related posts and link them to it.` : 'Example: check which channel grew most and publish more in it.' });
  if (organic < 30 && m.sessions > 0) tips.push({ tone: 'amber', h: `Organic search is ${organic.toFixed(0)}% of visits`, t: 'Too few people find you on Google.', ex: `Example: create "Best <service> in ${m.topCity || 'your city'}" pages and add the city and service to titles and headings.` });
  if (organic >= 50) tips.push({ tone: 'green', h: `Organic search is ${organic.toFixed(0)}% of visits`, t: 'Good: Google is your main source. Protect it.', ex: 'Example: keep updating your top pages every few months and add FAQ schema.' });
  if (social < 3 && stage !== 'starter') tips.push({ tone: 'blue', h: 'Almost no social traffic', t: 'Share every new page and link it from your profiles.', ex: 'Example: post a 30-second video each week with the page link in the bio and the caption.' });
  if (referral < 3 && stage !== 'starter') tips.push({ tone: 'blue', h: 'Few other sites link to you', t: 'Build links from trusted local sites.', ex: 'Example: get listed in local business directories and ask partners for an "Our partners" link.' });
  if (mobilePct > 60) tips.push({ tone: 'blue', h: `${mobilePct.toFixed(0)}% of visits are on mobile`, t: 'Make the phone experience the main one.', ex: 'Example: a sticky "Call now" and WhatsApp button, and text that is readable without zooming.' });
  if (m.t.engagementRate != null && m.t.engagementRate < 50) tips.push({ tone: 'amber', h: `Engagement rate is ${Number(m.t.engagementRate).toFixed(0)}%`, t: 'Visitors leave fast.', ex: 'Example: move the booking or contact button above the fold and cut slow images.' });
  if (weakPage) tips.push({ tone: 'amber', h: `"${weakPage.title}" has a ${Number(weakPage.bounce_rate).toFixed(0)}% bounce rate`, t: `${weakPage.views} views but most people leave.`, ex: 'Example: add a clear next step (button), related links and a short FAQ.' });
  if (keyEvents === 0 && m.sessions > 50) tips.push({ tone: 'amber', h: 'No key events recorded', t: 'You cannot see what brings enquiries.', ex: 'Example: in GA4 mark call clicks and form submits as key events.' });
  if (returning + newUsers > 30 && returning / (returning + newUsers) < 0.1) tips.push({ tone: 'blue', h: 'Few returning visitors', t: 'People visit once and do not return.', ex: 'Example: start a monthly health tips post and share it by WhatsApp or email.' });
  if (m.topCity) tips.push({ tone: 'gray', h: `Most visitors come from ${m.topCity}`, t: 'Build more content for that area.', ex: `Example: add a "How to reach us from ${m.topCity}" section and Google Business Profile posts mentioning it.` });

  // 3 daily actions: the pool for this stage, rotated by the date; ticked ones are kept for today.
  const pool = POOL.filter(x => x.stage.includes(m.stage));
  const start = dayNo() % pool.length;
  const todays = [0, 1, 2].map(i => pool[(start + i * 4) % pool.length]).filter((x, i, a) => a.indexOf(x) === i);
  const doneCount = todays.filter(x => done.ids.includes(x.id)).length;

  const sincePct = since && since.days === m.days && since.sessions ? `${m.sessions >= since.sessions ? '+' : ''}${(((m.sessions - since.sessions) / since.sessions) * 100).toFixed(0)}%` : null;
  const st = STAGES[m.stage];
  return (
    <aside className="space-y-4 lg:sticky lg:top-24 self-start">
      <Card title="Your stage" action={<Badge tone={st.tone}>{st.label}</Badge>}>
        <p className="text-13 text-slate-600">About {fmt(Math.round(m.perMonth))} sessions per month. {st.next}</p>
        {sincePct && <p className="text-12 text-slate-500 mt-2">Since your last check ({since.date}): sessions {sincePct}{since.organic != null ? `, organic share ${since.organic.toFixed(0)}% to ${m.organic.toFixed(0)}%` : ''}.</p>}
      </Card>

      <Card title="Today's focus" subtitle={`${doneCount} of ${todays.length} done · new actions tomorrow`}>
        <ul className="space-y-3">
          {todays.map(x => (
            <li key={x.id} className="text-13">
              <label className="flex gap-2 cursor-pointer">
                <input type="checkbox" className="mt-1" checked={done.ids.includes(x.id)} onChange={() => toggle(x.id)} />
                <span>
                  <span className={`font-semibold ${done.ids.includes(x.id) ? 'line-through text-slate-400' : 'text-slate-800'}`}>{fill(x.t)}</span><br />
                  <span className="text-slate-500">{fill(x.ex)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Based on your data" subtitle="Updates whenever the numbers change">
        {tips.length ? (
          <ul className="space-y-3.5">
            {tips.slice(0, 6).map((x, i) => (
              <li key={i} className="text-13">
                <div className="flex items-start gap-2"><Badge tone={x.tone}>{x.tone === 'green' ? 'Good' : x.tone === 'red' ? 'Fix' : 'Tip'}</Badge><span className="font-semibold text-slate-800">{x.h}</span></div>
                <div className="text-slate-600 mt-1">{x.t}</div>
                <div className="text-slate-500 mt-0.5">{x.ex}</div>
              </li>
            ))}
          </ul>
        ) : <Empty>No issues found. Keep publishing and check again tomorrow.</Empty>}
      </Card>
    </aside>
  );
}

function Page({ defaultEmail = '', defaultWebsite = '', auto = false, view: viewProp, initialView = 'snap' }) {
  // Inside a project (auto) the form is that project's website and nothing else: never the last site typed for another project.
  const last = auto ? {} : readLast();
  const [email, setEmail] = useState(auto ? defaultEmail : (defaultEmail || last.email || ''));
  const [website, setWebsite] = useState(auto ? defaultWebsite : (defaultWebsite || (defaultEmail ? '' : last.website) || ''));
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
      if (!auto) saveLast({ email: email.trim(), website: website.trim(), days: period });
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
  useEffect(() => { if (auto && (email.trim().length >= 3 || website.trim().length >= 3)) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needsConnect = error && (error.status === 409 || error.status === 404);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
    <div className="space-y-4 min-w-0">
      <Card title="Find website traffic" subtitle="Enter a website or domain, or the Google account that can open the site's Google Analytics. With only a website, every connected Google account is searched.">
        <form className="grid md:grid-cols-[1.4fr_1fr_140px_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); chosenProperty.current = null; load(); }}>
          <Field label="Website or domain" hint="https://example.com or example.com"><input className={inputCls} placeholder="example.com" value={website} readOnly={auto} title={auto ? "This project's website" : undefined} onChange={(e) => setWebsite(e.target.value)} /></Field>
          <Field label="Google account email (optional)" hint="Leave empty to search all connected accounts"><input className={inputCls} type="email" placeholder="name@gmail.com" value={email} readOnly={auto} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Period">
            <select className={inputCls} value={days} onChange={(e) => changePeriod(Number(e.target.value))}>
              {[[7, 'Last 7 days'], [28, 'Last 28 days'], [90, 'Last 3 months'], [180, 'Last 6 months'], [365, 'Last 12 months']].map(([n, label]) => <option key={n} value={n}>{label}</option>)}
            </select>
          </Field>
          <Button variant="primary" icon={data ? RefreshCw : Search} busy={busy} type="submit">{data ? 'Refresh' : 'Show traffic'}</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-12 text-slate-500">
          {data?.matched && data.email && <Badge tone="green">Google Analytics connected · {data.email}</Badge>}
          <Button size="sm" icon={PlugZap} onClick={connect} disabled={busy}>{data?.matched ? 'Reconnect or switch Google account' : 'Connect / reconnect this Google account'}</Button>
          <span>{data?.matched ? 'Already connected, with read-only Analytics access. Reconnect only to switch accounts or renew access.' : 'Needed once per account, to allow read-only Analytics access.'}</span>
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
    <Suggestions data={data} />
    </div>
  );
}

/** Website traffic for one client, inside its Business Profile workspace: uses the client's connected Google email and website. */
export function BusinessTraffic({ b, view, initialView }) {
  const live = useApi(`/businesses/${b.id}/gbp/live`);
  if (!live.data && !live.error) return <SkPage header={false} statLabels={["Active users", "New users", "Sessions", "Engaged sessions", "Engagement rate", "Avg engagement time", "Event count", "Page views"]} chartTitle="Users and sessions per day" tableTitle="Pages" tableHeaders={["Page title", "Views", "Active users", "Event count", "Bounce rate"]} />;
  const email = live.data?.connection?.email || ''; // a project with no Google link still shows its own website's traffic
  return (
    <div id="website-traffic" className="space-y-2 scroll-mt-24">
      <h2 className="text-15 font-semibold text-slate-900 pt-2">Website traffic <span className="text-12 font-normal text-slate-400">· Google Analytics 4</span></h2>
      <Page key={`${b.id}-${email}-${b.website || ''}`} defaultEmail={email} defaultWebsite={b.website || ''} auto view={view} initialView={initialView} />
    </div>
  );
}

export default function TrafficPage() {
  const { list } = useBusinesses();
  return <SeoShell title="Website Traffic" subtitle="Visitors, sessions, channels, countries and pages from Google Analytics 4" needsBusiness={false} hideSwitcher>{(business) => (!list ? <SkPage header={false} /> : business ? <BusinessTraffic key={business.id} b={business} /> : <Empty>Add a project first: website traffic is shown for the selected project's website only.</Empty>)}</SeoShell>;
}
