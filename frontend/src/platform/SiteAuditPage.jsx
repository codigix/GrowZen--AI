import React, { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ChevronRight, ScanSearch, FileBarChart, Braces, Loader2 } from 'lucide-react';
import { SeoShell, Card } from './SeoUi';
import { useSiteAudit, AuditStep, ReportStep } from './WebsiteAuditTool';
import SchemaStudio from './SchemaStudio';

const STEPS = [
  { id: 'audit', label: 'Audit website', hint: 'Scan it live', icon: ScanSearch },
  { id: 'report', label: 'Report', hint: 'Scores, fixes & Lighthouse', icon: FileBarChart },
  { id: 'schema', label: 'Schema', hint: 'Structured data', icon: Braces }
];
const OLD_TABS = { site: 'report', business: 'report', check: 'audit', lighthouse: 'report' };

function Stepper({ step, onStep, hasReport, running }) {
  const at = STEPS.findIndex(s => s.id === step);
  return (
    <nav aria-label="Audit steps" className="ai-glass-card rounded p-1 flex flex-wrap items-center gap-0.5 w-fit max-w-full">
      {STEPS.map((s, i) => {
        const locked = s.id === 'report' && !hasReport;
        const done = (s.id === 'audit' && hasReport) || (i < at && !locked);
        const active = s.id === step;
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <ChevronRight size={14} className="text-slate-300 shrink-0" aria-hidden="true" />}
            <button type="button" disabled={locked} onClick={() => onStep(s.id)} aria-current={active ? 'step' : undefined}
              title={locked ? 'Run an audit first' : s.hint}
              className={`h-9 pl-1.5 pr-3.5 rounded flex items-center gap-2 text-left whitespace-nowrap transition-colors ${active ? 'bg-indigo-500 text-white' : locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-11 font-bold shrink-0 ${active ? 'bg-white/20 text-white' : done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                {done && !active ? <Check size={13} /> : i + 1}
              </span>
              <span className={`text-13 font-semibold ${active ? 'text-white' : 'text-slate-700'}`}>{s.label}{s.id === 'audit' && running ? '…' : ''}</span>
              <span className={`hidden lg:inline text-11.5 ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{s.id === 'audit' && running ? 'Scanning now' : s.hint}</span>
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function SiteAudit({ b, step, setStep }) {
  const sa = useSiteAudit(b);
  // When a scan finishes, move on to its report.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !sa.running && sa.audit.data?.status === 'done') setStep('report');
    wasRunning.current = sa.running;
  }, [sa.running]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opens on the latest report when there is one; while it loads, a short wait instead of a flash of step 1.
  const loading = !sa.history.data || (sa.current && !sa.audit.data);
  const current = step === 'report' && !sa.report ? (loading ? 'loading' : 'audit') : step;
  return (
    <div className="space-y-5">
      <Stepper step={current === 'loading' ? 'report' : current} onStep={setStep} hasReport={Boolean(sa.report)} running={sa.running} />
      {current === 'loading' && <Card><div className="py-12 flex items-center justify-center gap-2 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Opening the latest report…</div></Card>}
      {current === 'audit' && <AuditStep sa={sa} business={b} onOpenReport={() => setStep('report')} />}
      {current === 'report' && <ReportStep sa={sa} business={b} onNext={setStep} />}
      {current === 'schema' && <SchemaStudio b={b} report={sa.report} />}
    </div>
  );
}

/**
 * Website & On-Page SEO as one flow: 1 audit the website (live scan) → 2 report with ranked fixes and
 * the full Lighthouse report → 3 schema. The step lives in ?tab= so links can open one directly.
 */
export default function SiteAuditPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const step = STEPS.some(s => s.id === raw) ? raw : OLD_TABS[raw] || 'report'; // the latest report; step 1 when there isn't one
  const setStep = (t) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  return (
    <SeoShell title="Website & On-Page SEO" subtitle="Audit the website, read the report, then fix and re-check: page by page, with ready-made fixes.">
      {(b) => <SiteAudit key={b.id} b={b} step={step} setStep={setStep} />}
    </SeoShell>
  );
}
