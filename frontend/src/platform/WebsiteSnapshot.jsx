import React, { useState } from 'react';
import { api, useApi } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const tone = (s) => (s == null ? 'text-slate-400' : s >= 75 ? 'text-emerald-600' : s >= 45 ? 'text-amber-600' : 'text-red-600');
const day = (iso) => { if (!iso) return ''; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const Tile = ({ label, value, sub, plain }) => (
  <div className="rounded-lg bg-slate-50 px-3.5 py-3 min-w-0">
    <div className="text-12 text-slate-500 truncate">{label}</div>
    <div className={`text-24 font-semibold tabular-nums leading-tight ${plain ? 'text-slate-900' : tone(value)}`}>{value == null ? '—' : Math.round(value)}</div>
    {sub && <div className="text-11 text-slate-400 truncate">{sub}</div>}
  </div>
);

/** The scores of both tools in one row. It only reads what each tool saved; nothing is re-run and no new combined score is invented. */
export default function WebsiteSnapshot({ b, sa, tick = 0 }) {
  const xr = useApi(b.website ? `/businesses/${b.id}/page-xray/history?limit=1&t=${tick}` : null);
  const last = arr(xr.data)[0];
  const au = useApi(b.website ? `/businesses/${b.id}/site-authority` : null);  // DA, PA and spam of this project's own website only
  const [asking, setAsking] = useState(false), [auErr, setAuErr] = useState('');
  const getAuthority = async () => {
    setAsking(true); setAuErr('');
    try { const r = await api(`/businesses/${b.id}/site-authority`, { method: 'POST', timeout: 90000 }); if (r.note) setAuErr(r.note); await au.reload(true); } catch (e) { setAuErr(e.message || 'Could not get the figures.'); } finally { setAsking(false); }
  };
  const auth = au.data, sc = auth?.scores;
  const rep = sa?.report;
  const issues = arr(rep?.issues);
  const crit = issues.filter(i => i.level === 'critical').length, ser = issues.filter(i => i.level === 'serious').length;
  const speed = rep?.result?.pagespeed?.scores;
  const perf = speed ? (speed.performance ?? speed.mobile?.performance ?? null) : null;
  if (!rep && !last) return null;
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-label="Website scores">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <h2 className="text-15 font-semibold text-slate-900">Scores</h2>
        <span className="text-12 text-slate-500">{[rep?.finished_at ? `Site audit ${day(rep.finished_at)}` : '', last ? `Page X-Ray ${day(last.created_at)}` : ''].filter(Boolean).join('  ·  ')}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <Tile label="Site audit" value={rep?.score} sub="whole site" />
        <Tile label="Speed" value={perf} sub="Lighthouse" />
        <Tile label="Critical" value={rep ? crit : null} plain sub="to fix first" />
        <Tile label="Serious" value={rep ? ser : null} plain sub="to fix next" />
        <Tile label="SEO" value={last?.seo} sub="homepage" />
        <Tile label="AEO" value={last?.aeo} sub="answer engines" />
        <Tile label="GEO" value={last?.geo} sub="AI search" />
        <Tile label="Pages read" value={rep?.result?.crawl?.crawled} plain sub="by the audit" />
      </div>
      {auth?.configured && auth.domain && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
            <h3 className="text-13 font-semibold text-slate-800">Authority of {auth.domain}</h3>
            {!sc && <span className="text-12 text-slate-500">Not fetched yet.</span>}
            <button type="button" onClick={getAuthority} disabled={asking || (sc && auth.fresh)} title={sc && auth.fresh ? 'Fetched less than a day ago: figures do not change that fast, so it is not asked again until tomorrow.' : undefined}
              className="ml-auto h-8 px-3 rounded-lg border border-slate-300 bg-white text-12.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{asking ? 'Getting…' : sc ? (auth.fresh ? 'Up to date' : 'Refresh') : 'Get DA, PA and Spam'}</button>
          </div>
          <div className="grid grid-cols-3 gap-2.5 max-w-xl">
            <Tile label="Domain Authority (DA)" value={sc?.da} sub="whole website" />
            <Tile label="Page Authority (PA)" value={sc?.pa} sub="home page" />
            <Tile label="Spam Score" value={sc?.spam} plain sub="lower is better" />
          </div>
          {auErr && <p className="mt-2 text-12 text-red-600">{auErr}</p>}
        </div>)}
    </section>
  );
}
