import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Circle, RefreshCw, Sparkles, Plus, Trash2, ChevronDown, ChevronRight, ShieldCheck, Lightbulb } from 'lucide-react';
import { api } from './seoApi';
import { Button, Field, inputCls } from './SeoUi';
import Select from '../components/Select';

/**
 * The ChatGPT-style SEO workflow (backend: services/seo_workflow).
 *  ResearchBriefStep: runs the 8 research stages one by one (progress, result and Retry per stage), then shows the content brief for
 *                     review and editing; Generate Blog sends the confirmed brief and the research with the article.
 *  WorkflowPanel:     after writing, every stage's result kept with the article; an article stage can be run again on its own.
 */
export const STAGES = [
  ['brainstorm', '/brainstorm-content-ideas', 'Brainstorm content ideas', 'research'],
  ['search_intent', '/research-search-intent', 'Search intent research', 'research'],
  ['entities', '/research-entities', 'Entity research', 'research'],
  ['analyze_keyword', '/analyze-keyword', 'Keyword analysis', 'research'],
  ['opportunities', '/insights-opportunities', 'Opportunities', 'research'],
  ['content_gaps', '/insights-content-gaps', 'Content gap analysis', 'research'],
  ['competitors', '/context-competitors', 'Competitor context', 'research'],
  ['content_brief', '/write-content-brief', 'Content brief', 'research'],
  ['write_article', '/write-seo-article', 'SEO article writing', 'article'],
  ['meta_title', '/shorten-meta-title', 'Meta title', 'article'],
  ['meta_description', '/shorten-meta-description', 'Meta description', 'article'],
  ['expert', '/expert', 'Expert review', 'article'],
  ['human', '/human', 'Human writing review', 'article'],
  ['seo_expert', '/seo-expert', 'SEO / AEO / GEO / SXO review', 'article'],
];
const RESEARCH = STAGES.filter(s => s[3] === 'research').map(s => s[0]);
const RETRYABLE = ['meta_title', 'meta_description', 'expert', 'human', 'seo_expert'];

const verified = (basis) => /google|planner|competitor pages|verified/i.test(basis || '') && !/not available|only|no search|no competitor/i.test(basis || '');

function StatusIcon({ s }) {
  if (s === 'done') return <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />;
  if (s === 'failed') return <XCircle size={16} className="text-red-600 shrink-0" />;
  if (s === 'running') return <Loader2 size={16} className="text-indigo-600 animate-spin shrink-0" />;
  return <Circle size={16} className="text-slate-300 shrink-0" />;
}

function Basis({ basis }) {
  if (!basis) return null;
  const v = verified(basis);
  return <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${v ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`} title={v ? 'Uses verified research data' : 'AI suggestion, not verified research'}>{basis}</span>;
}

/** A one-line summary of a stage's output. */
function summary(id, o = {}) {
  const list = (xs, n = 3) => (xs || []).slice(0, n).map(x => (typeof x === 'string' ? x : x.name || x.title || x.h2 || x.keyword)).join(' · ');
  switch (id) {
    case 'brainstorm': return o.angles ? `Angle: ${o.angles[o.recommended || 0]?.title} (${o.angles.length} ideas)` : '';
    case 'search_intent': return o.intent ? `${o.intent} · ${o.format || ''}${o.paa_verified?.length ? ` · ${o.paa_verified.length} real People-Also-Ask` : ''}` : '';
    case 'entities': return o.entities ? `${o.entities.length} entities: ${list(o.entities, 5)}` : '';
    case 'analyze_keyword': return o.primary ? `${o.primary.keyword}: ${o.primary.monthly_searches != null ? `${Number(o.primary.monthly_searches).toLocaleString()} searches/month (Keyword Planner)` : 'no verified volume'} · ${o.long_tail?.length || 0} long-tail ideas` : '';
    case 'opportunities': return list(o.opportunities, 2);
    case 'content_gaps': return list(o.gaps, 2);
    case 'competitors': return o.available ? `${o.pages?.length} top pages read${o.typical_words ? ` · typical length ${o.typical_words.toLocaleString()} words` : ''}` : (o.note || 'Not available');
    case 'content_brief': return o.outline ? `Outline: ${list(o.outline, 4)}` : '';
    case 'write_article': return o.words ? `${o.words.toLocaleString()} words · ${o.used_brief ? 'from the confirmed brief' : 'no research brief'}` : '';
    case 'meta_title': case 'meta_description': return o.note || '';
    case 'expert': case 'human': return o.summary ? `${o.verdict} · ${o.applied || 0} edit(s) applied · ${o.summary}` : '';
    case 'seo_expert': return o.summary ? Object.entries(o.summary).map(([k, v]) => `${v} ${k}`).join(' · ') : '';
    default: return '';
  }
}

function Details({ id, o }) {
  if (!o) return null;
  const Row = ({ t, xs }) => (xs?.length ? <div><span className="font-semibold text-slate-700">{t}: </span>{xs.map(x => (typeof x === 'string' ? x : x.name || x.title || x.issue || x.keyword || JSON.stringify(x))).join(' · ')}</div> : null);
  return (
    <div className="mt-1.5 ml-6 text-[11.5px] text-slate-600 space-y-1 break-words">
      {id === 'search_intent' && <><Row t="Reader goals" xs={o.user_goals} /><Row t="Questions" xs={o.questions} /><Row t="People Also Ask (Google)" xs={o.paa_verified} /><Row t="Related searches (Google)" xs={o.related_verified} />{o.research_note && <div className="text-amber-800">{o.research_note}</div>}</>}
      {id === 'brainstorm' && <Row t="Angles" xs={(o.angles || []).map(a => `${a.title} — ${a.angle}`)} />}
      {id === 'entities' && <><Row t="Entities" xs={o.entities} /><Row t="Synonyms" xs={o.synonyms} /><Row t="Related terms" xs={o.related_terms} /></>}
      {id === 'analyze_keyword' && <><Row t="Secondary" xs={(o.secondary || []).map(s => `${s.keyword} (${s.relevance}${s.monthly_searches != null ? `, ${s.monthly_searches}/mo` : ''})`)} /><Row t="Long-tail" xs={o.long_tail} /><Row t="Does not fit" xs={o.drop} />{o.research_note && <div>{o.research_note}</div>}</>}
      {id === 'opportunities' && <><Row t="Opportunities" xs={o.opportunities} /><Row t="Differentiators" xs={o.differentiators} /></>}
      {id === 'content_gaps' && <><Row t="Gaps" xs={o.gaps} /><Row t="Must cover" xs={o.must_cover} /></>}
      {id === 'competitors' && (o.available ? <><Row t="Pages" xs={(o.pages || []).map(p => `${p.title} (${p.url})`)} /><Row t="Common topics" xs={o.common_topics} /><Row t="Summary" xs={o.summary} /></> : <div>{o.note}</div>)}
      {(id === 'expert' || id === 'human') && <><Row t="Issues" xs={(o.issues || []).map(x => `${x.issue} (${x.severity})`)} /><Row t="Unsupported claims" xs={o.unsupported_claims} /><Row t="Missing topics" xs={o.missing_topics} />
        <Row t="Edits" xs={(o.edits || []).map(e => `${e.applied ? '✔' : '✖'} “${e.find?.slice(0, 60)}…” → “${e.replace?.slice(0, 60)}…”${e.applied ? '' : ` (${e.skipped_because})`}`)} /></>}
      {(id === 'meta_title' || id === 'meta_description') && o.before !== undefined && <div>{o.changed ? <>“{o.before}” → <b>“{o.after}”</b></> : <>“{o.after}”</>}</div>}
    </div>
  );
}

function StageList({ ids, rec, running, onRetry, retryable }) {
  const [open, setOpen] = useState({});
  return (
    <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {ids.map(id => {
        const [, cmd, label] = STAGES.find(s => s[0] === id);
        const r = rec[id] || {};
        const st = running === id ? 'running' : r.status;
        return (
          <li key={id} className="px-3 py-2 text-[12px]">
            <div className="flex items-center gap-2">
              <StatusIcon s={st} />
              <button type="button" className="flex items-center gap-1 font-semibold text-slate-800 cursor-pointer" onClick={() => setOpen(m => ({ ...m, [id]: !m[id] }))} disabled={!r.output}>
                {r.output && Object.keys(r.output).length ? (open[id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}{label}
              </button>
              <span className="font-mono text-[10.5px] text-slate-400">{cmd}</span>
              <span className="ml-auto flex items-center gap-2"><Basis basis={r.basis} />
                {r.status === 'failed' && retryable(id) && <Button size="sm" icon={RefreshCw} disabled={Boolean(running)} onClick={() => onRetry(id)}>Retry</Button>}
              </span>
            </div>
            {st === 'running' && <div className="ml-6 text-[11.5px] text-indigo-700">Running…</div>}
            {r.status === 'failed' && <div className="ml-6 text-[11.5px] text-red-700">{r.error}</div>}
            {r.status === 'done' && <div className="ml-6 text-[11.5px] text-slate-500">{summary(id, r.output)}</div>}
            {open[id] && <Details id={id} o={r.output} />}
          </li>
        );
      })}
    </ol>
  );
}

const lines = (t) => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);

/**
 * Runs the 8 research stages in the background (no brief screen) and returns the workflow to write the article from:
 * { input, data, stages, brief }. A failed stage is retried once; if research still fails, returns null and the article is
 * written without research. onProgress(label, n, total) reports which stage is running.
 */
// Stages that do not need each other's results run at the same time (3 waves instead of 8 one-by-one calls):
// wave 1 reads Google / Keyword Planner and brainstorms; wave 2 uses the search intent and competitor pages; wave 3 writes the brief.
const RESEARCH_WAVES = [
  ['brainstorm', 'search_intent', 'analyze_keyword'],
  ['entities', 'opportunities', 'content_gaps', 'competitors'],
  ['content_brief'],
];

export async function runResearch(b, input, onProgress = () => {}) {
  let c = { input };
  const one = async (id, base) => {
    let r = base;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        r = await api(`/businesses/${b.id}/articles/workflow-stage`, { method: 'POST', body: { stage: id, ctx: base }, timeout: 200000 });
      } catch (e) {
        r = { ...base, stages: { ...(base.stages || {}), [id]: { status: 'failed', error: e.message || String(e), output: {} } } };
      }
      if (r.stages?.[id]?.status === 'done') break;
    }
    return [id, r];
  };
  for (const [n, wave] of RESEARCH_WAVES.entries()) {
    onProgress(wave.map(id => STAGES.find(s => s[0] === id)[2]).join(', '), n + 1, RESEARCH_WAVES.length);
    const results = await Promise.all(wave.map(id => one(id, c)));
    // merge: each stage's own record, the research data it fetched (Google results, competitor pages, Keyword Planner) and the brief
    const merged = { ...c, data: { ...(c.data || {}) }, stages: { ...(c.stages || {}) } };
    for (const [id, r] of results) {
      if (r.stages?.[id]?.status !== 'done') return null;
      merged.stages[id] = r.stages[id];
      Object.assign(merged.data, r.data || {});
      if (r.brief) merged.brief = r.brief;
    }
    c = merged;
  }
  const brief = c.brief;
  if (!brief || (brief.outline || []).filter(s => s.h2?.trim()).length < 2) return null;
  return {
    input: c.input, data: c.data || {}, stages: c.stages || {},
    brief: { ...brief, outline: brief.outline.filter(s => s.h2?.trim()), faqs: (brief.faqs || []).map(q => String(q).trim()).filter(Boolean) },
  };
}

/** Research stages + editable content brief, shown after the title is chosen. */
export function ResearchBriefStep({ b, input, onBack, onGenerate, genBusy, generating, genError }) {
  const [ctx, setCtx] = useState({ input });
  const [running, setRunning] = useState('');
  const [brief, setBrief] = useState(null);
  const started = useRef(false);

  const runFrom = async (startId, base) => {
    let c = base;
    for (const id of RESEARCH.slice(RESEARCH.indexOf(startId))) {
      if (c.stages?.[id]?.status === 'done' && id !== startId) continue;
      setRunning(id);
      try {
        c = await api(`/businesses/${b.id}/articles/workflow-stage`, { method: 'POST', body: { stage: id, ctx: c }, timeout: 200000 });
      } catch (e) {
        c = { ...c, stages: { ...(c.stages || {}), [id]: { status: 'failed', error: e.message || String(e), output: {} } } };
      }
      setCtx(c);
      if (id === 'content_brief' && c.brief) setBrief(c.brief);
      if (c.stages?.[id]?.status !== 'done') break; // stop at a failure: the user retries this stage, then the rest continue
    }
    setRunning('');
  };
  useEffect(() => { if (!started.current) { started.current = true; runFrom(RESEARCH[0], { input }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rec = ctx.stages || {};
  const done = RESEARCH.every(id => rec[id]?.status === 'done');
  const setB = (k, v) => setBrief(x => ({ ...x, [k]: v }));
  const setSec = (i, k, v) => setBrief(x => ({ ...x, outline: x.outline.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const faqs = [...(brief?.faqs || []), '', '', '', '', ''].slice(0, 5);
  const valid = brief && brief.outline?.filter(s => s.h2?.trim()).length >= 2 && faqs.filter(q => q.trim()).length === 5;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="text-[12px] text-slate-500">Step 3 of 3 · Research and content brief. Each stage runs in order; green labels use verified research (Google results, Keyword Planner, competitor pages), grey ones are AI suggestions.</div>
      <StageList ids={RESEARCH} rec={rec} running={running} retryable={() => true} onRetry={id => runFrom(id, ctx)} />

      {brief && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><Lightbulb size={16} className="text-indigo-600" />Content brief <span className="text-[11.5px] font-normal text-slate-500">— review and edit it; the article is written from this.</span></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Angle"><input className={inputCls} value={brief.angle || ''} onChange={e => setB('angle', e.target.value)} /></Field>
            <Field label="Target audience"><input className={inputCls} value={brief.audience || ''} onChange={e => setB('audience', e.target.value)} /></Field>
            <Field label="Search intent">
              <Select className={inputCls} value={brief.intent || 'informational'} onChange={e => setB('intent', e.target.value)}>
                {['informational', 'commercial', 'transactional', 'local', 'navigational'].map(x => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Outline (2 to 4 main H2 sections)</div>
            <div className="space-y-2">
              {brief.outline.map((s, i) => (
                <div key={i} className="rounded-lg bg-white border border-slate-200 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400">H2</span>
                    <input className={inputCls} value={s.h2} onChange={e => setSec(i, 'h2', e.target.value)} />
                    {brief.outline.length > 2 && <button type="button" title="Remove section" className="h-9 w-9 shrink-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer flex items-center justify-center" onClick={() => setB('outline', brief.outline.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
                  </div>
                  <input className={inputCls} placeholder="H3 sub-headings, separated by |" value={(s.h3 || []).join(' | ')} onChange={e => setSec(i, 'h3', e.target.value.split('|').map(x => x.trim()).filter(Boolean))} />
                  <textarea className={`${inputCls} min-h-[56px] py-2`} placeholder="Key points, one per line" value={(s.points || []).join('\n')} onChange={e => setSec(i, 'points', lines(e.target.value))} />
                </div>
              ))}
            </div>
            {brief.outline.length < 4 && <Button size="sm" icon={Plus} className="mt-2" onClick={() => setB('outline', [...brief.outline, { h2: '', h3: [], points: [] }])}>Add section</Button>}
          </div>
          <Field label="WH question (answered directly, at most 750 characters)"><input className={inputCls} value={brief.wh_question || ''} onChange={e => setB('wh_question', e.target.value)} /></Field>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Five FAQs</div>
            <div className="grid grid-cols-1 gap-1.5">{faqs.map((q, i) => <input key={i} className={inputCls} value={q} placeholder={`Question ${i + 1}`} onChange={e => setB('faqs', faqs.map((x, j) => (j === i ? e.target.value : x)))} />)}</div>
          </div>
          <Field label="Must cover (one per line)"><textarea className={`${inputCls} min-h-[72px] py-2`} value={(brief.must_cover || []).join('\n')} onChange={e => setB('must_cover', lines(e.target.value))} /></Field>
          <div className="flex flex-wrap gap-4 text-[12px] text-slate-700">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={brief.business_relevant !== false} onChange={e => setB('business_relevant', e.target.checked)} />The business's services are closely related to this topic</label>
          </div>
          <Field label="Your writing instructions (optional; [company_clientname] becomes the business name)"><textarea className={`${inputCls} min-h-[60px] py-2`} value={brief.instructions || ''} onChange={e => setB('instructions', e.target.value)} /></Field>
        </div>
      )}

      {generating && <div className="text-[11.5px] text-amber-700 font-semibold">An article is being written; wait for it to finish.</div>}
      {genError && <div className="text-[12px] text-red-600">{genError}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onBack} disabled={Boolean(running)}>Back to the title</Button>
        <Button variant="ai" icon={Sparkles} busy={genBusy} disabled={!done || !valid || Boolean(running) || generating}
          onClick={() => onGenerate({ input: ctx.input, data: ctx.data || {}, stages: ctx.stages || {}, brief: { ...brief, outline: brief.outline.filter(s => s.h2?.trim()), faqs: faqs.map(q => q.trim()).filter(Boolean) } })}>
          Generate Blog from this brief
        </Button>
        {!done && !running && <span className="text-[11.5px] text-amber-700">Finish the research stages first (Retry the failed one).</span>}
      </div>
    </div>
  );
}

/** Every stage of the workflow, as kept with the article; article stages can be run again one at a time. */
export function WorkflowPanel({ b, articleId, savedAt, onChanged }) {
  const [wf, setWf] = useState(null);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!articleId) return;
    api(`/businesses/${b.id}/articles/${articleId}/workflow`).then(setWf).catch(e => setError(e.message || String(e)));
  }, [b.id, articleId, savedAt]);
  if (!articleId || !wf) return error ? <div className="text-[12px] text-red-700">{error}</div> : null;
  const rec = wf.stages || {};
  const retry = (id) => {
    setRunning(id); setError('');
    api(`/businesses/${b.id}/articles/${articleId}/workflow/${id}/retry`, { method: 'POST', timeout: 200000 })
      .then(r => { setWf(r.workflow); if (onChanged) onChanged(); })
      .catch(e => setError(e.message || String(e))).finally(() => setRunning(''));
  };
  const ids = STAGES.map(s => s[0]).filter(id => rec[id] || STAGES.find(s => s[0] === id)[3] === 'article');
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><ShieldCheck size={16} className="text-emerald-700" />SEO workflow</div>
      <div className="text-[11.5px] text-slate-500">{wf.brief ? 'Written from the confirmed research brief.' : 'This article was written without the research stages (the article stages still ran).'} Click a stage to see its result; an article stage can be run again on its own (it changes the saved article).</div>
      {error && <div className="text-[12px] text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <StageList ids={ids} rec={rec} running={running} retryable={id => RETRYABLE.includes(id)} onRetry={retry} />
      <div className="flex flex-wrap gap-1.5">
        {RETRYABLE.filter(id => rec[id]?.status === 'done').map(id => <Button key={id} size="sm" icon={RefreshCw} disabled={Boolean(running)} busy={running === id} onClick={() => retry(id)}>Run {STAGES.find(s => s[0] === id)[2].toLowerCase()} again</Button>)}
      </div>
    </div>
  );
}
