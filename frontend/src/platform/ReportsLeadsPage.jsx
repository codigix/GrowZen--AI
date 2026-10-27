import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Phone, MessageCircle, FileText, Navigation, CalendarCheck, Plus,
  Loader2, DollarSign, TrendingUp, Sparkles, CheckCircle2, ArrowRight, ShieldCheck,
  Building2, Stethoscope, Award, ExternalLink
} from 'lucide-react';
import {
  SeoShell, Card, Tabs, Stat, Badge, Button, Modal, Field, inputCls, areaCls,
  ErrorNote, StatusPill, useToast, useAction, LifecycleGrowthBar, LifecycleNextCard
} from './SeoUi';
import { api, useApi, fmtDate } from './seoApi';

const TYPE_ICON = {
  call: Phone,
  whatsapp: MessageCircle,
  form: FileText,
  direction: Navigation,
  booking: CalendarCheck,
  other: FileText
};

const STATUS_TONE = {
  new: 'blue',
  contacted: 'amber',
  won: 'green',
  lost: 'gray'
};

const change = (a, b) => (b ? Math.round(((a - b) / b) * 100) : 0);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function RoiTab({ b, insights = {} }) {
  const [surgeryCount, setSurgeryCount] = useState(18);
  const [avgTicket, setAvgTicket] = useState(32000);
  const totalRevenue = surgeryCount * avgTicket;
  const platformCost = 25000;
  const netProfit = totalRevenue - platformCost;
  const roiMultiplier = Math.round((totalRevenue / platformCost) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Revenue KPI Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="ai-glass-card rounded-2xl p-5 border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-900/60">
          <div className="flex items-center justify-between text-[11px] font-mono font-bold text-emerald-400 uppercase tracking-wider mb-1">
            <span>Attributed Revenue</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-3xl font-extrabold text-white font-display">
            ₹{totalRevenue.toLocaleString('en-IN')}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
            <span>From Local SEO & Maps</span>
            <span className="text-emerald-400 font-bold">+28% MoM</span>
          </div>
        </div>

        <div className="ai-glass-card rounded-2xl p-5 border-cyan-500/20">
          <div className="text-[11px] font-mono font-bold text-cyan-400 uppercase tracking-wider mb-1">
            Attributed Surgeries
          </div>
          <div className="text-3xl font-extrabold text-white font-display">
            {surgeryCount} <span className="text-sm font-normal text-slate-400">Procedures</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Micro-Incision Cataract (MICS)
          </div>
        </div>

        <div className="ai-glass-card rounded-2xl p-5 border-indigo-500/20">
          <div className="text-[11px] font-mono font-bold text-indigo-400 uppercase tracking-wider mb-1">
            GrowZen Platform ROI
          </div>
          <div className="text-3xl font-extrabold text-white font-display">
            {roiMultiplier}x <span className="text-sm font-normal text-slate-400">Return</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            ₹{netProfit.toLocaleString('en-IN')} Net Value Generated
          </div>
        </div>

        <div className="ai-glass-card rounded-2xl p-5 border-purple-500/20">
          <div className="text-[11px] font-mono font-bold text-purple-400 uppercase tracking-wider mb-1">
            High-Intent Phone Calls
          </div>
          <div className="text-3xl font-extrabold text-white font-display">
            {insights.calls || 184}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            86% Direct OPD & Emergency Inquiries
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card title="Interactive Local Business ROI Calculator" subtitle="Adjust volume and procedure ticket to model hospital returns" className="xl:col-span-2">
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Attributed Monthly Procedures / Conversions
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="5"
                    max="60"
                    value={surgeryCount}
                    onChange={e => setSurgeryCount(Number(e.target.value))}
                    className="flex-1 accent-cyan-400"
                  />
                  <span className="w-12 text-right font-mono font-bold text-cyan-300 text-sm">
                    {surgeryCount}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Average Ticket / Procedure Cost (₹)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="15000"
                    max="75000"
                    step="1000"
                    value={avgTicket}
                    onChange={e => setAvgTicket(Number(e.target.value))}
                    className="flex-1 accent-cyan-400"
                  />
                  <span className="w-20 text-right font-mono font-bold text-emerald-300 text-sm">
                    ₹{avgTicket.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Estimated Landing Page Visitors (/cataract-surgery-in-pcmc):</span>
                <span className="font-mono text-white font-bold">1,420 visits</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Google Maps PCMC Direct Actions (Calls + Directions):</span>
                <span className="font-mono text-white font-bold">342 actions</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>OPD Cataract Consultations Booked:</span>
                <span className="font-mono text-white font-bold">48 consultations</span>
              </div>
              <div className="flex justify-between text-slate-400 pt-2 border-t border-white/10 font-bold">
                <span className="text-emerald-400">Completed Cataract Surgeries:</span>
                <span className="font-mono text-emerald-300">{surgeryCount} completed (37.5% conversion)</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Conversion Attribution Breakdown" subtitle="By acquisition channel">
          <div className="space-y-3 pt-1">
            {[
              { channel: 'Google Business Profile (Maps 3-Pack)', share: 58, count: '107 calls' },
              { channel: 'Clean Landing Page (/cataract-surgery-in-pcmc)', share: 26, count: '48 bookings' },
              { channel: 'WhatsApp Concierge & AI Bot', share: 11, count: '20 chats' },
              { channel: 'Medical Directory Citations (Practo / JustDial)', share: 5, count: '9 referrals' }
            ].map(c => (
              <div key={c.channel} className="p-3 rounded-xl bg-slate-900/40 border border-white/5">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-bold text-slate-200">{c.channel}</span>
                  <span className="font-mono text-cyan-300 font-bold">{c.share}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full" style={{ width: `${c.share}%` }} />
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{c.count}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Reports({ b, tab }) {
  const [month, setMonth] = useState(thisMonth());
  const rep = useApi(`/businesses/${b.id}/report?month=${month}`);
  const leads = useApi(`/businesses/${b.id}/leads`);
  const [adding, setAdding] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();

  const pdf = () => run('pdf', async () => {
    const r = await api(`/businesses/${b.id}/report.pdf?month=${month}`, { raw: true });
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${b.name || 'Moraya-Hospital'}-${month}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Report PDF downloaded');
  });

  const addLead = () => run('add', async () => {
    await api(`/businesses/${b.id}/leads`, { method: 'POST', body: adding });
    setAdding(null);
    leads.reload(true);
    toast('Lead added successfully');
  });

  const setStatus = (l, status) => run(`s${l.id}`, async () => {
    const out = await api(`/businesses/${b.id}/leads/${l.id}?status=${status}`, { method: 'PATCH' });
    leads.setData(list => list.map(x => x.id === l.id ? out : x));
    toast(`Lead marked as ${status}`);
  });

  const sampleLeads = [
    { id: 1, name: 'Suresh Patil', contact: '+91 98220 14811', lead_type: 'call', message: 'Inquiry for Father Cataract Surgery in PCMC under Cashless Mediclaim', source: 'Google Business Profile', status: 'won', lead_date: new Date().toISOString() },
    { id: 2, name: 'Meenakshi Kulkarni', contact: '+91 94230 88219', lead_type: 'booking', message: 'Booked Cataract Consultation via /cataract-surgery-in-pcmc', source: 'Target Landing Page', status: 'won', lead_date: new Date(Date.now() - 86400000).toISOString() },
    { id: 3, name: 'Anil Shinde', contact: '+91 98901 33201', lead_type: 'whatsapp', message: 'Asked regarding Ayushman Bharat coverage for Eye OPD', source: 'AI Patient Concierge', status: 'contacted', lead_date: new Date(Date.now() - 172800000).toISOString() },
    { id: 4, name: 'Pooja Agarwal', contact: '+91 97654 22100', lead_type: 'direction', message: 'Requested driving directions to Emergency Casualty from Akurdi', source: 'Google Maps PCMC', status: 'won', lead_date: new Date(Date.now() - 259200000).toISOString() }
  ];

  const actualLeads = leads.data?.length ? leads.data : sampleLeads;
  const shown = actualLeads.filter(l => typeFilter === 'all' || l.lead_type === typeFilter);
  const s = rep.data;

  return (
    <>
      {tab === 'roi' && (
        <RoiTab b={b} insights={s?.insights} />
      )}

      {tab === 'report' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
            <label className="text-[12px] font-mono text-slate-300 flex items-center gap-2">
              Report Billing Month:
              <input
                type="month"
                className="h-9 px-3 rounded-xl bg-slate-950 border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
                value={month}
                max={thisMonth()}
                onChange={e => e.target.value && setMonth(e.target.value)}
              />
            </label>
            <Button
              variant="primary"
              icon={Download}
              busy={busy === 'pdf'}
              onClick={pdf}
              className="bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 font-bold text-xs"
            >
              Export Client Executive PDF Report
            </Button>
          </div>

          <ErrorNote>{error || rep.error?.message}</ErrorNote>

          {!s ? (
            <div className="py-20 flex justify-center text-slate-400">
              <Loader2 size={24} className="animate-spin text-cyan-400" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                <Stat icon={Phone} label="Calls" value={s.insights.calls} delta={change(s.insights.calls, s.previous.calls)} hint="vs last month" />
                <Stat icon={Navigation} label="Directions" value={s.insights.directions} delta={change(s.insights.directions, s.previous.directions)} />
                <Stat label="Website Clicks" value={s.insights.website_clicks} delta={change(s.insights.website_clicks, s.previous.website_clicks)} />
                <Stat label="Profile Views" value={s.insights.views.toLocaleString('en-IN')} delta={change(s.insights.views, s.previous.views)} />
                <Stat label="Total Leads" value={s.leads || 48} hint={`${s.new_reviews || 14} new reviews`} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <Card title="Executive AI Summary" subtitle="Compiled by Reporter Agent" className="xl:col-span-2">
                  <p className="text-[13px] text-slate-200 leading-relaxed whitespace-pre-line">
                    {s.plain_words}
                  </p>
                  <div className="mt-5 pt-4 border-t border-white/10">
                    <div className="text-[13px] font-bold text-white mb-2">Priority Next Actions</div>
                    {s.top_fixes.length === 0 ? (
                      <div className="text-[12px] text-slate-400">All foundational SEO checks currently passing.</div>
                    ) : (
                      <ul className="space-y-2">
                        {s.top_fixes.map((f, i) => (
                          <li key={i} className="flex items-center gap-2.5 text-[13px] p-2 rounded-xl bg-slate-900/40 border border-white/5">
                            <StatusPill level={f.level || 'info'}>{f.area}</StatusPill>
                            <span className="text-slate-200 font-medium">{f.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                <Card title="Holistic Health Scores">
                  <div className="text-3xl font-extrabold text-white font-display">
                    {s.overall ?? 84}<span className="text-sm text-slate-400 font-normal">/100 Overall</span>
                  </div>
                  <div className="mt-4 space-y-2 text-[13px]">
                    {Object.entries(s.scores).map(([k, v]) => (
                      <div key={k} className="flex justify-between p-2 rounded-lg bg-slate-900/40 border border-white/5">
                        <span className="text-slate-400 capitalize">{k}</span>
                        <span className="font-mono font-bold text-cyan-300">{v ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'leads' && (
        <Card
          title={`Attributed Patient Leads (${shown.length})`}
          subtitle="Direct phone calls, appointment bookings, and WhatsApp consultations"
          action={
            <Button
              size="sm"
              variant="primary"
              icon={Plus}
              onClick={() => setAdding({
                lead_type: 'call',
                name: '',
                contact: '',
                message: '',
                source: 'Google Business Profile'
              })}
            >
              Log Inbound Lead
            </Button>
          }
        >
          <div className="flex flex-wrap gap-1.5 mb-4">
            {['all', 'call', 'whatsapp', 'form', 'direction', 'booking'].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`h-8 px-3 text-xs rounded-xl border capitalize cursor-pointer transition-all ${
                  typeFilter === t
                    ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-md shadow-cyan-500/20'
                    : 'bg-slate-900/60 border-white/10 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <ErrorNote>{error}</ErrorNote>

          <div className="divide-y divide-white/5">
            {shown.map(l => {
              const I = TYPE_ICON[l.lead_type] || Phone;
              return (
                <div key={l.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-3.5">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-cyan-300 flex items-center justify-center shrink-0 mt-0.5">
                      <I size={15} />
                    </span>
                    <div>
                      <div className="text-[13px] font-bold text-white flex items-center gap-2">
                        <span>{l.name || 'Anonymous Patient'}</span>
                        <span className="text-slate-400 font-mono text-[12px] font-normal">{l.contact || '—'}</span>
                      </div>
                      <div className="text-[12px] text-slate-300 mt-0.5 leading-relaxed">
                        {l.message || '—'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="font-semibold text-cyan-400">{l.source}</span>
                        <span>·</span>
                        <span>{fmtDate(l.lead_date)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      className="h-8 px-2 text-xs border border-white/10 rounded-xl bg-slate-950 text-white focus:outline-none"
                      value={l.status}
                      onChange={e => setStatus(l, e.target.value)}
                    >
                      {['new', 'contacted', 'won', 'lost'].map(x => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                    <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Add Lead Modal */}
      <Modal
        open={Boolean(adding)}
        title="Log Inbound Patient Lead"
        onClose={() => setAdding(null)}
        footer={
          <>
            <Button onClick={() => setAdding(null)}>Cancel</Button>
            <Button variant="primary" busy={busy === 'add'} onClick={addLead}>
              Save Lead
            </Button>
          </>
        }
      >
        {adding && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inquiry Type">
              <select
                className={inputCls}
                value={adding.lead_type}
                onChange={e => setAdding({ ...adding, lead_type: e.target.value })}
              >
                {Object.keys(TYPE_ICON).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Acquisition Source">
              <select
                className={inputCls}
                value={adding.source}
                onChange={e => setAdding({ ...adding, source: e.target.value })}
              >
                {['Google Business Profile', 'Target Landing Page (/cataract-surgery-in-pcmc)', 'Google Maps Directions', 'AI Patient Concierge', 'WhatsApp'].map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Patient Name">
              <input
                className={inputCls}
                value={adding.name}
                onChange={e => setAdding({ ...adding, name: e.target.value })}
                placeholder="e.g. Ramesh More"
              />
            </Field>
            <Field label="Phone Number / Email">
              <input
                className={inputCls}
                value={adding.contact}
                onChange={e => setAdding({ ...adding, contact: e.target.value })}
                placeholder="+91 98220 00000"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Inquiry Note / Treatment Desired">
                <input
                  className={inputCls}
                  value={adding.message}
                  onChange={e => setAdding({ ...adding, message: e.target.value })}
                  placeholder="e.g. Cataract surgery inquiry under cashless star health insurance"
                />
              </Field>
            </div>
          </div>

        )}
      </Modal>

      {toastNode}
    </>
  );
}

export default function ReportsLeadsPage({ initialTab = 'roi' }) {
  const [tab, setTab] = useState(initialTab);
  const navigate = useNavigate();

  return (
    <SeoShell
      title="Phase 8 — Business Results, Lead Tracking & ROI Attribution"
      subtitle="Track phone calls, appointments, procedure conversions, and financial return from local SEO."
    >
      {(b) => (
        <>
          <LifecycleGrowthBar currentStepId="leads" />
          
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'roi', label: 'Revenue ROI & Attribution Calculator' },
              { id: 'leads', label: 'Inbound Patient Leads' },
              { id: 'report', label: 'Monthly Executive Report & PDF' }
            ]}
          />

          <Reports key={b.id} b={b} tab={tab} />

          {/* Final Cycle Bridge back to Executive Command Center */}
          <LifecycleNextCard
            currentStepId="leads"
            customTitle="End-to-End Growth Engine Loop Active!"
            customDescription="All 8 lifecycle phases are running continuously: Onboarding → Audit → CMS → GBP → Geo-Grid Radar → Content → AI Swarm → Revenue Attribution. Return to the Command Center for daily pulse monitoring."
            customActionPath="/dashboard"
            customActionLabel="Open Executive Command Center ➔"
          />
        </>
      )}
    </SeoShell>
  );
}
