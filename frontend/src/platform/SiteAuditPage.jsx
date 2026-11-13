import { useCrumb } from './crumbs';
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { ChevronDown, Globe, Loader2, Search, Check, ScanSearch, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { SeoShell, Card, Button } from './SeoUi';
import { useSiteAudit, ReportStep, LiveScan } from './WebsiteAuditTool';
import SchemaStudio from './SchemaStudio';
import SiteAuditTable from './SiteAuditTable';
import SiteAuditOverview from './SiteAuditOverview';
import WebsiteSnapshot from './WebsiteSnapshot';
import MergedFindings from './MergedFindings';
import { XRay } from './PageXRayPage';
import Select from '../components/Select';
import NewAuditModal from './NewAuditModal';
import { api } from './seoApi';

const OLD_TABS = { site: 'report', business: 'report', check: 'audit', lighthouse: 'report', 'page-xray': 'xray', audit: null };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const clean = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  try { return `${new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).origin}/`; } catch { return ''; }
};

/** A section that stays closed until opened, but is always mounted so its work (the Page X-Ray run) happens either way. */
function Fold({ id, open, onToggle, title, hint, children }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left cursor-pointer">
        <span className="flex-1 min-w-0"><span className="block text-15 font-semibold text-slate-900">{title}</span><span className="block text-12.5 text-slate-500">{hint}</span></span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={open ? 'border-t border-slate-100 p-4 sm:p-5' : 'hidden'}>{children}</div>
    </section>
  );
}

const Pill = ({ state, label, sub }) => (
  <span className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-12.5 ring-1 ${state === 'busy' ? 'ring-indigo-200 bg-indigo-50 text-indigo-900' : state === 'done' ? 'ring-emerald-200 bg-emerald-50 text-emerald-900' : 'ring-slate-200 bg-white text-slate-600'}`}>
    {state === 'busy' ? <Loader2 size={13} className="animate-spin" /> : state === 'done' ? <Check size={13} /> : null}
    <b className="font-semibold">{label}</b><span className="text-slate-500">{sub}</span>
  </span>
);

function SiteAudit({ b, openFold }) {
  const sa = useSiteAudit(b);
  const [overview, setOverview] = useState(null); // that project's audit Overview replaces the page until closed
  const [trigger, setTrigger] = useState({ n: 0, url: '' });
  const [xrayBusy, setXrayBusy] = useState(false);
  const [xrayTick, setXrayTick] = useState(0);
  const [open, setOpen] = useState(openFold ? { [openFold]: true } : {});
  const [formError, setFormError] = useState('');
  const location = useLocation();
  useCrumb(overview ? 'Overview' : undefined);
  useEffect(() => { setOverview(null); }, [location.key]);

  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const [setup, setSetup] = useState(false); // the audit settings window (crawl limits, exclusions, user agent)
  const check = (cfg) => {
    const target = clean(sa.url);
    if (!target) { setFormError('Enter a website address, for example https://yourbusiness.com'); return; }
    setFormError('');
    setSetup(false);
    if (cfg && cfg.limit) {
      sa.launch(target, cfg.limit, { pages_to_crawl: cfg.pages_to_crawl, subdomains: cfg.subdomains, allow: cfg.allow, disallow: cfg.disallow, ignore_params: cfg.ignore_params, user_agent: cfg.user_agent });
      if (b.website && hostOf(target) === hostOf(b.website)) api(`/businesses/${b.id}/audit-config`, { method: 'PUT', body: cfg, repeat: true }).catch(() => { /* the schedule is not saved; the audit still runs */ });
    } else sa.launch(target, sa.crawlPages); // the site audit …
    setTrigger(t => ({ n: t.n + 1, url: target })); // … and the Page X-Ray of the homepage, from the same click
  };

  const loading = !sa.history.data || (sa.current && !sa.audit.data);
  const failed = !sa.running && sa.audit.data?.status === 'failed';
  const busy = sa.running || sa.busy === 'start' || xrayBusy;
  const own = b.website && hostOf(clean(sa.url)) === hostOf(b.website);
  if (overview) return <SiteAuditOverview key={`${overview.id}-${overview.initial?.tab}-${overview.initial?.category || overview.initial?.severity || ''}`} projectId={overview.id} initial={overview.initial} onBack={() => setOverview(null)} />;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/20"><Globe size={18} /></div>
          <div className="min-w-0">
            <div className="text-15 font-semibold text-slate-900">Check a website</div>
            <div className="text-12.5 text-slate-500">One click runs the full site audit and Page X-Ray together. Everything appears below on this page.</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="w-full h-11 pl-10 pr-3 text-14 rounded-lg bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 placeholder-slate-400" placeholder="https://yourbusiness.com" value={sa.url}
              onChange={e => { sa.setUrl(e.target.value); setFormError(''); }} onKeyDown={e => e.key === 'Enter' && !busy && check()} aria-label="Website address" inputMode="url" />
          </div>
          <Select value={sa.crawlPages} onChange={e => sa.setCrawlPages(Number(e.target.value))} className="h-11 px-2.5 rounded text-13 font-semibold text-slate-700 bg-white ring-1 ring-inset ring-slate-200 outline-none cursor-pointer" aria-label="Pages to crawl">
            {[5, 10, 25, 50, 100, 300].map(n => <option key={n} value={n}>{n === 300 ? 'Crawl all pages (up to 300)' : `Crawl ${n} pages`}</option>)}
          </Select>
          <Button variant="primary" className="h-11 px-6" icon={Search} busy={busy} onClick={() => check()} disabled={busy}>{busy ? 'Checking…' : 'Check website'}</Button>
          <Button className="h-11" icon={SlidersHorizontal} disabled={busy || !clean(sa.url)} onClick={() => setSetup(true)} title="Crawl limits, pages to include or skip, user agent">Audit settings</Button>
        </div>
        {(formError || sa.error) && <p className="text-12.5 text-red-600 mt-2" role="alert">{formError || sa.error}</p>}
        <p className="mt-2 text-12 text-slate-500">{own ? 'This is your business website: the results update your scores, dashboard and AI tasks.' : b.website ? <>Another site: the results are not saved to {b.name}. <button type="button" onClick={() => sa.setUrl(b.website)} className="font-medium text-indigo-700 hover:underline cursor-pointer">Use {hostOf(b.website)}</button></> : 'You can check any site.'}</p>
        {(busy || trigger.n > 0) && (
          <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
            <Pill state={sa.running || sa.busy === 'start' ? 'busy' : failed ? 'idle' : sa.audit.data?.status === 'done' ? 'done' : 'idle'} label="Site audit" sub={sa.running ? 'scanning every page' : failed ? 'could not finish' : 'whole site and speed'} />
            <Pill state={xrayBusy ? 'busy' : trigger.n > 0 ? 'done' : 'idle'} label="Page X-Ray" sub={xrayBusy ? 'reading the homepage' : 'homepage in depth'} />
          </div>
        )}
        {failed && <p className="mt-2 text-12.5 text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">The site audit of {hostOf(sa.audit.data.target)} could not finish: {sa.audit.data.error || 'the site could not be reached.'} Check the address opens in a browser and try again.</p>}
      </Card>

      <NewAuditModal open={setup} onClose={() => setSetup(false)} target={clean(sa.url)} host={hostOf(clean(sa.url) || sa.url)} business={b} own={Boolean(own)} busy={busy} onStart={check} />

      {sa.running && <LiveScan audit={sa.audit.data} startedAt={sa.startedAt} />}

      {loading && !sa.running ? <div className="h-24 rounded-xl bg-slate-100 animate-pulse" role="status" aria-busy="true" /> : (
        <>
          <WebsiteSnapshot b={b} sa={sa} tick={xrayTick} />
          {b.website && <MergedFindings key={`${b.id}-${sa.report?.id || 'none'}-${xrayTick}`} bid={b.id} />}
          {!sa.report && !sa.running && !busy && <Card><div className="py-6 text-center text-13 text-slate-500"><ScanSearch size={18} className="inline mr-1.5 -mt-0.5" /><ShieldCheck size={18} className="inline mr-1.5 -mt-0.5" />Press <b>Check website</b> to run the audit and Page X-Ray. The scores and what to fix appear here.</div></Card>}
        </>
      )}

      <div className="space-y-3">
        <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 px-1">Full details</div>
        {sa.report && <Fold id="report" open={!!open.report} onToggle={() => toggle('report')} title="Site audit report" hint="Every issue with its fix, pages crawled, Lighthouse speed, Google tools, PDF download.">{open.report && <ReportStep sa={sa} business={b} onNext={() => {}} />}</Fold>}
        <Fold id="xray" open={!!open.xray} onToggle={() => toggle('xray')} title="Page X-Ray report" hint="The homepage in depth: SEO, AEO and GEO checks, technology, SSL, security headers, domain. Check any other page here too.">
          <XRay key={b.id} b={b} embedded trigger={trigger} onBusy={setXrayBusy} onSaved={() => setXrayTick(t => t + 1)} />
        </Fold>
        <Fold id="schema" open={!!open.schema} onToggle={() => toggle('schema')} title="Schema (structured data)" hint="Create and check the structured data that helps Google and AI understand the business.">{open.schema && <SchemaStudio b={b} report={sa.report} />}</Fold>
        <Fold id="sites" open={!!open.sites} onToggle={() => toggle('sites')} title="Other audits" hint="Earlier audits of this and other websites.">{open.sites && <SiteAuditTable projectId={b.id} onOverview={(id, initial) => setOverview({ id, initial })} />}</Fold>
      </div>
    </div>
  );
}

/**
 * Website audit and Page X-Ray on one screen: one address, one click, one page of results
 * (scores, what to fix, then the full reports folded underneath). ?tab=report|xray|schema opens that section.
 */
export default function SiteAuditPage() {
  const [params] = useSearchParams();
  const raw = params.get('tab');
  const fold = ['report', 'xray', 'schema', 'sites'].includes(raw) ? raw : OLD_TABS[raw] || null;
  return (
    <SeoShell step="website" title="Website Audit & Page X-Ray" subtitle="Check the website once: the whole-site audit and the homepage X-Ray run together and show on this page.">
      {(b) => <SiteAudit key={b.id} b={b} openFold={fold} />}
    </SeoShell>
  );
}
