import React, { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, ExternalLink, Check, ScanSearch, FileBarChart, Braces, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { SeoShell, Card, Button, useToast } from './SeoUi';
import { useSiteAudit, AuditStep, ReportStep } from './WebsiteAuditTool';
import { pathOnly as pathOf } from './siteUtils';

const BUSINESS_TYPES = /LocalBusiness|Organization|Dentist|Clinic|Physician|Hospital|Restaurant|Store|Cafe|Hotel|Salon|Gym|Agency/i;

function SchemaStep({ b, report }) {
  const [toast, toastNode] = useToast();
  // Self-served review stars aren't eligible for rich results on LocalBusiness, so no aggregateRating.
  const json = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: b.name, url: b.website || undefined, telephone: b.phone || undefined,
    description: b.description || undefined,
    address: b.address ? { '@type': 'PostalAddress', streetAddress: b.address, addressLocality: b.city || undefined, addressCountry: 'IN' } : undefined,
    geo: b.lat != null ? { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } : undefined,
    makesOffer: (b.services || []).filter(s => s.name).map(s => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.name } }))
  }, null, 2);
  const faq = (b.faqs || []).length ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: b.faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }, null, 2) : null;
  const copy = (text, what) => navigator.clipboard?.writeText(`<script type="application/ld+json">\n${text}\n</script>`).then(() => toast(`${what} copied`));
  const pre = 'text-[11.5px] leading-relaxed font-mono text-slate-800 bg-slate-50 ring-1 ring-inset ring-slate-200 rounded-xl p-3 overflow-auto max-h-[460px]';

  // What the audit found on the site's pages, by schema type.
  const pages = report?.result?.crawl?.pages || [];
  const found = {};
  pages.forEach(p => (p.schema_types || []).forEach(t => { (found[t] = found[t] || []).push(p.url); }));
  const hasBusiness = Object.keys(found).some(t => BUSINESS_TYPES.test(t));

  return (
    <div className="space-y-5">
      <Card title="Schema found on the site" subtitle={report ? `From the audit of ${pathOf(report.target) === '/' ? report.target.replace(/^https?:\/\//, '').replace(/\/$/, '') : report.target} · ${pages.length} pages` : 'Run an audit to see what the site already has'}>
        {!report ? <div className="py-4 text-[13px] text-slate-500">No audit yet.</div> : (
          <>
            <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 mb-3 ring-1 ring-inset ${hasBusiness ? 'bg-emerald-50 ring-emerald-200 text-emerald-800' : 'bg-amber-50 ring-amber-200 text-amber-800'}`}>
              {hasBusiness ? <CheckCircle2 size={16} className="shrink-0 mt-px" /> : <XCircle size={16} className="shrink-0 mt-px" />}
              <span className="text-[13px]">{hasBusiness ? 'The site describes the business in structured data. Check it matches the profile below.' : 'No business structured data on the site. Add the LocalBusiness code below to the home and contact pages.'}</span>
            </div>
            {Object.keys(found).length ? (
              <div className="divide-y divide-slate-100">
                {Object.entries(found).map(([t, urls]) => (
                  <div key={t} className="py-2 flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold text-slate-900 font-mono bg-slate-50 ring-1 ring-inset ring-slate-200 rounded px-1.5 py-0.5">{t}</span>
                    <span className="text-[12px] text-slate-500">on {urls.slice(0, 4).map(pathOf).join(', ')}{urls.length > 4 ? ` +${urls.length - 4} more` : ''}</span>
                  </div>
                ))}
              </div>
            ) : <div className="text-[13px] text-slate-500">No structured data found on any crawled page.</div>}
          </>
        )}
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="LocalBusiness schema" subtitle="Built from the saved profile, so it matches Google. Paste it into the home and contact pages."
          action={<div className="flex gap-2"><Button size="sm" icon={Copy} onClick={() => copy(json, 'LocalBusiness schema')}>Copy</Button><a className="h-8 px-3 inline-flex items-center gap-1 text-[12px] font-semibold rounded-xl ring-1 ring-inset ring-slate-200 text-slate-700 hover:bg-slate-50" href="https://search.google.com/test/rich-results" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Test</a></div>}>
          <pre className={pre}>{json}</pre>
        </Card>
        <Card title="FAQ schema" subtitle="From the Q&A saved in GBP Manager" action={faq && <Button size="sm" icon={Copy} onClick={() => copy(faq, 'FAQ schema')}>Copy</Button>}>
          {faq ? <pre className={pre}>{faq}</pre> : <div className="py-6 text-[13px] text-slate-500">Add Q&A in GBP Manager → Q&A / FAQs to generate FAQ schema.</div>}
        </Card>
      </div>
      {toastNode}
    </div>
  );
}

const STEPS = [
  { id: 'audit', label: 'Audit website', hint: 'Scan it live', icon: ScanSearch },
  { id: 'report', label: 'Report', hint: 'Scores, fixes & Lighthouse', icon: FileBarChart },
  { id: 'schema', label: 'Schema', hint: 'Structured data', icon: Braces }
];
const OLD_TABS = { site: 'report', business: 'report', check: 'audit', lighthouse: 'report' };

function Stepper({ step, onStep, hasReport, running }) {
  const at = STEPS.findIndex(s => s.id === step);
  return (
    <nav aria-label="Audit steps" className="ai-glass-card rounded-2xl p-1.5 grid grid-cols-1 sm:grid-cols-3 gap-1">
      {STEPS.map((s, i) => {
        const locked = s.id === 'report' && !hasReport;
        const done = (s.id === 'audit' && hasReport) || (i < at && !locked);
        const active = s.id === step;
        return (
          <button key={s.id} type="button" disabled={locked} onClick={() => onStep(s.id)} aria-current={active ? 'step' : undefined}
            title={locked ? 'Run an audit first' : undefined}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors ${active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}>
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${active ? 'bg-white/20 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {done && !active ? <Check size={14} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-[13px] font-semibold truncate ${active ? 'text-white' : 'text-slate-900'}`}>{s.label}{s.id === 'audit' && running ? '…' : ''}</span>
              <span className={`block text-[11px] truncate ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{s.id === 'audit' && running ? 'Scanning now' : s.hint}</span>
            </span>
          </button>
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
      {current === 'loading' && <Card><div className="py-12 flex items-center justify-center gap-2 text-[13px] text-slate-500"><Loader2 size={16} className="animate-spin" /> Opening the latest report…</div></Card>}
      {current === 'audit' && <AuditStep sa={sa} business={b} onOpenReport={() => setStep('report')} />}
      {current === 'report' && <ReportStep sa={sa} business={b} onNext={setStep} />}
      {current === 'schema' && <SchemaStep b={b} report={sa.report} />}
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
