import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Phone, Navigation, MousePointerClick, Users, Star, Grid3x3, Bot, ArrowRight, Sparkles, CheckCircle2, Plug, Play, Loader2 } from 'lucide-react';
import { SeoShell, Card, Stat, ScoreRing, Meter, StatusPill, Button, ChartTooltip, Legend, SourceTag, ErrorNote, BackendDown, SERIES, INK, scoreWord, useModulePath, useToast, useAction } from './SeoUi';
import { api, useApi, fmtDateTime } from './seoApi';

const pctChange = (a, b) => (b ? Math.round(((a - b) / b) * 100) : 0);
const AREA_LABEL = { gbp: 'Google profile', rankings: 'Rankings', technical: 'Technical SEO', onpage: 'On-page SEO', backlinks: 'Backlinks', citations: 'Citations' };

function Overview({ b }) {
  const navigate = useNavigate();
  const path = useModulePath();
  const [toast, toastNode] = useToast();
  const ov = useApi(`/businesses/${b.id}/overview`);
  const geo = useApi(`/businesses/${b.id}/geo`);
  const scans = useApi(`/businesses/${b.id}/rank-scans`);
  const [busy, error, run] = useAction();

  if (ov.error) return <BackendDown error={ov.error} onRetry={() => ov.reload()} />;
  if (!ov.data) return <div className="py-16 flex justify-center text-gray-400"><Loader2 size={16} className="animate-spin" /></div>;
  const d = ov.data;
  const cur = d.insights.last_30; const prev = d.insights.previous_30;
  const lastScan = scans.data?.[0];
  const sov = geo.data?.share_of_voice;

  const auditAll = () => run('audit', async () => {
    await api(`/businesses/${b.id}/audits`, { method: 'POST', body: {} });
    toast('Full audit started: GBP, rankings, technical, on-page, backlinks, citations');
    setTimeout(() => ov.reload(true), 4000);
  });
  const decide = (task, approve) => run(`t${task.id}`, async () => {
    await api(`/tasks/${task.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
    toast(approve ? 'Approved: the agent applies it' : 'Rejected');
    ov.reload(true);
  });

  return (
    <>
      {b.verification === 'unverified' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 bg-white border border-amber-200 rounded p-3">
          <StatusPill level="critical">Not verified</StatusPill>
          <span className="text-[13px] text-gray-700 flex-1">The Google profile is not verified, so it won't show in the Map Pack until it is.</span>
        </div>
      )}
      {!b.gbp_location && (
        <div className="mb-4 flex flex-wrap items-center gap-3 bg-white border border-blue-200 rounded p-3">
          <Plug size={16} className="text-blue-600" />
          <span className="text-[13px] text-gray-700 flex-1">Not linked to a Google Business Profile yet: connect the owner's Google account to pull reviews, insights and post updates.</span>
          <Button variant="primary" icon={Plug} onClick={() => navigate(`${path('gmb-profile')}?connect=1`)}>Connect Google</Button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Profile health" subtitle="How Google sees this Business Profile">
          <div className="flex items-center gap-5">
            <ScoreRing score={d.profile.score} label={scoreWord(d.profile.score)} />
            <div className="flex-1 space-y-2.5">
              {[['Relevance', d.profile.factors.relevance], ['Distance', d.profile.factors.distance], ['Prominence', d.profile.factors.prominence]].map(([n, v], i) => (
                <div key={n}><div className="flex justify-between text-[12px] mb-1"><span className="text-gray-600">{n}</span><span className="font-medium text-gray-900">{v}</span></div><Meter value={v} color={SERIES[i]} /></div>
              ))}
            </div>
          </div>
          {d.profile.alerts.map(a => <div key={a.text} className="mt-3"><StatusPill level={a.level}>{a.level === 'critical' ? 'Critical' : 'Warning'}</StatusPill> <span className="text-[12px] text-gray-700">{a.text}</span></div>)}
        </Card>

        <Card title="Fix these first" subtitle="Biggest gains for the least work" className="xl:col-span-2"
          action={<Button size="sm" variant="ghost" onClick={() => navigate(path('gmb-profile'))}>Full checklist <ArrowRight size={12} /></Button>}>
          {d.profile.top_fixes.length === 0 ? <div className="text-[13px] text-gray-600 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /> The profile checklist is complete.</div> : (
            <ol className="space-y-2.5">
              {d.profile.top_fixes.map((f, i) => (
                <li key={f.key} className="flex gap-3 p-3 rounded border border-gray-100 bg-gray-50/60">
                  <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[12px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0"><div className="text-[13px] font-medium text-gray-900">{f.label}</div><div className="text-[12px] text-gray-600 mt-0.5">{f.fix}</div></div>
                  <span className="text-[11px] text-gray-500 shrink-0 self-center">+{Math.round(f.weight * (1 - f.score))} pts</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Audit by area" subtitle={d.overall != null ? `Overall ${d.overall}/100` : 'Not audited yet'} className="mb-4"
        action={<Button variant="primary" icon={Play} busy={busy === 'audit'} onClick={auditAll}>Run full audit</Button>}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Object.keys(AREA_LABEL).map((k, i) => {
            const a = d.areas[k];
            return (
              <div key={k} className="p-3 rounded border border-gray-200">
                <div className="text-[12px] text-gray-500 flex items-center justify-between gap-1">{AREA_LABEL[k]} {a && <SourceTag source={a.data_source} />}</div>
                <div className="text-xl font-semibold text-gray-900 mt-1">{a?.score ?? '—'}</div>
                {a && <div className="mt-1"><Meter value={a.score || 0} color={SERIES[i % 5]} /></div>}
                {d.failed?.[k] ? <div className="text-[11px] text-red-600 mt-1 line-clamp-2" title={d.failed[k]}>Last run failed: {d.failed[k]}</div> : <div className="text-[11px] text-gray-400 mt-1">{a ? fmtDateTime(a.finished_at) : 'not run'}</div>}
              </div>
            );
          })}
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat icon={Phone} label="Calls (30 days)" value={cur.calls} delta={pctChange(cur.calls, prev.calls)} hint="vs previous 30" />
        <Stat icon={Navigation} label="Direction requests" value={cur.directions} delta={pctChange(cur.directions, prev.directions)} hint="vs previous 30" />
        <Stat icon={MousePointerClick} label="Website clicks" value={cur.website_clicks} delta={pctChange(cur.website_clicks, prev.website_clicks)} hint="vs previous 30" />
        <Stat icon={Users} label="Leads (30 days)" value={d.leads_30} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title="Actions from Google" subtitle="Calls, direction requests and website clicks per day" className="xl:col-span-2"
          action={<Legend items={[['Calls', SERIES[0]], ['Directions', SERIES[1]], ['Website clicks', SERIES[2]]]} />}>
          {d.daily.length === 0 ? <div className="py-16 text-center text-[13px] text-gray-500">No insights yet: they sync daily once the Google profile is connected.</div> : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={{ stroke: INK.axis }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="calls" name="Calls" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="directions" name="Directions" stroke={SERIES[1]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="website_clicks" name="Website clicks" stroke={SERIES[2]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <div className="grid grid-cols-1 gap-3">
          <button onClick={() => navigate(path('rank-tracking'))} className="text-left bg-white border border-gray-200 rounded p-3.5 hover:border-gray-300 cursor-pointer">
            <div className="flex items-center gap-1.5 text-[12px] text-gray-500"><Grid3x3 size={13} /> Average map rank {lastScan && <SourceTag source={lastScan.data_source} />}</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{lastScan?.avg_rank ?? '—'}</div>
            <div className="text-[12px] text-gray-500">{lastScan ? `“${lastScan.keyword}” · top 3 at ${lastScan.top3}/${lastScan.grid_size ** 2} points` : 'No scan yet'}</div>
          </button>
          <button onClick={() => navigate(path('geo-optimization'))} className="text-left bg-white border border-gray-200 rounded p-3.5 hover:border-gray-300 cursor-pointer">
            <div className="flex items-center gap-1.5 text-[12px] text-gray-500"><Bot size={13} /> AI share of voice {sov?.data_source && <SourceTag source={sov.data_source} />}</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{sov?.data_source ? `${sov.overall}%` : '—'}</div>
            <div className="text-[12px] text-gray-500">{sov?.data_source ? 'of customer questions name you in AI answers' : 'Not run yet'}</div>
          </button>
          <button onClick={() => navigate(path('reviews'))} className="text-left bg-white border border-gray-200 rounded p-3.5 hover:border-gray-300 cursor-pointer">
            <div className="flex items-center gap-1.5 text-[12px] text-gray-500"><Star size={13} /> Reviews</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{b.rating ?? '—'} <span className="text-sm font-normal text-gray-500">· {b.reviewCount} reviews</span></div>
          </button>
        </div>
      </div>

      <Card title="Waiting for your approval" subtitle="Nothing goes live without approval (unless autopilot is on for that kind)"
        action={<Button size="sm" variant="ghost" onClick={() => navigate(path('automation'))}>Open approval queue <ArrowRight size={12} /></Button>}>
        {d.pending_tasks.length === 0 ? <div className="text-[13px] text-gray-500 py-3">Nothing waiting.</div> : (
          <div className="divide-y divide-gray-100">
            {d.pending_tasks.map(t => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-7 h-7 rounded bg-violet-50 text-violet-700 flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
                <div className="flex-1 min-w-[220px]"><div className="text-[13px] font-medium text-gray-900">{t.title}</div><div className="text-[12px] text-gray-500">{t.agent} agent · {t.kind.replace('_', ' ')}</div></div>
                <StatusPill level={t.impact === 'High' ? 'good' : 'info'}>{t.impact} impact</StatusPill>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="primary" busy={busy === `t${t.id}`} onClick={() => decide(t, true)}>Approve</Button>
                  <Button size="sm" disabled={busy === `t${t.id}`} onClick={() => decide(t, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {toastNode}
    </>
  );
}

export default function SeoOverviewPage() {
  return (
    <SeoShell title="Overview" subtitle="Your whole online presence in one place: Google profile, reviews, rankings and AI answers">
      {(b) => <Overview key={b.id} b={b} />}
    </SeoShell>
  );
}
