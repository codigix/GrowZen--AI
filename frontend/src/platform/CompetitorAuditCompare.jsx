import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Card, Badge, Tabs, ErrorNote, Button, useAction } from './SeoUi';
import { api } from './seoApi';

/**
 * The side-by-side result of comparing a competitor's site audit with the business's own (PageSpeed scores,
 * Core Web Vitals, Lighthouse SEO checks, matched pages, keyword and content gaps). Opened from Competitor
 * Research (POST /audit/competitors/compare); the page there runs the audits.
 */

const Chips = ({ items, empty, tone = 'slate' }) => (
  items && items.length ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map(k => <span key={k} className={`px-2.5 py-1 rounded-full text-12.5 border ${tone === 'rose' ? 'bg-rose-50 text-rose-800 border-rose-200' : tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{k}</span>)}
    </div>
  ) : <p className="text-13 text-slate-500">{empty}</p>
);
const SIDE = { both: ['Both sites', 'green'], competitor: ['Competitor', 'rose'], client: ['Your site', 'blue'] };

/** The keywords worth targeting: real searched phrases from both sites' titles, headings and descriptions, each with where it was taken from. */
function ResearchedKeywords({ r, bid, competitor }) {
  const [added, setAdded] = useState({});
  const [pick, setPick] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, error, run] = useAction();
  if (!r) return null;
  if (!r.available) return <p className="text-13 text-slate-500">No usable phrases were found in the crawled titles, headings and descriptions.</p>;
  const items = r.items;
  const todo = items.filter(i => !i.tracked && !added[i.keyword]);
  const save = (list) => run('add', async () => {
    await api(`/businesses/${bid}/keywords`, { method: 'POST', body: list.map(i => ({ keyword: i.keyword, volume: i.volume || undefined, source: {
      kind: 'competitor_compare', label: i.side === 'client' ? 'Your own site' : `${competitor || 'Competitor'} website`, side: i.side, from: competitor || null,
      pages: i.sources.slice(0, 4).map(x => ({ url: x.url, in: x.in })), searches: i.volume ?? null, at: new Date().toISOString().slice(0, 10) } })) });
    setAdded(a => ({ ...a, ...Object.fromEntries(list.map(i => [i.keyword, true])) })); setPick([]);
  });
  return (
    <div className="space-y-3">
      <p className="text-12.5 text-slate-600">Phrases taken from the {r.source}. {r.verified ? 'Only phrases people really search for are kept, with their monthly searches from Google Keyword Planner.' : <b className="text-amber-800">Searches not verified: {r.volume_note}</b>}</p>
      <div className="flex flex-wrap items-center gap-2 text-12">
        {Object.entries(SIDE).map(([k, [l, t]]) => <Badge key={k} tone={t}>{l} {r.counts[k] || 0}</Badge>)}
        <span className="ml-auto flex gap-2">
          {pick.length > 0 && <Button size="sm" variant="primary" busy={busy === 'add'} onClick={() => save(items.filter(i => pick.includes(i.keyword)))}>Add {pick.length} to My Keywords</Button>}
          {!pick.length && todo.length > 0 && <Button size="sm" onClick={() => setPick(todo.slice(0, 20).map(i => i.keyword))}>Select the top {Math.min(20, todo.length)}</Button>}
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[460px] overflow-y-auto">
        <table className="w-full text-13 min-w-[720px]">
          <thead className="bg-slate-50 text-left text-11 uppercase tracking-wide text-slate-500 sticky top-0"><tr>
            <th className="px-3 py-2 w-8" /><th className="px-3 py-2 font-semibold">Keyword</th><th className="px-3 py-2 font-semibold text-right">Searches/mo</th><th className="px-3 py-2 font-semibold">Taken from</th><th className="px-3 py-2 font-semibold text-right">Pages</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(i => { const done = i.tracked || added[i.keyword]; const [sl, st] = SIDE[i.side]; return (
              <React.Fragment key={i.keyword}>
                <tr className="align-middle">
                  <td className="px-3 py-2"><input type="checkbox" disabled={done} checked={pick.includes(i.keyword)} onChange={() => setPick(p => (p.includes(i.keyword) ? p.filter(x => x !== i.keyword) : [...p, i.keyword]))} aria-label={`Select ${i.keyword}`} /></td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{i.keyword}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.volume != null ? i.volume.toLocaleString('en-IN') : <span className="text-slate-300" title="Not verified">—</span>}</td>
                  <td className="px-3 py-2"><Badge tone={st}>{sl}</Badge> <button type="button" onClick={() => setOpen(open === i.keyword ? null : i.keyword)} className="ml-1 text-12 text-indigo-600 hover:underline cursor-pointer">{open === i.keyword ? 'hide pages' : 'see pages'}</button></td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{i.pages}</td>
                  <td className="px-3 py-2 text-right">{done ? <span className="text-12 text-emerald-700 font-semibold">In My Keywords</span> : <Button size="sm" onClick={() => save([i])}>Add</Button>}</td>
                </tr>
                {open === i.keyword && <tr><td /><td colSpan={5} className="px-3 pb-3"><ul className="grid gap-1 text-12.5 text-slate-600">{i.sources.map((x, n) => <li key={n}><b>{x.name}</b>: <a href={x.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{x.path}</a> · in the {x.in.join(', ')}</li>)}</ul></td></tr>}
              </React.Fragment>); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
      <td className="px-4 py-2.5 text-13 font-medium text-slate-900">{m.label}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-13">{m.ours_display ?? m.ours ?? '—'}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-13">{m.competitor_display ?? m.competitor ?? '—'}</td>
      <td className={`px-3 py-2.5 text-right tabular-nums text-13 font-semibold ${better}`}>
        {m.available ? (m.better === 'tie' ? 'Tie' : m.better === 'ours' ? 'You lead' : 'They lead') : '—'}
      </td>
    </tr>
  );
}

/** The comparison without its own card: inside a modal the modal is the frame. */
const BareShell = ({ note, children }) => <div><p className="text-12.5 text-slate-500 mb-4">{note}</p>{children}</div>;

export function ComparisonResult({ c, bare = false }) {
  const [tab, setTab] = useState('overview');
  if (c.error) return <ErrorNote>{c.error}</ErrorNote>;
  const checks = c.technical_seo?.checks || [];
  const pages = c.pages || {};
  const gaps = c.keywords_and_content_gaps || {};
  const subtitle = `vs ${c.ours?.target || 'your site'} · ${c.ours?.strategy || '?'} audit`;
  const Shell = bare ? BareShell : Card;
  const shellProps = bare ? { note: `${c.competitor?.name || c.competitor?.target} ${subtitle}` } : { title: c.competitor?.name || c.competitor?.target, subtitle };
  return (
    <Shell {...shellProps}>
      {!c.compatibility?.compatible && (
        <div className="mb-4 text-12.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
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
          {!c.overall?.available && <p className="text-13 text-slate-500">No PageSpeed data on one side yet.</p>}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
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
              <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">Real-user (CrUX field) data</div>
              <div className="flex flex-wrap gap-2">
                {(c.overall.field_data || []).filter(f => f.available).map(f => (
                  <span key={f.key} className="text-12 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50">{f.label}: <b>{f.ours || '—'}</b> vs <b>{f.competitor || '—'}</b></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'technical' && (
        <div className="overflow-x-auto">
          {!checks.length ? <p className="text-13 text-slate-500">No Lighthouse SEO checks on one side yet.</p> : (
            <table className="w-full text-13">
              <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
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
          <p className="text-12 text-slate-500">{pages.note}</p>
          {!pages.matched?.length ? <p className="text-13 text-slate-500">No matching pages found between the two crawls.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-13">
                <thead className="bg-slate-50 text-left text-11  tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5 font-semibold">Page</th><th className="px-3 py-2.5 font-semibold">Your title</th><th className="px-3 py-2.5 font-semibold">Their title</th><th className="px-3 py-2.5 font-semibold text-right">Words (you / them)</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pages.matched.map(m => (
                    <tr key={m.path}>
                      <td className="px-4 py-2.5  text-12 text-slate-700">{m.path}</td>
                      <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.ours?.title}>{m.ours?.title || '(missing)'}</td>
                      <td className="px-3 py-2.5 truncate max-w-[220px]" title={m.competitor?.title}>{m.competitor?.title || '(missing)'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.ours?.word_count ?? '—'} / {m.competitor?.word_count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-12 text-slate-500">
            <span>Pages only you crawled: {pages.unmatched_ours?.length || 0}</span>
            <span>Pages only they crawled: {pages.unmatched_competitor?.length || 0}</span>
          </div>
        </div>
      )}

      {tab === 'keywords' && (
        <div className="space-y-6">
          <div>
            <div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-2">Best keywords to target</div>
            <ResearchedKeywords r={gaps.researched} bid={c.ours?.business_id} competitor={c.competitor?.name || c.competitor?.target} />
          </div>

          <details className="group">
            <summary className="text-12 font-semibold uppercase tracking-wide text-slate-500 cursor-pointer">All repeated words on the pages (raw, not checked for searches)</summary>
            <div className="mt-3">
            <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">On-page keywords (from the crawled content, no external API)</div>
            {gaps.on_page?.available ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-12 font-semibold text-emerald-700 mb-1.5">Shared ({gaps.on_page.shared_keywords.length})</div>
                  <Chips items={gaps.on_page.shared_keywords} empty="None in common." />
                </div>
                <div>
                  <div className="text-12 font-semibold text-indigo-700 mb-1.5">Only you emphasise ({gaps.on_page.ours_only_keywords.length})</div>
                  <Chips items={gaps.on_page.ours_only_keywords} empty="Nothing unique to your content." />
                </div>
                <div>
                  <div className="text-12 font-semibold text-rose-700 mb-1.5">Only they emphasise ({gaps.on_page.competitor_only_keywords.length}) — the gap</div>
                  <Chips items={gaps.on_page.competitor_only_keywords} empty="They cover nothing you don't." tone="rose" />
                </div>
              </div>
            ) : (
              <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.on_page?.reason}</div>
            )}
            </div>
          </details>

          <div>
            <div className="text-12 font-semibold  tracking-wide text-slate-500 mb-2">Google-search keyword gaps (from Competitor Research)</div>
            {gaps.search?.available ? (
              <div className="space-y-3">
                {gaps.search.note && <p className="text-12 text-slate-500">{gaps.search.note}</p>}
                {!gaps.search.keyword_gaps?.length ? <p className="text-13 text-slate-500">No search keyword gaps found against this competitor.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {gaps.search.keyword_gaps.map(g => (
                      <li key={g.keyword} className="px-4 py-2.5 text-13 flex flex-wrap items-center gap-2">
                        <b className="text-slate-900">{g.keyword}</b>
                        <span className="text-slate-500">· outranked by {g.competitors?.map(x => x.domain).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="text-13 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{gaps.search?.reason} {gaps.search?.required_source}</div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
