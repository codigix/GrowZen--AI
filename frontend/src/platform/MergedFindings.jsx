import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Info, Wrench, XCircle } from 'lucide-react';
import { useApi } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const SEV = { critical: 'bg-red-50 text-red-700', serious: 'bg-orange-50 text-orange-700', warning: 'bg-amber-50 text-amber-700', info: 'bg-slate-100 text-slate-700' };
const ST = {
  fail: ['Needs fixing', 'bg-red-50 text-red-700', XCircle], warn: ['Check', 'bg-amber-50 text-amber-800', AlertTriangle], ok: ['Fine', 'bg-emerald-50 text-emerald-700', CheckCircle2]
};
const Chip = ({ children, cls }) => <span className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium whitespace-nowrap ${cls}`}>{children}</span>;

/**
 * The site audit and Page X-Ray, merged by topic: each problem is listed once, with what each tool found, and a note where they disagree and why.
 * Nothing is re-run: it reads what both tools last saved.
 */
export default function MergedFindings({ bid }) {
  const q = useApi(`/businesses/${bid}/flow/website-health`);
  const [open, setOpen] = useState(null);
  const [all, setAll] = useState(false);
  const d = q.data;
  if (!d) return <div className="h-24 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" />;
  const topics = arr(d.topics);
  if (!topics.length) return null;
  const shown = all ? topics : topics.filter(t => t.status !== 'ok');
  const s = d.summary || {};
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-label="Findings from both tools, merged">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-15 font-semibold text-slate-900">What needs attention, from both tools</h2>
          <p className="text-12.5 text-slate-500">{s.need_attention} of {s.topics} topics need attention. Each problem is listed once, even when the audit and Page X-Ray both found it ({s.raw_audit_issues} audit findings and {s.raw_xray_failed} failed page checks were merged).{s.differs ? ` ${s.differs} place${s.differs === 1 ? '' : 's'} where the two disagree are explained.` : ''}</p>
        </div>
        <button type="button" onClick={() => setAll(a => !a)} className="text-13 font-semibold text-indigo-600 hover:underline cursor-pointer">{all ? 'Show only what needs attention' : `Show all ${s.topics} topics`}</button>
      </div>
      {!d.xray?.has && <p className="mt-3 text-12.5 text-slate-600 bg-slate-50 rounded-lg px-3 py-2">Page X-Ray has not checked your homepage yet, so only the audit's findings are shown. Press Check website to add the page-level checks.</p>}
      {!d.audit?.has && <p className="mt-3 text-12.5 text-slate-600 bg-slate-50 rounded-lg px-3 py-2">No site audit yet, so only Page X-Ray's findings are shown. Press Check website to add the whole-site checks.</p>}
      <ul className="mt-3 divide-y divide-slate-100">
        {shown.map(t => {
          const [label, cls, Icon] = ST[t.status] || ST.ok;
          const on = open === t.key;
          return (
            <li key={t.key}>
              <button type="button" onClick={() => setOpen(on ? null : t.key)} aria-expanded={on} className="w-full flex items-center gap-3 py-3 text-left cursor-pointer">
                <Chip cls={cls}><Icon size={12} />{label}</Chip>
                <span className="flex-1 min-w-0"><span className="block text-14 font-medium text-slate-900">{t.label}</span>
                  <span className="block text-12 text-slate-500 truncate">{[t.site.length ? `Whole site: ${t.site.map(x => `${x.title}${x.count > 1 ? ` (${x.count})` : ''}`).join('; ')}` : '', t.page.some(p => !p.passed) ? `Homepage: ${t.page.filter(p => !p.passed).map(p => p.label).join('; ')}` : ''].filter(Boolean).join('  ·  ') || 'No problem found by either tool.'}</span></span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${on ? 'rotate-180' : ''}`} />
              </button>
              {on && (
                <div className="pb-4 pl-2 sm:pl-[88px] space-y-3 text-13">
                  {arr(t.notes).map((n, i) => <p key={i} className="flex gap-2 rounded-lg bg-violet-50 text-violet-900 px-3 py-2"><Info size={14} className="mt-0.5 shrink-0" />{n.text}</p>)}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Website audit · whole site</div>
                      {t.site.length === 0 ? <p className="text-slate-500">{d.audit?.has ? 'No problem found on the crawled pages.' : 'Not checked.'}</p> : <ul className="space-y-2">{t.site.map((x, i) => <li key={i}><div className="flex flex-wrap items-center gap-2"><Chip cls={SEV[x.level] || SEV.warning}>{x.level}</Chip><span className="font-medium text-slate-800">{x.title}</span>{x.count > 1 && <span className="text-12 text-slate-500">{x.count} places</span>}</div>
                        {x.fix && <p className="text-slate-600 mt-0.5">Fix: {x.fix}</p>}{x.differs && <p className="text-12 text-violet-800 mt-0.5">{x.differs}</p>}</li>)}</ul>}</div>
                    <div><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Page X-Ray · homepage</div>
                      {t.page.length === 0 ? <p className="text-slate-500">{d.xray?.has ? 'Not part of the page checks.' : 'Not checked.'}</p> : <ul className="space-y-2">{t.page.map(p => (
                        <li key={p.key} className="flex gap-2"><span className={`mt-0.5 shrink-0 ${p.passed ? 'text-emerald-600' : 'text-red-500'}`}>{p.passed ? <Check size={14} /> : <XCircle size={14} />}</span>
                          <div className="min-w-0"><div className={p.passed ? 'text-slate-500' : 'font-medium text-slate-800'}>{p.label}</div>{!p.passed && p.detail && <div className="text-slate-500">{p.detail}</div>}{!p.passed && p.fix && <div className="text-slate-600">Fix: {p.fix}</div>}
                            {!p.passed && p.task_id && <Link to={`/growth/fix/${p.task_id}`} className="inline-flex items-center gap-1 text-12.5 font-semibold text-indigo-600 hover:underline"><Wrench size={12} />Exact fix</Link>}</div></li>))}</ul>}</div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="mt-3 text-13 text-emerald-700 flex items-center gap-2"><CheckCircle2 size={15} />Nothing needs attention in either tool.</p>}
    </section>
  );
}
