import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Sparkles, ChevronDown, FileText, AlignLeft, ListTree, Flag, HelpCircle, Loader2, Check, RefreshCw, Code, Eye, AlertTriangle, Type, AlignJustify } from 'lucide-react';
import { Button, Modal } from './SeoUi';
import { api } from './seoApi';

// SEO fields: the new value goes straight into that field of the editor (review it there, then Save changes)
const FIELD_OPTIONS = [
  { id: 'title', label: 'Regenerate SEO Title', hint: '50–60 characters with the primary keyword; only the title changes', icon: Type },
  { id: 'meta', label: 'Regenerate Meta Description', hint: '150–160 characters; only the meta description changes', icon: AlignJustify }
];
const OPTIONS = [
  { id: 'full', label: 'Regenerate Full Article', hint: 'A new article from the same keywords; the SEO title stays', icon: FileText },
  { id: 'intro', label: 'Regenerate Introduction', hint: 'Only the opening paragraphs', icon: AlignLeft },
  { id: 'section', label: 'Regenerate Selected Section', hint: 'Pick one H2 or H3 section', icon: ListTree },
  { id: 'conclusion', label: 'Regenerate Conclusion', hint: 'Only the closing paragraph(s); contact details stay', icon: Flag },
  { id: 'faqs', label: 'Regenerate FAQs', hint: 'A fresh set of questions and answers', icon: HelpCircle }
];

const PREVIEW = `text-[12.5px] text-slate-800 leading-relaxed
  [&_h1]:text-[17px] [&_h1]:font-extrabold [&_h1]:text-slate-900 [&_h1]:mb-2
  [&_h2]:text-[14.5px] [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-4 [&_h2]:mb-1.5
  [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-3 [&_h3]:mb-1
  [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5
  [&_strong]:font-semibold [&_a]:text-indigo-600 [&_a]:underline`;

/** A new SEO title ("title") or meta description ("meta") from the editor's current values; saves nothing. */
export const regenerateField = (b, articleId, part, body, fields) =>
  api(`/businesses/${b.id}/articles/${articleId}/regenerate`, { method: 'POST', body: { part, body, ...fields } });

const LIMITS = { title: [50, 60], meta: [150, 160] };

/**
 * The SEO title / meta description field: always typed by hand, with a live length check and a ✨ button that asks
 * Claude for a new value (from what is on screen now). Whatever the field holds is what every regeneration uses.
 */
export function SeoField({ kind, value, onChange, onRegenerate, busy, disabled }) {
  const [lo, hi] = LIMITS[kind];
  const n = value.length;
  const ok = n >= lo && n <= hi;
  const input = kind === 'title'
    ? <input className="ai-glass-input w-full h-9 pl-3 pr-11 text-13 rounded placeholder-slate-400 text-slate-900" value={value} onChange={e => onChange(e.target.value)} placeholder="Type your SEO title, or click ✨ to let AI write one" />
    : <textarea rows={2} className="ai-glass-input w-full px-3 py-2.5 pr-11 text-13 rounded placeholder-slate-400 text-slate-900" value={value} onChange={e => onChange(e.target.value)} placeholder="Type your meta description, or click ✨ to let AI write one" />;
  return (
    <label className="block">
      <span className="flex items-center justify-between text-12 font-semibold text-slate-700 mb-1.5">
        <span>{kind === 'title' ? 'SEO title' : 'Meta description'}</span>
        <span className={`text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${!n ? 'text-slate-400' : ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {n} / {lo}–{hi}
        </span>
      </span>
      <span className="relative block">
        {input}
        {onRegenerate && (
          <button type="button" disabled={busy || disabled} onClick={(e) => { e.preventDefault(); onRegenerate(); }}
            title={kind === 'title' ? 'Write a new SEO title with AI' : 'Write a new meta description with AI (matches the SEO title)'}
            className="absolute right-1.5 top-1.5 w-7 h-7 rounded-md inline-flex items-center justify-center text-violet-600 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 cursor-pointer">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          </button>
        )}
      </span>
      <span className="block text-11 text-slate-500 mt-1">
        {busy ? 'Claude AI is writing a new one…'
          : kind === 'title' ? 'Edit it any time. AI regeneration always uses the title in this box.'
            : 'Edit it any time. AI regeneration uses this description and the SEO title above.'}
      </span>
    </label>
  );
}

/** One side of the comparison: the rendered HTML, or the raw HTML. */
function Pane({ title, tone, html, raw }) {
  return (
    <div className={`flex flex-col min-w-0 rounded-xl border ${tone === 'new' ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider rounded-t-xl ${tone === 'new' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`}>{title}</div>
      <div className="p-3 max-h-[52vh] overflow-y-auto">
        {raw
          ? <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700">{html}</pre>
          : <div className={PREVIEW} dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>
  );
}

/**
 * "Regenerate Content" next to HTML Editor / Preview. Claude writes a new version of the chosen part; the user sees
 * the current and the new text side by side, and the editor changes only on "Accept changes" (then Save changes
 * stores it as usual). Nothing is saved, published or scheduled here.
 */
const RegenerateContent = forwardRef(function RegenerateContent({ b, article, body, fields, onField, onAccept, onFieldBusy, toast }, ref) {
  const [menu, setMenu] = useState(false);
  const [job, setJob] = useState(null);  // { part, section_id?, step: 'pick' | 'run' | 'done' | 'error', result?, error? }
  const [sections, setSections] = useState(null);
  const [picked, setPicked] = useState('');
  const [raw, setRaw] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fieldBusy, setFieldBusy] = useState('');  // 'title' | 'meta' while one of them is being written
  const seq = useRef(0);
  const box = useRef(null);
  const running = job?.step === 'run' || Boolean(fieldBusy);

  // SEO title / meta description: written from the editor's current values (unsaved edits included) and put
  // straight into that one field; the body and the other field are not touched, and nothing is saved.
  const runField = async (part) => {
    if (running) return;
    setFieldBusy(part);
    try {
      const r = await regenerateField(b, article.id, part, body, fields);
      onField?.(r.field, r.value);
      toast?.(`New ${r.label.toLowerCase()} (${r.value.length} characters) is in the editor. Review it, then click "Save changes".`);
    } catch (e) {
      toast?.(e.message || String(e));
    } finally { setFieldBusy(''); }
  };

  useEffect(() => {  // close the menu on an outside click
    if (!menu) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  useEffect(() => {
    if (!running) return undefined;
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const run = async (part, section_id) => {
    if (running) return;  // one request at a time
    const mine = ++seq.current;
    setJob({ part, section_id, step: 'run' }); setRaw(false);
    try {
      const result = await api(`/businesses/${b.id}/articles/${article.id}/regenerate`, { method: 'POST', body: { part, section_id: section_id || null, body, ...fields } });  // the on-screen SEO title/meta/keywords lead
      if (mine === seq.current) setJob({ part, section_id, step: 'done', result });
    } catch (e) {
      if (mine === seq.current) setJob({ part, section_id, step: 'error', error: e.message || String(e) });
    }
  };
  const choose = async (id) => {
    setMenu(false);
    if (id !== 'section') { run(id); return; }
    setJob({ part: 'section', step: 'pick' }); setSections(null); setPicked('');
    try {
      const r = await api(`/businesses/${b.id}/articles/${article.id}/regenerate/sections`, { method: 'POST', body: { body } });
      setSections(r.sections);
      setPicked(r.sections[0]?.id || '');
    } catch (e) { setJob({ part: 'section', step: 'error', error: e.message || String(e) }); }
  };
  useEffect(() => { onFieldBusy?.(fieldBusy); }, [fieldBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  // lets the editor start an option directly (the ✨ field buttons, "Regenerate full article" in the title notice)
  useImperativeHandle(ref, () => ({
    run: (part) => (part === 'title' || part === 'meta' ? runField(part) : choose(part)),
    busy: () => running,
    fieldBusy: () => fieldBusy
  }));
  const close = () => { seq.current += 1; setJob(null); };  // a late answer is ignored
  const accept = () => {
    onAccept(job.result.body);
    toast?.(`${job.result.label} replaced in the editor. Click "Save changes" to keep it.`);
    setJob(null);
  };
  const opt = OPTIONS.find(o => o.id === job?.part);

  return (
    <div className="relative" ref={box}>
      <button type="button" disabled={running} onClick={() => setMenu(m => !m)}
        className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 shadow-sm disabled:opacity-60 cursor-pointer">
        {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {fieldBusy === 'title' ? 'Writing SEO title…' : fieldBusy === 'meta' ? 'Writing meta description…' : running ? 'Regenerating…' : 'Regenerate Content'}
        <ChevronDown size={13} className={`transition-transform ${menu ? 'rotate-180' : ''}`} />
      </button>
      {menu && (
        <div className="absolute right-0 z-30 mt-1.5 w-[300px] rounded-xl border border-slate-200 bg-white shadow-xl p-1.5">
          {onField && (
            <>
              <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">SEO fields</div>
              {FIELD_OPTIONS.map(o => (
                <button key={o.id} type="button" onClick={() => { setMenu(false); runField(o.id); }}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-indigo-50 cursor-pointer">
                  <span className="mt-0.5 w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><o.icon size={14} /></span>
                  <span><span className="block text-[12.5px] font-semibold text-slate-900">{o.label}</span><span className="block text-[11px] text-slate-500">{o.hint}</span></span>
                </button>
              ))}
              <div className="px-2.5 pt-1.5 pb-0.5 mt-1 border-t border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Article body</div>
            </>
          )}
          {OPTIONS.map(o => (
            <button key={o.id} type="button" onClick={() => choose(o.id)}
              className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-indigo-50 cursor-pointer">
              <span className="mt-0.5 w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><o.icon size={14} /></span>
              <span><span className="block text-[12.5px] font-semibold text-slate-900">{o.label}</span><span className="block text-[11px] text-slate-500">{o.hint}</span></span>
            </button>
          ))}
          <div className="px-2.5 pt-1.5 pb-1 text-[10.5px] text-slate-400 border-t border-slate-100 mt-1">You review the new text before anything changes.</div>
        </div>
      )}

      {job && (
        <Modal open width="max-w-5xl" title={job.result ? `Review: ${job.result.label}` : opt?.label || 'Regenerate'} onClose={close} footer={
          job.step === 'pick' ? (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" icon={Sparkles} disabled={!picked} onClick={() => run('section', picked)}>Regenerate section</Button>
            </>
          ) : job.step === 'done' ? (
            <>
              <Button onClick={close}>Cancel</Button>
              <Button icon={RefreshCw} onClick={() => run(job.part, job.section_id)}>Regenerate again</Button>
              <Button variant="primary" icon={Check} onClick={accept}>Accept changes</Button>
            </>
          ) : job.step === 'error' ? (
            <>
              <Button onClick={close}>Close</Button>
              {job.part !== 'section' || job.section_id ? <Button variant="primary" icon={RefreshCw} onClick={() => run(job.part, job.section_id)}>Try again</Button> : null}
            </>
          ) : <Button onClick={close}>Cancel</Button>
        }>
          {job.step === 'pick' && (
            <div className="space-y-2 text-[12.5px]">
              <p className="text-slate-600">Pick the section to rewrite. Only its paragraphs change; its heading, sub-headings and lists stay.</p>
              {!sections && <div className="flex items-center gap-2 text-slate-500"><Loader2 size={13} className="animate-spin" /> Reading the sections…</div>}
              {sections && !sections.length && <p className="text-slate-500">This article has no sections to pick.</p>}
              <div className="max-h-[50vh] overflow-y-auto space-y-1">
                {(sections || []).map(s => (
                  <label key={s.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer ${picked === s.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'} ${s.level === 3 ? 'ml-6' : ''}`}>
                    <input type="radio" name="regen-section" checked={picked === s.id} onChange={() => setPicked(s.id)} disabled={!s.paragraphs} />
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.level === 2 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>H{s.level}</span>
                    <span className={`flex-1 ${s.paragraphs ? 'text-slate-800' : 'text-slate-400'}`}>{s.heading}</span>
                    <span className="text-[11px] text-slate-400">{s.paragraphs ? `${s.paragraphs} paragraph${s.paragraphs === 1 ? '' : 's'}` : 'no paragraphs'}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {job.step === 'run' && (
            <div className="py-10 flex flex-col items-center text-center gap-2">
              <Loader2 size={26} className="animate-spin text-indigo-500" />
              <div className="text-[13px] font-semibold text-slate-800">Claude AI is writing a new version…</div>
              <div className="text-[11.5px] text-slate-500">{job.part === 'full' ? 'A full article takes about a minute or two.' : 'This usually takes 10–30 seconds.'} Elapsed {elapsed}s. Your article is not changed.</div>
            </div>
          )}
          {job.step === 'error' && (
            <p className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[12.5px] text-rose-800"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{job.error}</p>
          )}
          {job.step === 'done' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-slate-600">Only <b>{job.result.label}</b> changes. SEO title, meta description, keywords, featured image and schedule stay as they are.</p>
                <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
                  <button type="button" onClick={() => setRaw(false)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold cursor-pointer ${!raw ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}><Eye size={12} /> Preview</button>
                  <button type="button" onClick={() => setRaw(true)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold cursor-pointer ${raw ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'}`}><Code size={12} /> HTML</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Pane title="Current content" html={job.result.current_html} raw={raw} />
                <Pane title="New content" tone="new" html={job.result.new_html} raw={raw} />
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
});

export default RegenerateContent;
