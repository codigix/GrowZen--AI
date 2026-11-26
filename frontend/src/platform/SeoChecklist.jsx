import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, RefreshCw, Sparkles, Info } from 'lucide-react';
import { api } from './seoApi';
import { Button } from './SeoUi';

/**
 * SEO Quality Checklist for one saved article. Every row comes from the server's real validation
 * (backend/app/services/seo_report.py): measurable checks in Python, qualitative ones from an AI review.
 * Statuses: pass | warning | fail | na. Nothing is assumed here.
 */
const STATUS = {
  pass: { label: 'Pass', icon: CheckCircle2, cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  warning: { label: 'Warning', icon: AlertTriangle, cls: 'text-amber-800 bg-amber-50 ring-amber-200' },
  fail: { label: 'Fail', icon: XCircle, cls: 'text-red-700 bg-red-50 ring-red-200' },
  na: { label: 'Not applicable', icon: MinusCircle, cls: 'text-slate-600 bg-slate-50 ring-slate-200' },
};
const ORDER = { fail: 0, warning: 1, pass: 2, na: 3 };

function Pill({ s }) {
  const x = STATUS[s] || STATUS.na;
  const Icon = x.icon;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ring-1 ring-inset text-[11px] font-semibold whitespace-nowrap ${x.cls}`}><Icon size={12} />{x.label}</span>;
}

function Chips({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      <div className="flex flex-wrap gap-1.5">{items.map(x => <span key={x} className="px-2 py-0.5 rounded-full bg-white ring-1 ring-slate-200 text-[12px] text-slate-700">{x}</span>)}</div>
    </div>
  );
}

export default function SeoChecklist({ b, articleId, unsaved, savedAt }) {
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(''); // '' | 'load' | 'check' | 'ai'
  const [error, setError] = useState('');
  const base = `/businesses/${b.id}/articles/${articleId}/seo-report`;

  useEffect(() => {
    if (!articleId) return;
    setBusy('load'); setError('');
    api(base).then(setRep).catch(e => setError(e.message || String(e))).finally(() => setBusy(''));
  }, [base, articleId, savedAt]); // savedAt: reload after each save (the server re-checks on save)

  const run = (ai) => {
    setBusy(ai ? 'ai' : 'check'); setError('');
    api(`${base}?ai=${ai}`, { method: 'POST', timeout: 200000 }).then(setRep).catch(e => setError(e.message || String(e))).finally(() => setBusy(''));
  };

  if (!articleId) return null;
  const checks = rep?.checks || [];
  const groups = [...new Set(checks.map(c => c.group))];
  const sum = rep?.summary || {};
  const ai = rep?.ai;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <div>
          <div className="text-[14px] font-bold text-slate-900">SEO Quality Checklist</div>
          <div className="text-[11.5px] text-slate-500">Checks the saved article: measurable checks are computed from the text; the AI review judges writing, facts and E-E-A-T.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" icon={RefreshCw} busy={busy === 'check'} disabled={Boolean(busy)} onClick={() => run(false)}>Re-check</Button>
          <Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'ai'} disabled={Boolean(busy)} onClick={() => run(true)}>{ai ? 'Run AI review again' : 'Run AI review'}</Button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {unsaved && <div className="flex items-center gap-2 text-[12px] text-amber-900 bg-amber-50 rounded-lg px-3 py-2"><Info size={13} />You have unsaved edits. The checklist shows the saved article: save first, then Re-check.</div>}
        {rep?.ai_stale && <div className="flex items-center gap-2 text-[12px] text-amber-900 bg-amber-50 rounded-lg px-3 py-2"><Info size={13} />The AI review is from an earlier version of the text. Run it again to review the current one.</div>}
        {rep?.ai_error && <div className="text-[12px] text-red-700 bg-red-50 rounded-lg px-3 py-2">AI review failed: {rep.ai_error}</div>}
        {error && <div className="text-[12px] text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        {busy === 'load' && !rep && <div className="text-[12px] text-slate-500">Loading the checklist…</div>}
        {rep && Array.isArray(rep.blocking) && (rep.blocking.length === 0 ? (
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200 rounded-lg px-3 py-2"><CheckCircle2 size={14} />Ready to publish: every mandatory requirement passes.</div>
        ) : (
          <div className="rounded-lg bg-red-50 ring-1 ring-red-200 px-3 py-2.5 space-y-1.5" role="alert">
            <div className="flex items-center gap-2 text-[12.5px] font-bold text-red-800"><XCircle size={14} />Not ready to publish: {rep.blocking.length} mandatory requirement{rep.blocking.length !== 1 ? 's' : ''} failed</div>
            <ul className="space-y-1 text-[12px] text-red-900">
              {rep.blocking.map(x => (
                <li key={x.id}><b>{x.label}</b>{x.detail ? <span className="text-red-800"> ({x.detail})</span> : null}<div className="text-slate-700">Correction: {x.fix}</div></li>
              ))}
            </ul>
          </div>
        ))}
        {busy === 'ai' && <div className="text-[12px] text-indigo-700 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" />Reviewing the article with Claude AI (this can take a minute)…</div>}

        {checks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {['pass', 'warning', 'fail', 'na'].map(s => <span key={s} className="inline-flex items-center gap-1.5 text-[12px]"><Pill s={s} /><b className="tabular-nums">{sum[s] || 0}</b></span>)}
            {rep?.checked_at && <span className="ml-auto text-[11px] text-slate-400">Checked {new Date(rep.checked_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        )}

        {groups.map(g => (
          <div key={g}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{g}</div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {checks.filter(c => c.group === g).sort((x, y) => ORDER[x.status] - ORDER[y.status]).map(c => (
                <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-[12px]">
                  <div className="min-w-0 flex-1"><div className="font-semibold text-slate-800">{c.label}</div>{c.detail && <div className="text-slate-500 break-words">{c.detail}</div>}</div>
                  <Pill s={c.status} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {ai && (
          <div className="space-y-3 pt-1">
            {ai.search_intent && <div className="text-[12px] text-slate-700">Search intent: <b className="capitalize">{ai.search_intent}</b></div>}
            <Chips title="Related search queries" items={ai.related_queries} />
            <Chips title="Long-tail keywords" items={ai.long_tail} />
            <Chips title="Entities" items={ai.entities} />
            <Chips title="Synonyms" items={ai.synonyms} />
            <Chips title="People Also Ask" items={ai.paa} />
            <Chips title="Supporting articles to write next" items={ai.supporting_queries} />
            {ai.internal_links?.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Internal linking opportunities</div>
                <ul className="space-y-1 text-[12px]">
                  {ai.internal_links.map((l, i) => (
                    <li key={i} className="text-slate-700">
                      <b>“{l.anchor}”</b> → {l.verified && l.url
                        ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline break-all">{l.url}</a>
                        : <span className="text-slate-500">{l.page_idea || 'a relevant page'} <i>(suggestion: no matching page exists yet)</i></span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ai.claims_to_verify?.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Check these statements before publishing</div>
                <ul className="list-disc pl-5 space-y-0.5 text-[12px] text-slate-700">{ai.claims_to_verify.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        {rep?.research_note && <div className="text-[11px] text-slate-500 flex gap-1.5"><Info size={12} className="shrink-0 mt-0.5" />{rep.research_note}</div>}
      </div>
    </div>
  );
}
