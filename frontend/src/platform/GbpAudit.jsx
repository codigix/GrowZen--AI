import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, Sparkles, Copy, ChevronDown, ChevronRight, Lightbulb, ArrowRight } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, useAction, useToast, SkList, ScoreRing } from './SeoUi';
import { api, useApi } from './seoApi';

const TONE = { ok: ['Good', 'green'], warn: ['Improve', 'amber'], bad: ['Fix', 'red'], unknown: ['Not read', 'gray'] };
const IMPACT = { high: 'red', medium: 'amber', low: 'gray' };
const H = 'text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1.5';

function Copyable({ text, toast, label = 'Copy' }) {
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Could not copy: select the text and copy it by hand'); } };
  return <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-12 font-semibold text-indigo-600 hover:underline cursor-pointer"><Copy className="w-3.5 h-3.5" />{label}</button>;
}

/** Where a fix is made and the button that opens it. Nothing is filled in on the other page: the suggestion is copied from here. */
function FixActions({ f }) {
  const navigate = useNavigate();
  if (!f.to) return null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2">
      <span className="text-12 text-slate-500">Where: <b className="text-slate-700">{f.where}</b></span>
      <Button size="sm" variant="primary" icon={ArrowRight} onClick={() => { navigate(f.to); window.scrollTo({ top: 0 }); }}>Fix this</Button>
    </span>
  );
}

function Parameter({ x, open, onToggle, toast, drafts }) {
  const [tone, word] = [TONE[x.status][1], TONE[x.status][0]];
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-xl ring-1 ring-slate-200 bg-white">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
        <Chevron className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="font-semibold text-slate-900 flex-1 min-w-0">{x.label}</span>
        <span className="hidden sm:block text-12 text-slate-500 truncate max-w-[300px]">{x.summary}</span>
        {x.score != null && <span className="text-14 font-bold tabular-nums text-slate-900 w-10 text-right">{x.score}</span>}
        <Badge tone={tone}>{word}</Badge>
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-3 text-13 border-t border-slate-100 pt-3">
          {!x.readable && <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">{x.summary} It is left out of the score, not counted as a failure.</p>}
          {x.found.length > 0 && (
            <div><h4 className={H}>Currently on your profile</h4>
              <dl className="grid gap-1.5 rounded-lg bg-slate-50 px-3 py-2.5">{x.found.map(f => {
                const v = String(f.value); const long = v.length > 90;
                return <div key={f.label} className={long ? 'grid gap-0.5' : 'flex flex-wrap gap-x-2'}><dt className="text-slate-500 shrink-0">{f.label}:</dt><dd className="text-slate-900 font-medium min-w-0 whitespace-pre-line break-words">{v}</dd></div>;
              })}</dl>
            </div>
          )}
          {x.readable && <p className={`font-semibold ${x.issues.length ? 'text-slate-900' : 'text-green-700'}`}>{x.issues.length ? `${x.issues.length} thing${x.issues.length === 1 ? '' : 's'} to fix or improve:` : 'No fix needed here.'}</p>}
          {x.issues.map((q, i) => (
            <div key={i} className={`rounded-lg px-3 py-3 grid gap-2 ${q.severity === 'bad' ? 'bg-red-50 ring-1 ring-red-100' : 'bg-amber-50 ring-1 ring-amber-100'}`}>
              <div className="flex flex-wrap items-start gap-2"><Badge tone={q.severity === 'bad' ? 'red' : 'amber'}>{q.severity === 'bad' ? 'Fix now' : 'Improve'}</Badge><span className="font-semibold text-slate-900 min-w-0 flex-1">{q.title}</span></div>
              {q.detail && <p className="text-slate-800"><b>Problem:</b> {q.detail}</p>}
              {q.fixes.map((f, j) => (
                <div key={j} className="rounded-lg bg-white/80 px-3 py-2 grid gap-1.5">
                  <p className="text-slate-900"><b>Fix:</b> {f.what}</p>
                  {f.example && <span className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-12 text-indigo-900"><Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span className="min-w-0 flex-1 whitespace-pre-line">{f.example}</span><Copyable text={f.example} toast={toast} /></span>}
                  <FixActions f={f} />
                </div>))}
            </div>))}
          {x.tips?.length > 0 && (
            <div className="rounded-lg bg-sky-50 ring-1 ring-sky-100 px-3 py-3 grid gap-1.5">
              <h4 className="text-12 font-semibold uppercase tracking-wide text-sky-800">Ideas to make it even better</h4>
              <ul className="grid gap-1.5 list-disc pl-5 text-slate-800">{x.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {drafts && <Drafts k={x.key} d={drafts} toast={toast} />}
          {x.passed.length > 0 && <p className="text-12 text-slate-500"><b className="text-green-700">Passed:</b> {x.passed.join(' · ')}</p>}
          {x.not_checked.length > 0 && <p className="text-12 text-slate-500"><b>Not checked:</b> {x.not_checked.join(' · ')}</p>}
          <p className="text-12 text-slate-500"><b>Why it matters:</b> {x.gain}</p>
        </div>
      )}
    </div>
  );
}

function Box({ title, children, text, toast }) {
  return <div className="rounded-lg ring-1 ring-violet-200 bg-violet-50/50 px-3 py-2.5 grid gap-1"><div className="flex items-center gap-2"><span className="text-12 font-semibold text-violet-900 flex-1">{title}</span>{text && <Copyable text={text} toast={toast} />}</div>{children}</div>;
}

/** The AI drafts that belong under one parameter. */
function Drafts({ k, d, toast }) {
  if (k === 'description' && d.description) return <Box title={`Draft description (${d.description.length}/750) · written by AI from your facts`} text={d.description} toast={toast}><p className="text-slate-800 whitespace-pre-line">{d.description}</p><p className="text-11 text-slate-500">Read it, correct anything that is not true, then paste it in Edit profile → About.</p></Box>;
  if (k === 'categories' && d.secondary_categories?.length) return <Box title="Secondary categories to consider (AI)" text={d.secondary_categories.join(', ')} toast={toast}><div className="flex flex-wrap gap-1.5">{d.secondary_categories.map(c => <Badge key={c} tone="violet">{c}</Badge>)}</div><p className="text-11 text-slate-500">Pick only the ones that are true. The category picker in Edit profile shows Google’s exact names.</p></Box>;
  if (k === 'services' && d.service_descriptions?.length) return <Box title="Service descriptions (AI)"><ul className="grid gap-2">{d.service_descriptions.map(s => <li key={s.name} className="flex gap-2 items-start"><span className="flex-1 min-w-0"><b>{s.name}:</b> {s.description}</span><Copyable text={s.description} toast={toast} /></li>)}</ul></Box>;
  if (k === 'photos' && d.photo_ideas?.length) return <Box title="Photo ideas for this business (AI)" text={d.photo_ideas.join('\n')} toast={toast}><ul className="list-disc pl-4 text-slate-800">{d.photo_ideas.map((x, i) => <li key={i}>{x}</li>)}</ul></Box>;
  if (k === 'reviews') return (
    <div className="grid gap-2">
      {d.review_request && <Box title="Message to ask for a review (AI)" text={d.review_request} toast={toast}><p className="text-slate-800 whitespace-pre-line">{d.review_request}</p></Box>}
      {d.reply_to_positive && <Box title="Reply to a good review (AI)" text={d.reply_to_positive} toast={toast}><p className="text-slate-800">{d.reply_to_positive}</p></Box>}
      {d.reply_to_negative && <Box title="Reply to a bad review (AI)" text={d.reply_to_negative} toast={toast}><p className="text-slate-800">{d.reply_to_negative}</p></Box>}
    </div>
  );
  if (k === 'visibility' && d.keyword_placement?.length) return <Box title="Where to use your keywords (AI)"><ul className="grid gap-1">{d.keyword_placement.map((x, i) => <li key={i}><b>{x.keyword}</b> → {x.where}</li>)}</ul></Box>;
  return null;
}

/** GMB audit: nine parameters, each scored from real data, with the exact fix. AI drafts are optional and only add text. */
export default function GbpAudit({ b }) {
  const r = useApi(`/businesses/${b.id}/gbp-audit`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [open, setOpen] = useState({});
  const [drafts, setDrafts] = useState(null);
  const d = r.data;
  const refresh = () => run('refresh', async () => { await r.reload(true); toast('Audit refreshed from Google'); });
  const write = () => run('ai', async () => {
    const x = await api(`/businesses/${b.id}/gbp-audit/suggestions`, { method: 'POST' });
    if (x.state !== 'ok') throw new Error(x.message || 'The drafts could not be written.');
    setDrafts(x); toast('Drafts written: open a parameter to read them');
  });
  const isOpen = (x) => open[x.key] ?? (x.status === 'bad' || x.status === 'warn'); // a parameter with a problem opens by itself
  const toggle = (x) => setOpen(o => ({ ...o, [x.key]: !isOpen(x) }));
  const allOpen = d && d.parameters.every(isOpen);
  return (
    <Card title="GMB audit" subtitle="Nine checks of the Google Business Profile, scored from real data, each with what to change. The score is ours, not Google's."
      action={<span className="flex gap-2"><Button size="sm" icon={Sparkles} busy={busy === 'ai'} onClick={write} disabled={!d}>Write drafts with AI</Button><Button size="sm" icon={RefreshCw} busy={busy === 'refresh' || r.loading} onClick={refresh}>Run again</Button></span>}>
      <ErrorNote>{error}</ErrorNote>
      {!d && !r.error && <SkList rows={4} />}
      {r.error && <p className="text-13 text-red-600">{r.error.message}</p>}
      {d && (
        <div className="grid gap-5 text-13">
          <div className="flex flex-wrap items-center gap-6">
            {d.score != null ? <ScoreRing score={d.score} label={d.word} /> : <div className="text-slate-500">No score yet: nothing could be read.</div>}
            <div className="grid gap-2 min-w-0 flex-1">
              <div className="flex flex-wrap gap-2"><Badge tone="green">{d.counts.ok} good</Badge><Badge tone="amber">{d.counts.warn} to improve</Badge><Badge tone="red">{d.counts.bad} to fix</Badge><Badge tone="gray">{d.counts.unknown} not read</Badge></div>
              <p className="text-slate-600">{d.connected ? 'This profile is connected to Google, so every parameter can be read.' : 'This profile is not connected to Google. Description and services cannot be read from outside, so they are left out of the score.'}
                {!d.linked && ' It is also not linked to a Google Maps listing yet, so Maps data was not read.'}</p>
            </div>
          </div>
          <div>
            <div className="flex items-center mb-2"><h4 className={`${H} mb-0 flex-1`}>The nine parameters</h4><button type="button" className="text-12 font-semibold text-indigo-600 hover:underline cursor-pointer" onClick={() => setOpen(Object.fromEntries(d.parameters.map(x => [x.key, !allOpen])))}>{allOpen ? 'Collapse all' : 'Expand all'}</button></div>
            <div className="grid gap-2">{d.parameters.map(x => <Parameter key={x.key} x={x} open={isOpen(x)} onToggle={() => toggle(x)} toast={toast} drafts={drafts} />)}</div>
          </div>
          {d.not_read.some(x => x.label.startsWith('Google Maps')) && <p className="text-12 text-slate-500">Run a scan in <Link to="/rank-tracking/geo" className="text-indigo-600 hover:underline">Map Rank Tracker</Link> to see where you appear on the map.</p>}
          <p className="text-11 text-slate-400">Read on {String(d.read_at).slice(0, 16).replace('T', ' ')} UTC. Scores come from fixed rules. AI only writes the optional drafts, from your own facts, and never changes the score.</p>
        </div>
      )}
      {toastNode}
    </Card>
  );
}
