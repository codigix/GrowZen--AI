import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { SeoShell, Button } from './SeoUi';
import { api } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const fmtWhen = (iso) => { if (!iso) return ''; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const SEV = { critical: ['Critical', 'bg-red-50 text-red-700'], serious: ['Serious', 'bg-orange-50 text-orange-700'], warning: ['Warning', 'bg-amber-50 text-amber-700'], info: ['Improvement', 'bg-slate-100 text-slate-700'] };
const AUDIENCE = { developer: 'For your web developer or host', owner: 'You can do this yourself' };
const Card = ({ children, className = '' }) => <section className={`bg-white rounded-xl border border-slate-200 shadow-sm min-w-0 ${className}`}>{children}</section>;
const Chip = ({ children, cls = 'bg-slate-100 text-slate-700' }) => <span className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium whitespace-nowrap ${cls}`}>{children}</span>;
const inApp = (link) => !!link && !/^\/(page-xray|website-audit)(\?|$)/.test(link);

function CodeBlock({ blk }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(blk.text); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* clipboard blocked: the text can be selected */ } };
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 bg-slate-50 border-b border-slate-200 px-3.5 py-2.5">
        <div className="min-w-0 flex-1"><div className="text-13 font-semibold text-slate-900">{blk.label}</div>{blk.where && <div className="text-12 text-slate-500 break-words">Put it in: {blk.where}</div>}</div>
        <Button size="sm" variant={ok ? undefined : 'primary'} icon={ok ? Check : undefined} onClick={copy}>{ok ? 'Copied' : 'Copy'}</Button>
      </div>
      <pre className="m-0 p-3.5 text-12.5 leading-relaxed text-slate-800 bg-white overflow-x-auto whitespace-pre-wrap break-words font-mono max-h-[420px]">{blk.text}</pre>
    </div>
  );
}

function Fix({ b }) {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [sol, setSol] = useState(null);
  const [state, setState] = useState('loading'); // loading | working | ready | error
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const started = useRef('');

  const build = useCallback(async (force) => {
    setState('working'); setError('');
    try { const r = await api(`/businesses/${b.id}/growth/actions/${id}/solution`, { method: 'POST', body: {}, timeout: 120000 }); setSol(r.solution); setState('ready'); } catch (e) { setError(e.message || 'The solution could not be worked out.'); setState('error'); }
  }, [b.id, id]);

  useEffect(() => {
    let live = true;
    started.current = '';
    setD(null); setSol(null); setCheck(null); setState('loading');
    api(`/businesses/${b.id}/growth/actions/${id}`).then(r => {
      if (!live) return;
      setD(r);
      if (r.solution) { setSol(r.solution); setState('ready'); } else if (started.current !== id) { started.current = id; build(); }
    }).catch(e => { if (live) { setError(e.message || 'Could not load the task.'); setState('error'); } });
    return () => { live = false; };
  }, [b.id, id, build]);

  const runCheck = async () => {
    setChecking(true); setCheck(null);
    try { const r = await api(`/businesses/${b.id}/growth/actions/${id}/verify`, { method: 'POST', body: {}, timeout: 120000 }); setCheck(r.result); setD(x => ({ ...x, action: r.action })); } catch (e) { setCheck({ passed: null, details: e.message || 'The check could not run.' }); } finally { setChecking(false); }
  };

  if (!d && state === 'error') return <Card className="p-8 text-center max-w-xl mx-auto"><AlertTriangle size={26} className="mx-auto text-red-500" /><p className="mt-2 text-14 text-slate-700">{error}</p><div className="mt-4"><Link to="/growth#issues"><Button icon={ArrowLeft}>Back to issues</Button></Link></div></Card>;
  if (!d) return <div className="space-y-4" role="status" aria-busy="true"><div className="h-24 rounded-xl bg-slate-100 animate-pulse" /><div className="h-64 rounded-xl bg-slate-100 animate-pulse" /></div>;

  const a = d.action;
  const sv = SEV[d.severity] || SEV.warning;
  const done = a.status === 'verified';
  return (
    <div className="space-y-5 max-w-4xl">
      <Link to="/growth#issues" className="inline-flex items-center gap-1.5 text-13 font-semibold text-indigo-600 hover:underline"><ArrowLeft size={14} />All issues</Link>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-2"><Chip cls={sv[1]}>{sv[0]}</Chip>{done && <Chip cls="bg-emerald-50 text-emerald-700"><CheckCircle2 size={12} />Fixed</Chip>}
          {sol?.minutes ? <Chip><Clock size={12} />about {sol.minutes} min</Chip> : null}{sol?.audience && <Chip cls="bg-indigo-50 text-indigo-700">{AUDIENCE[sol.audience] || ''}</Chip>}{sol?.ai_used && <Chip cls="bg-violet-50 text-violet-700"><Sparkles size={12} />AI-written</Chip>}</div>
        <h2 className="text-20 font-semibold text-slate-900 leading-snug">{sol?.title || a.title}</h2>
        <p className="mt-2 text-14 text-slate-600 leading-relaxed">{sol?.summary || a.why}</p>
        {sol?.stack && sol.audience === 'developer' && <p className="mt-2 text-12.5 text-slate-500">Your site: {sol.stack.note}.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {inApp(a.link) && <Link to={a.link}><Button variant="primary" icon={ExternalLink}>Open where it is done</Button></Link>}
          <Button variant={inApp(a.link) ? undefined : 'primary'} icon={checking ? Loader2 : ShieldCheck} disabled={checking} onClick={runCheck}>{checking ? 'Checking the live data…' : 'Check now'}</Button>
        </div>
        {check && (
          <div className={`mt-4 rounded-lg border px-3.5 py-3 text-13 ${check.passed ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : check.passed === false ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-700'}`} role="status">
            <b>{check.passed ? 'Fixed: the live data confirms it.' : check.passed === false ? 'Not fixed yet.' : 'Could not be checked right now.'}</b> {check.details}
          </div>
        )}
      </Card>

      {state === 'working' || state === 'loading' ? (
        <Card className="p-8 text-center"><Loader2 size={26} className="mx-auto animate-spin text-indigo-600" /><p className="mt-3 text-14 font-medium text-slate-800">Working out the exact fix for your site…</p><p className="text-12.5 text-slate-500">Reading your live page and profile; AI writes only the wording.</p></Card>
      ) : state === 'error' ? (
        <Card className="p-6"><div className="flex gap-2 text-14 text-slate-800"><AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" /><div><b>The exact solution could not be built.</b><p className="mt-1 text-13 text-slate-600">{error}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><Button icon={RefreshCw} onClick={() => build()}>Try again</Button></div>
          {arr(a.how).length > 0 && <div className="mt-5"><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">Meanwhile, the general steps</div><ol className="list-decimal pl-5 space-y-1 text-13.5 text-slate-700">{a.how.map((h, i) => <li key={i}>{h}</li>)}</ol></div>}</Card>
      ) : sol && (
        <>
          <Card className="p-5 sm:p-6">
            <h3 className="text-15 font-semibold text-slate-900 mb-3 flex items-center gap-2"><Wrench size={16} className="text-indigo-600" />Do this</h3>
            <ol className="space-y-2.5">{arr(sol.steps).map((s, i) => <li key={i} className="flex gap-3 text-14 text-slate-800 leading-relaxed"><span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-12 font-semibold inline-flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span><span className="min-w-0">{s}</span></li>)}</ol>
          </Card>
          {arr(sol.blocks).length > 0 && <div className="space-y-4">{sol.blocks.map((blk, i) => <CodeBlock key={i} blk={blk} />)}</div>}
          <Card className="p-5 sm:p-6">
            <h3 className="text-15 font-semibold text-slate-900 mb-1">How it is confirmed</h3>
            <p className="text-13.5 text-slate-700">{d.closes_when}</p>
            <p className="mt-1 text-12.5 text-slate-500">Marking it done is never proof: the issue closes only when the live data shows it is fixed. Built {fmtWhen(sol.built_at)}.</p>
            <div className="mt-3"><Button size="sm" icon={RefreshCw} onClick={() => build()}>Build the solution again</Button></div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function GrowthFixPage() {
  return (
    <SeoShell title="Fix guide" subtitle="The exact change for your site, ready to paste, with the live check that confirms it.">
      {(b) => <Fix key={b.id} b={b} />}
    </SeoShell>
  );
}
