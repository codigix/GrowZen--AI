import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Download, Mail, Sparkles, Printer, Phone, Navigation, MousePointerClick, Eye, Star, TrendingUp, TrendingDown, Minus, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, Button, Modal, Field, ErrorNote, inputCls, useAction, SkList } from './SeoUi';
import { api, useApi } from './seoApi';
import { SectionHead } from './GbpWorkspace';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthName = (m) => { const [y, mo] = String(m).split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
const short = (m) => { const [y, mo] = String(m).split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short' }); };
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function Kpi({ icon: Icon, label, value, prev }) {
  const d = pct(value, prev);
  const Arrow = d > 0 ? TrendingUp : d < 0 ? TrendingDown : Minus;
  return (
    <div className="ai-glass-card rounded p-3.5">
      <div className="flex items-center gap-2 text-11.5 font-semibold text-slate-400"><span className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center"><Icon size={15} /></span>{label}</div>
      <div className="text-24 font-bold text-slate-900 tabular-nums leading-tight mt-1.5">{fmt(value)}</div>
      <div className={`text-12 mt-0.5 inline-flex items-center gap-1 ${d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-slate-400'}`}><Arrow size={12} />{d > 0 ? '+' : ''}{d}% <span className="text-slate-400">vs last month ({fmt(prev)})</span></div>
    </div>
  );
}

function EmailModal({ b, open, onClose, month, recipient, onDone, toast }) {
  const [to, setTo] = useState(recipient || '');
  const [busy, error, run] = useAction();
  const send = () => run('send', async () => { const r = await api(`/businesses/${b.id}/gbp/reports/send`, { method: 'POST', body: { month, to: to.trim() || null } }); toast(`Report sent to ${r.to}`); onDone(); onClose(); });
  return (
    <Modal open={open} onClose={onClose} width="max-w-md" title="Email this report"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Mail} busy={busy === 'send'} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())} onClick={send}>Send PDF</Button></>}>
      <p className="text-13 text-slate-600 mb-3">The {monthName(month)} report for {b.name} is sent as a PDF, with the summary in the email.</p>
      <Field label="Send to"><input type="email" className={inputCls} value={to} onChange={e => setTo(e.target.value)} placeholder="client@example.com" autoFocus /></Field>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  );
}

/** Reports for the Google profile: the month against the one before, six months of trend, the summary in plain words, and PDF / CSV / email. */
export default function GbpReportsSection({ b, toast }) {
  const [month, setMonth] = useState(thisMonth());
  const data = useApi(`/businesses/${b.id}/gbp/reports/overview?month=${month}`);
  const [busy, error, run] = useAction();
  const [mail, setMail] = useState(false);
  const [words, setWords] = useState(null); // the AI-written summary, once asked for
  const d = data.data;
  const s = d?.summary;
  const say = toast || (() => {});
  const file = (kind) => run(kind, async () => {
    const r = await api(`/businesses/${b.id}/report.${kind}?month=${month}`, { raw: true });
    const blob = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${b.name}-${month}.${kind}`; a.click(); URL.revokeObjectURL(a.href);
    say(kind === 'pdf' ? 'Report PDF downloaded' : 'Report downloaded: opens in Excel or Google Sheets');
  });
  const aiWords = () => run('ai', async () => { const r = await api(`/businesses/${b.id}/gbp/reports/summary?month=${month}`); setWords(r.plain_words); });
  const change = (m) => { setMonth(m); setWords(null); };
  const chart = (d?.trend || []).map(t => ({ ...t, name: short(t.month) }));
  const scores = s ? Object.entries(s.scores || {}).filter(([, v]) => v != null) : [];

  return (
    <div className="space-y-4 print:space-y-3">
      <SectionHead title="Reports" subtitle="This client's Google profile results, ready to download or send" sources={['google', 'calc']} />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-12 font-medium text-slate-500">Month
            <input type="month" className={`${inputCls} w-44 mt-1`} value={month} max={thisMonth()} onChange={e => e.target.value && change(e.target.value)} />
          </label>
          <div className="flex-1" />
          <Button variant="primary" icon={Download} busy={busy === 'pdf'} onClick={() => file('pdf')}>Download PDF</Button>
          <Button icon={Download} busy={busy === 'csv'} onClick={() => file('csv')}>Download Excel (CSV)</Button>
          <Button icon={Mail} disabled={d && !d.can_email} title={d && !d.can_email ? 'Email is not set up on the server (SMTP)' : ''} onClick={() => setMail(true)}>Email report</Button>
          <Button icon={Printer} onClick={() => window.print()}>Print</Button>
        </div>
        <ErrorNote>{error || data.error?.message}</ErrorNote>
      </Card>

      {!s ? <Card><SkList rows={5} /></Card> : (
        <>
          <div className="print:block text-16 font-semibold text-slate-900 hidden">{b.name} · {monthName(month)}</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Phone} label="Calls" value={s.insights.calls} prev={s.previous.calls} />
            <Kpi icon={Navigation} label="Directions" value={s.insights.directions} prev={s.previous.directions} />
            <Kpi icon={MousePointerClick} label="Website clicks" value={s.insights.website_clicks} prev={s.previous.website_clicks} />
            <Kpi icon={Eye} label="Profile views" value={s.insights.views} prev={s.previous.views} />
          </div>

          <Card title={`${monthName(month)} in plain words`} action={<Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'ai'} onClick={aiWords}>Rewrite with AI</Button>}>
            <p className="text-14 text-slate-700 leading-relaxed">{words || s.plain_words}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-12.5 text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Star size={13} className="text-amber-400" />{s.new_reviews} new review{s.new_reviews === 1 ? '' : 's'} this month</span>
              <span>Leads: <b className="text-slate-800">{s.leads}</b></span>
              {s.overall != null && <span>Overall score: <b className="text-slate-800">{s.overall}/100</b></span>}
            </div>
          </Card>

          <Card title="The last six months" subtitle="How customers found and contacted the profile, month by month">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="views" name="Profile views" fill="#a5b4fc" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="directions" name="Directions" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="calls" name="Calls" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="website_clicks" name="Website clicks" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {!d.linked && <p className="text-12 text-amber-700 mt-2">Not connected to Google, so there is no profile data yet.</p>}
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <Card title="Next steps" subtitle="The biggest fixes from the latest audits">
              {s.top_fixes.length === 0 ? <p className="text-13 text-emerald-700 flex items-center gap-2 py-2"><CheckCircle2 size={15} />Nothing urgent.</p> : (
                <ul className="divide-y divide-slate-100">{s.top_fixes.map((f, i) => <li key={i} className="py-2.5"><div className="text-13 font-medium text-slate-900">{f.title}</div>{f.fix && <div className="text-12 text-slate-500 mt-0.5">{f.fix}</div>}</li>)}</ul>
              )}
              <Link to="/gmb-profile/local-seo" className="inline-flex items-center gap-1 text-13 font-medium text-indigo-600 hover:underline mt-3">See the Local SEO plan <ArrowRight size={13} /></Link>
            </Card>
            <Card title="Audit scores">
              {scores.length === 0 ? <p className="text-13 text-slate-500 py-2">No audits yet.</p> : (
                <div className="space-y-2.5">{scores.map(([k, v]) => (
                  <div key={k}><div className="flex justify-between text-12.5 mb-1"><span className="capitalize text-slate-600">{k.replace(/_/g, ' ')}</span><span className="font-semibold tabular-nums text-slate-800">{v}/100</span></div><div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${v >= 75 ? 'bg-emerald-500' : v >= 45 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${v}%` }} /></div></div>
                ))}</div>
              )}
            </Card>
          </div>

          {s.keywords.length > 0 && (
            <Card title="Search positions" subtitle="Tracked searches and where they stand on Google">
              <table className="w-full text-13"><thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">Search</th><th className="p-2 text-left font-medium">Position</th><th className="p-2 text-left font-medium">Before</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{s.keywords.map(k => <tr key={k.keyword}><td className="p-2 text-slate-900">{k.keyword}</td><td className="p-2 tabular-nums">{k.rank ?? '—'}</td><td className="p-2 tabular-nums text-slate-500">{k.prev_rank ?? '—'}</td></tr>)}</tbody></table>
            </Card>
          )}

          <Card title="Reports sent" subtitle="Who received a report, and when">
            {d.history.length === 0 ? <p className="text-13 text-slate-500 py-2">Nothing sent yet. Use <b>Email report</b> above.</p> : (
              <ul className="divide-y divide-slate-100">{d.history.map((h, i) => <li key={i} className="py-2 flex flex-wrap items-center gap-x-3 text-13"><span className="text-slate-400 text-11.5 w-36 shrink-0">{new Date(h.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</span><span className="text-slate-800">{h.month ? monthName(h.month) : ''} report</span><span className="text-slate-500">to {h.to || '—'}</span></li>)}</ul>
            )}
          </Card>
        </>
      )}
      {mail && <EmailModal b={b} open={mail} onClose={() => setMail(false)} month={month} recipient={d?.recipient} onDone={() => data.reload(true)} toast={say} />}
    </div>
  );
}
