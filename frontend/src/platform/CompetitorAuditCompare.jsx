import React, { useState } from 'react';
import {
  Gauge, Globe, Loader2, RotateCcw, Search, ShieldCheck, Smartphone, Monitor, AlertTriangle, CheckCircle2, XCircle, MinusCircle
} from 'lucide-react';
import { Card, Badge, Button, Field, Tabs, inputCls, ErrorNote, useAction } from './SeoUi';
import { api, usePoll } from './seoApi';

/**
 * Website-vs-competitor PageSpeed + on-page comparison (new backend work):
 *   GET/POST  /competitors                 -- find & register competitors (Google Maps) against the business
 *   GET       /competitors?business_id=     -- list registered competitors
 *   POST      /audit/competitors            -- audit a competitor's site (PageSpeed + crawl)
 *   GET       /audit/competitors            -- that business's competitor-audit history
 *   POST      /audit/competitors/compare    -- compare our latest audit against a competitor's
 * This is separate from the Serper-based "Competitor Research" tabs above (app/competitors/intel.py).
 */

const isRunning = (s) => s === 'queued' || s === 'running';
const Chips = ({ items, empty, tone = 'slate' }) => (
  items && items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map(k => <span key={k} className={`px-2.5 py-1 rounded-full text-[12.5px] border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{k}</span>)}
    </div>
  ) : <p className="text-[13px] text-slate-500">{empty}</p>
);
const STATUS_TONE = {
  both_pass: ['green', CheckCircle2, 'Both pass'],
  both_fail: ['red', XCircle, 'Both fail'],
  ours_fail_competitor_pass: ['red', AlertTriangle, 'Ground to make up'],
  ours_pass_competitor_fail: ['green', CheckCircle2, 'Our advantage'],
  both_unavailable: ['gray', MinusCircle, 'Not applicable'],
  incomparable: ['gray', MinusCircle, 'Not comparable']
};

function MetricRow({ m }) {
  const better = m.better === 'ours' ? 'text-emerald-700' : m.better === 'competitor' ? 'text-rose-700' : 'text-slate-500';
  return (
    <tr>
      <td className="px-4 py-2.5 text-[13px] font-medium text-slate-900">{m.label}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[13px]">{m.ours_display ?? m.ours ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[13px]">{m.competitor_display ?? m.competitor ?? '—'}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] font-semibold ${better}`}>
        {m.available ? (m.better === 'tie' ? 'Tie' : m.better === 'ours' ? 'You lead' : 'They lead') : '—'}
      </td>
    </tr>
  );
}

function ComparisonResult({ c }) {
  const [tab, setTab] = useState('overview');
  if (c.error) return <ErrorNote>{c.error}</ErrorNote>;
  const checks = c.technical_seo?.checks || [];
  const pages = c.pages || {};
  const gaps = c.keywords_and_content_gaps || {};
  return (
    <Card title={c.competitor?.name || c.competitor?.target} subtitle={`vs ${c.ours?.target || 'your site'} · ${c.ours?.strategy || '?'} audit`}>
      {!c.compatibility?.compatible && (
        <div className="mb-4 text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" /> {c.compatibility?.note || 'Strategies differ (mobile vs desktop); scores are not directly comparable.'}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Scores & vitals' },
        { id: 'technical', label: 'Technical SEO', count: checks.length },
        { id: 'pages', label: 'Pages', count: pages.matched?.length || 0 },
        { id: 'keywords', label: 'Keywords & content' }
      ]} />

      {tab === 'overview' && (
        <div className="space-y-5">
          {!c.overall?.available && <p className="text-[13px] text-slate-500">No PageSpeed data on one side yet.</p>}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2 font-semibold">Metric</th><th className="px-3 py-2 font-semibold text-right">You</th><th className="px-3 py-2 font-semibold text-right">Competitor</th><th className="px-3 py-2 font-semibold text-right">Edge</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(c.overall?.scores || []).map(m => <MetricRow key={m.key} m={m} />)}
                {(c.overall?.core_web_vitals || []).map(m => <MetricRow key={m.key} m={m} />)}
              </tbody>
            </table>
          </div>
          {(c.overall?.field_data || []).some(f => f.available) && (
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Real-user (CrUX field) data</div>
              <div className="flex flex-wrap gap-2">
                {(c.overall.field_data || []).filter(f => f.available).map(f => (
                  <span key={f.key} className="text-[12px] px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50">{f.label}: <b>{f.ours || '—'}</b> vs <b>{f.competitor || '—'}</b></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'technical' && (
        <div className="overflow-x-auto">
          {!checks.length ? <p className="text-[13px] text-slate-500">No Lighthouse SEO checks on one side yet.</p> : (
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2.5 font-semibold">Check</th><th className="px-3 py-2.5 font-semibold text-center">You</th><th className="px-3 py-2.5 font-semibold text-center">Competitor</th><th className="px-3 py-2.5 font-semibold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {checks.map(ch => {
                  const [tone, Icon, label] = STATUS_TONE[ch.status] || STATUS_TONE.incomparable;
                  return (
                    <tr key={ch.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900" title={ch.description}>{ch.title || ch.id}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{ch.ours?.status || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{ch.competitor?.status || '—'}</td>
                      <td className="px-3 py-2.5"><Badge tone={tone}><Icon size={11} />{label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'pages' && (
        <div className="space-y-4">
          <p className="text-[12px] text-slate-500">{pages.note}</p>
          {!pages.matched?.length ? <p className="text-[13px] text-slate-500">No matching pages found between the two crawls.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5 font-semibold">Page</th><th className="px-3 py-2.5 font-semibold">Your title</th><th className="px-3 py-2.5 font-semibold">Their title</th><th className="px-3 py-2.5 font-semibold text-right">Words (you / them)</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pages.matched.map(m => (
                    <tr key={m.path}>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-slate-700">{m.path}</td>
                      <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.ours?.title}>{m.ours?.title || '(missing)'}</td>
                      <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.competitor?.title}>{m.competitor?.title || '(missing)'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.ours?.word_count ?? '—'} / {m.competitor?.word_count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-[12px] text-slate-500">
            <span>Pages only you crawled: {pages.unmatched_ours?.length || 0}</span>
            <span>Pages only they crawled: {pages.unmatched_competitor?.length || 0}</span>
          </div>
        </div>
      )}

      {tab === 'keywords' && (
        <div className="space-y-6">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">On-page keywords (from the crawled content, no external API)</div>
            {gaps.on_page?.available ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-[12px] font-semibold text-emerald-700 mb-1.5">Shared ({gaps.on_page.shared_keywords.length})</div>
                  <Chips items={gaps.on_page.shared_keywords} empty="None in common." />
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-indigo-700 mb-1.5">Only you emphasise ({gaps.on_page.ours_only_keywords.length})</div>
                  <Chips items={gaps.on_page.ours_only_keywords} empty="Nothing unique to your content." />
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-rose-700 mb-1.5">Only they emphasise ({gaps.on_page.competitor_only_keywords.length}) — the gap</div>
                  <Chips items={gaps.on_page.competitor_only_keywords} empty="They cover nothing you don't." tone="rose" />
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.on_page?.reason}</div>
            )}
          </div>

          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Google-search keyword gaps (from Competitor Research)</div>
            {gaps.search?.available ? (
              <div className="space-y-3">
                {gaps.search.note && <p className="text-[12px] text-slate-500">{gaps.search.note}</p>}
                {!gaps.search.keyword_gaps?.length ? <p className="text-[13px] text-slate-500">No search keyword gaps found against this competitor.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {gaps.search.keyword_gaps.map(g => (
                      <li key={g.keyword} className="px-4 py-2.5 text-[13px] flex flex-wrap items-center gap-2">
                        <b className="text-slate-900">{g.keyword}</b>
                        <span className="text-slate-500">· outranked by {g.competitors?.map(x => x.domain).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.search?.reason} {gaps.search?.required_source}</div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

const STATUS_LABEL = { queued: 'Queued…', running: 'Auditing…', done: 'Audited', failed: 'Audit failed' };

export default function CompetitorAuditCompare({ b }) {
  // Scoped to the *current* search only (top N for this business type + location) -- not every
  // competitor ever registered for this business. Re-searching with different terms replaces it.
  const [competitors, setCompetitors] = useState([]);
  const [searched, setSearched] = useState(false);
  const [auditMap, setAuditMap] = useState({}); // { [competitorId]: { id, status } } -- latest audit per competitor
  const [ourAudit, setOurAudit] = useState(null); // { id, status } | null
  const [businessType, setBusinessType] = useState(b.primaryCategory || '');
  const [location, setLocation] = useState([b.area, b.city].filter(Boolean).join(', ') || '');
  const [strategy, setStrategy] = useState('mobile');
  const [comparing, setComparing] = useState(null); // competitor id currently being compared
  const [comparison, setComparison] = useState(null);
  const [findBusy, findError, runFind] = useAction();
  const [compareError, setCompareError] = useState('');

  // Seeds audit statuses for a given list of competitors from this business's audit history, so a
  // site that was already audited (e.g. it resurfaces in a later search) shows its status right away.
  const seedAuditStatuses = (list) => api(`/audit/competitors?business_id=${b.id}&limit=200`)
    .then(hist => {
      const byCompetitor = {};
      for (const a of hist) if (a.competitor_id) byCompetitor[a.competitor_id] = { id: a.id, status: a.status };
      const next = {};
      for (const c of list) if (byCompetitor[c.id]) next[c.id] = byCompetitor[c.id];
      setAuditMap(next);
      return next;
    })
    .catch(() => ({}));

  // One audit per competitor, fired off together right after they're found/registered -- no need
  // to click "Audit" on each row one at a time.
  const auditCompetitor = async (competitor) => {
    try {
      const [{ id, status }] = await api('/audit/competitors', { method: 'POST', body: { urls: [competitor.website], business_id: b.id, competitor_id: competitor.id, strategy } });
      setAuditMap(m => ({ ...m, [competitor.id]: { id, status } }));
    } catch (e) {
      setAuditMap(m => ({ ...m, [competitor.id]: { id: null, status: 'failed', error: e.message } }));
    }
  };
  // Every competitor with a website that isn't already audited or mid-audit -- so a repeat Find
  // doesn't needlessly re-POST for ones already done (the backend would just reuse them anyway,
  // but this also covers one that Google Places didn't return again this time around).
  const auditAllCompetitors = (list, statusMap) => {
    list.filter(c => c.website && !['done', 'queued', 'running'].includes(statusMap[c.id]?.status)).forEach(auditCompetitor);
  };

  const auditOurSite = async () => {
    if (!b.website) return;
    try {
      const r = await api('/website-audits', { method: 'POST', body: { url: b.website, business_id: b.id, strategy } });
      setOurAudit({ id: r.id, status: 'queued' });
    } catch { /* surfaced only if Compare then fails */ }
  };

  // Poll every audit still in flight (ours + each competitor's) until it finishes.
  const runningCompetitors = Object.entries(auditMap).filter(([, v]) => isRunning(v.status));
  usePoll(async () => {
    const updates = await Promise.all(runningCompetitors.map(([cid, v]) => api(`/audit/competitors/${v.id}`).then(a => [cid, a]).catch(() => null)));
    setAuditMap(m => {
      const next = { ...m };
      for (const u of updates) if (u) next[u[0]] = { id: u[1].id, status: u[1].status };
      return next;
    });
  }, runningCompetitors.length > 0, 2500);
  usePoll(async () => {
    const a = await api(`/website-audits/${ourAudit.id}`).catch(() => null);
    if (a) setOurAudit({ id: a.id, status: a.status });
  }, isRunning(ourAudit?.status), 2500);

  const find = () => runFind('find', async () => {
    const r = await api('/competitors', { method: 'POST', body: { business_type: businessType, location, business_id: b.id, top_n: 10 } });
    const list = r.registered || []; // only this search's top-N results, not every competitor ever found
    setCompetitors(list);
    setSearched(true);
    setComparison(null);
    const statuses = await seedAuditStatuses(list);
    auditOurSite();
    auditAllCompetitors(list, statuses);
    return r;
  });

  const compare = async (competitorId) => {
    setComparing(competitorId); setCompareError(''); setComparison(null);
    try {
      const r = await api('/audit/competitors/compare', { method: 'POST', body: { business_id: b.id, competitor_ids: [competitorId], strategy } });
      setComparison(r.comparisons?.[0] || null);
    } catch (e) { setCompareError(e.message); } finally { setComparing(null); }
  };

  return (
    <div className="space-y-5">
      <Card title="Website vs competitor audit" subtitle="PageSpeed scores, Core Web Vitals, Lighthouse SEO checks and on-page content, compared side by side">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end mb-4">
          <Field label="Business type"><input className={inputCls} value={businessType} onChange={e => setBusinessType(e.target.value)} placeholder="e.g. dentist" /></Field>
          <Field label="Location"><input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="Pune, India" /></Field>
          <Button variant="primary" icon={Search} busy={findBusy === 'find'} disabled={!businessType.trim() || !location.trim()} onClick={find}>Find competitors</Button>
        </div>
        <ErrorNote>{findError}</ErrorNote>
        {findBusy === 'find' && <p className="text-[12px] text-slate-500 mb-2">Registering competitors, then auditing your site and every one of them in the background…</p>}

        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Registered competitors ({competitors.length})</div>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">
              {[['mobile', Smartphone], ['desktop', Monitor]].map(([s, I]) => (
                <button key={s} type="button" onClick={() => setStrategy(s)} className={`h-7 px-2.5 flex items-center gap-1 text-[11.5px] font-semibold rounded-md cursor-pointer transition-colors ${strategy === s ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}><I size={12} />{s}</button>
              ))}
            </div>
            <span className="text-[12px] text-slate-500 inline-flex items-center gap-1.5">
              {ourAudit && isRunning(ourAudit.status) && <Loader2 size={12} className="animate-spin" />}
              {ourAudit ? STATUS_LABEL[ourAudit.status] || '' : ''}
            </span>
            <Button size="sm" variant="secondary" icon={RotateCcw} disabled={!b.website || isRunning(ourAudit?.status)} onClick={auditOurSite}>Audit our site</Button>
          </div>
        </div>

        {!competitors.length ? (
          <p className="text-[13px] text-slate-500">
            {searched ? 'No competitors with a website found for that search.' : 'Enter a business type and location, then search to find competitors near you on Google Maps.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {competitors.map(c => {
              const a = auditMap[c.id];
              return (
                <li key={c.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-slate-900 truncate">{c.name}</div>
                    <a href={c.website} target="_blank" rel="noreferrer" className="text-[12px] text-indigo-700 hover:underline inline-flex items-center gap-1 truncate"><Globe size={11} />{c.website}</a>
                  </div>
                  {a && (
                    <span className="text-[12px] text-slate-500 inline-flex items-center gap-1.5 whitespace-nowrap">
                      {isRunning(a.status) && <Loader2 size={13} className="animate-spin" />}
                      {STATUS_LABEL[a.status] || a.status}
                    </span>
                  )}
                  <Button size="sm" icon={Gauge} disabled={isRunning(a?.status)} onClick={() => auditCompetitor(c)}>{a ? 'Re-audit' : 'Audit'}</Button>
                  <Button size="sm" variant="primary" icon={ShieldCheck} busy={comparing === c.id} onClick={() => compare(c.id)}>Compare</Button>
                </li>
              );
            })}
          </ul>
        )}
        <ErrorNote>{compareError}</ErrorNote>
      </Card>

      {comparison && <ComparisonResult c={comparison} />}
    </div>
  );
}
