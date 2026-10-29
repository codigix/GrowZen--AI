import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Copy, Check, ArrowRight, Loader2, Mail, Download, PenLine } from 'lucide-react';
import { Card, Button, ErrorNote, useAction } from './SeoUi';
import { api } from './seoApi';
import { pathOf, SEVERITY_TONE } from './siteUtils';

/**
 * AI on the audit report: the audit in plain words with the top 3 actions and a message for the client
 * (POST /copilot/audit-summary), and new titles / meta descriptions for every page that needs one
 * (POST /copilot/rewrite-pages). Both are rule-based until an AI key is set.
 */

function Badge({ ai }) {
  return <span className={`text-10 font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ring-inset ${ai ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{ai ? 'AI' : 'Rules'}</span>;
}

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return <Button size="sm" variant="ghost" icon={done ? Check : Copy} onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>{done ? 'Copied' : label}</Button>;
}

export function AuditSummary({ report, ps, pages, issues, onTab }) {
  const [res, setRes] = useState(null);
  const [showMail, setShowMail] = useState(false);
  const [busy, error, run] = useAction();
  const load = () => run('load', async () => setRes(await api('/copilot/audit-summary', {
    method: 'POST', body: {
      target: report.target, score: report.score, pages: pages.length,
      scores: { ...(ps?.scores || {}), onpage: report.result?.crawl?.score ?? null },
      vitals: ps?.metrics || {},
      issues: issues.slice(0, 150).map(i => ({ code: i.code, level: i.level, area: i.area, title: i.title, fix: i.fix }))
    }
  })));
  useEffect(() => { setRes(null); load(); }, [report.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Sparkles size={15} className="text-violet-600" /> What this audit means {res && <Badge ai={res.source === 'ai'} />}</span>}
      action={<div className="flex gap-1">{res && <Button size="sm" variant="ghost" icon={Mail} onClick={() => setShowMail(m => !m)}>{showMail ? 'Hide' : 'Client message'}</Button>}<Button size="sm" variant="ghost" icon={RefreshCw} busy={busy === 'load'} onClick={load} aria-label="Write again" /></div>}>
      <ErrorNote>{error}</ErrorNote>
      {!res ? <div className="py-4 flex items-center gap-2 text-13 text-slate-500"><Loader2 size={15} className="animate-spin" /> Reading the audit…</div> : (
        <div className="space-y-3">
          <div>
            <div className="text-14.5 font-semibold text-slate-900">{res.headline}</div>
            <p className="mt-0.5 text-13 text-slate-600 leading-relaxed">{res.summary}</p>
          </div>
          {res.actions.length > 0 && (
            <ol className="space-y-2">
              {res.actions.map((a, i) => (
                <li key={a.code + i} className="flex flex-wrap sm:flex-nowrap items-start gap-3 rounded ring-1 ring-inset ring-slate-200 px-3.5 py-2.5">
                  <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-12 font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-13 font-semibold text-slate-900">{a.title}</div>
                    <div className="text-12 text-slate-500">{a.why}</div>
                    <div className="mt-1 flex items-center gap-2 text-11"><span className={`font-bold uppercase px-1.5 py-0.5 rounded ring-1 ring-inset ${SEVERITY_TONE[a.level] || SEVERITY_TONE.info}`}>{a.level}</span><span className="text-slate-400">{a.effort}</span></div>
                  </div>
                  <Button size="sm" icon={ArrowRight} onClick={() => onTab(a.tab)}>Show fix</Button>
                </li>
              ))}
            </ol>
          )}
          {showMail && (
            <div className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2"><span className="text-12 font-semibold text-slate-700">Message for the business owner</span><CopyButton text={res.client_message} /></div>
              <pre className="mt-1.5 text-12.5 text-slate-800 font-sans whitespace-pre-wrap leading-relaxed">{res.client_message}</pre>
            </div>
          )}
          {res.source !== 'ai' && <p className="text-11 text-slate-400">Add an AI key for an AI-written summary and client message.</p>}
        </div>
      )}
    </Card>
  );
}

/** Pages whose title or meta description needs work (same thresholds as the backend). */
const needs = (kind, p) => p.status < 400 && !p.noindex && (kind === 'title' ? (!p.title_length || p.title_length < 25 || p.title_length > 60) : !p.meta_description_length);

export function PageRewrites({ pages, subject }) {
  const [res, setRes] = useState(null);
  const [busy, error, run] = useAction();
  const count = { title: pages.filter(p => needs('title', p)).length, meta: pages.filter(p => needs('meta', p)).length };
  const business = { name: subject?.name || '', category: subject?.primary_category || '', area: subject?.area || '', city: subject?.city || '', phone: subject?.phone || '' };
  const rewrite = (kind) => run(kind, async () => setRes(await api('/copilot/rewrite-pages', {
    method: 'POST', body: {
      kind, business,
      pages: pages.map(p => ({ url: p.url, title: p.title, h1: p.h1, meta_description: p.meta_description, status: p.status, noindex: p.noindex }))
    }
  })));
  const csv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Page', 'Current', 'New'], ...res.rows.map(r => [r.url, r.before, r.after])].map(l => l.map(esc).join(','));
    const href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href, download: `${res.kind === 'title' ? 'titles' : 'meta-descriptions'}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const label = res?.kind === 'title' ? 'title' : 'meta description';
  return (
    <Card title={<span className="inline-flex items-center gap-2"><PenLine size={15} className="text-violet-600" /> Rewrite in one go {res && <Badge ai={res.source === 'ai'} />}</span>}
      subtitle="New titles and meta descriptions for every page that fails the check, ready to paste into the site.">
      <div className="flex flex-wrap gap-2">
        <Button variant={count.title ? 'primary' : 'secondary'} icon={Sparkles} busy={busy === 'title'} disabled={!count.title} onClick={() => rewrite('title')}>Rewrite {count.title} title{count.title === 1 ? '' : 's'}</Button>
        <Button variant={count.meta ? 'primary' : 'secondary'} icon={Sparkles} busy={busy === 'meta'} disabled={!count.meta} onClick={() => rewrite('meta')}>Write {count.meta} meta description{count.meta === 1 ? '' : 's'}</Button>
        {!count.title && !count.meta && <span className="text-12.5 text-emerald-700 self-center">Every page's title and meta description passes.</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {res && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-2"><span className="text-12 text-slate-500">{res.rows.length} new {label}{res.rows.length === 1 ? '' : 's'}</span>{res.rows.length > 0 && <Button size="sm" variant="ghost" icon={Download} onClick={csv}>CSV</Button>}</div>
          <div className="rounded ring-1 ring-inset ring-slate-200 divide-y divide-slate-100">
            {res.rows.map(r => (
              <div key={r.url} className="px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-12 font-semibold text-slate-900 truncate">{pathOf(r.url)}</span><CopyButton text={r.after} /></div>
                {r.before && <div className="text-12 text-slate-400 line-through decoration-slate-300 break-words">{r.before}</div>}
                <div className="text-12.5 text-slate-900 break-words">{r.after} <span className="text-11 text-slate-400 tabular-nums">({r.after.length})</span>{r.source === 'ai' && <span className="ml-1 text-10 font-bold text-violet-600">AI</span>}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
