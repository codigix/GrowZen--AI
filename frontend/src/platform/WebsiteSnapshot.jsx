import React from 'react';
import { ArrowRight, ScanSearch, ShieldCheck } from 'lucide-react';
import { useApi } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const tone = (s) => (s == null ? 'text-slate-400' : s >= 75 ? 'text-emerald-600' : s >= 45 ? 'text-amber-600' : 'text-red-600');
const day = (iso) => { if (!iso) return ''; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const Num = ({ label, value, sub }) => <div className="min-w-[78px]"><div className="text-12 text-slate-500">{label}</div><div className={`text-22 font-semibold tabular-nums leading-tight ${tone(value)}`}>{value == null ? '—' : Math.round(value)}</div>{sub && <div className="text-11 text-slate-400">{sub}</div>}</div>;

/**
 * One view of the website's health, from both tools: the site audit (crawl, speed, issues across all pages) and Page X-Ray (one page in depth: SEO, answer-engine and AI-search checks).
 * It only reads what each tool already saved; nothing is re-run and no number is combined into a new score.
 */
export default function WebsiteSnapshot({ b, sa, onAudit, onXray }) {
  const xr = useApi(b.website ? `/businesses/${b.id}/page-xray/history?limit=1` : null);
  const last = arr(xr.data)[0];
  const rep = sa?.report;
  const issues = arr(rep?.issues);
  const crit = issues.filter(i => i.level === 'critical').length, ser = issues.filter(i => i.level === 'serious').length;
  const crawl = rep?.result?.crawl;
  const speed = rep?.result?.pagespeed?.scores;
  const perf = speed ? (speed.performance ?? speed.mobile?.performance ?? null) : null;
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-label="Website health, from both tools">
      <div className="flex flex-wrap items-center gap-2 mb-3"><h2 className="text-15 font-semibold text-slate-900">Website health at a glance</h2><span className="text-12 text-slate-500">from the two tools below, as last saved</span></div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-13 font-semibold text-slate-800 mb-2"><ScanSearch size={15} className="text-indigo-600" />Website audit <span className="font-normal text-slate-400">whole site</span></div>
          {rep ? (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-2"><Num label="Audit score" value={rep.score} /><Num label="Critical" value={crit} /><Num label="Serious" value={ser} />{crawl?.crawled != null && <Num label="Pages read" value={crawl.crawled} />}{perf != null && <Num label="Speed" value={perf} />}</div>
              <p className="mt-2 text-12 text-slate-500">{rep.finished_at ? `Audited ${day(rep.finished_at)}.` : ''} Crawls every page, checks speed and finds problems across the site.</p>
            </>
          ) : <p className="text-13 text-slate-500">No site audit yet. It crawls the whole site and measures speed.</p>}
          <button type="button" onClick={onAudit} className="mt-2 inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline cursor-pointer">{rep ? 'Open the audit report' : 'Run a site audit'}<ArrowRight size={13} /></button>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-13 font-semibold text-slate-800 mb-2"><ShieldCheck size={15} className="text-indigo-600" />Page X-Ray <span className="font-normal text-slate-400">one page in depth</span></div>
          {last ? (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-2"><Num label="SEO" value={last.seo} /><Num label="AEO" value={last.aeo} sub="answer engines" /><Num label="GEO" value={last.geo} sub="AI search" /></div>
              <p className="mt-2 text-12 text-slate-500">Last page checked {day(last.created_at)}. Adds answer-engine and AI-search checks, technology, SSL, security headers and domain details.</p>
            </>
          ) : <p className="text-13 text-slate-500">No page checked yet. It reads one page in depth: SEO, answer-engine and AI-search checks, technology, SSL and security.</p>}
          <button type="button" onClick={onXray} className="mt-2 inline-flex items-center gap-1 text-13 font-semibold text-indigo-600 hover:underline cursor-pointer">{last ? 'Open Page X-Ray' : 'Check a page'}<ArrowRight size={13} /></button>
        </div>
      </div>
    </section>
  );
}
