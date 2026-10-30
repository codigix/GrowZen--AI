import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, Lock, Trash2, Loader2, ArrowRight, Sparkles, BookOpen } from 'lucide-react';
import { api } from '../platform/seoApi';
import { useSeoBusiness } from '../platform/SeoUi';

/**
 * bevisibe Assistant: a chat at the bottom right that answers about the SELECTED project only (its audits,
 * keywords, competitors, Google profile, reviews, what is planned next) and guides the user around the platform.
 * Server: POST /businesses/{id}/assistant, GET /businesses/{id}/assistant/suggestions. The conversation is kept
 * per project for the browser session; switching project switches to that project's own conversation.
 */

const storeKey = (id) => `bevisibe.assistant.${id}`;
const load = (id) => { try { return JSON.parse(sessionStorage.getItem(storeKey(id)) || '[]'); } catch (e) { return []; } };
const save = (id, msgs) => { try { sessionStorage.setItem(storeKey(id), JSON.stringify(msgs.slice(-30))); } catch (e) { /* private window */ } };

/** **bold**, "- " bullets and "1. " lists: the only formatting the assistant uses. */
function Rich({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i} className="font-semibold text-slate-900">{p.slice(2, -2)}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
  return (
    <div className="space-y-1 text-13 leading-relaxed text-slate-700">
      {String(text).split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const bullet = line.match(/^\s*[-•]\s+(.*)/);
        const num = line.match(/^\s*(\d+)\.\s+(.*)/);
        if (bullet) return <div key={i} className="flex gap-2"><span className="text-indigo-400 mt-[7px] w-1 h-1 rounded-full bg-current shrink-0" /><span>{inline(bullet[1])}</span></div>;
        if (num) return <div key={i} className="flex gap-2"><span className="text-indigo-500 font-semibold tabular-nums shrink-0">{num[1]}.</span><span>{inline(num[2])}</span></div>;
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

export default function AssistantWidget() {
  const [business] = useSeoBusiness();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState([]);
  const end = useRef(null);
  const bid = business?.id;

  // Each project has its own conversation: switching project loads that project's.
  useEffect(() => { setMsgs(bid ? load(bid) : []); setIdeas([]); setText(''); }, [bid]);
  useEffect(() => {
    if (!open || !bid) return undefined;
    let live = true;
    api(`/businesses/${bid}/assistant/suggestions`).then(r => live && setIdeas(r.suggestions || [])).catch(() => { });
    return () => { live = false; };
  }, [open, bid]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, open]);
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  const ask = async (question) => {
    const q = String(question || '').trim();
    if (!q || busy || !bid) return;
    const next = [...msgs, { role: 'user', text: q }];
    setMsgs(next); save(bid, next); setText(''); setBusy(true);
    try {
      const last = [...msgs].reverse().find(m => m.role === 'assistant');
      const r = await api(`/businesses/${bid}/assistant`, { method: 'POST', body: { message: q, history: msgs.slice(-8).map(m => ({ role: m.role, text: m.text })), topic: last?.topic || null } });
      const done = [...next, { role: 'assistant', text: r.answer, links: r.links, sources: r.sources, topic: r.topic, mode: r.mode }];
      setMsgs(done); save(bid, done);
    } catch (e) {
      const done = [...next, { role: 'assistant', text: `I couldn't answer that: ${e.message || 'the server did not respond'}. Try again in a moment.`, error: true }];
      setMsgs(done); save(bid, done);
    } finally { setBusy(false); }
  };
  const clear = () => { setMsgs([]); if (bid) save(bid, []); };
  const go = (to) => { navigate(to); if (window.innerWidth < 640) setOpen(false); };

  return (
    <>
      {open && (
        <section aria-label="bevisibe Assistant" className="fixed z-[65] right-4 bottom-24 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] h-[min(640px,calc(100vh-8rem))] flex flex-col rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <header className="bg-topbar text-white px-4 py-3 flex items-center gap-3 shrink-0">
            <span className="w-9 h-9 rounded-full bg-white flex items-center justify-center p-1.5 shrink-0"><img src="/bevisibe-icon.png" alt="" className="w-full h-full object-contain" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-14 font-bold leading-tight">bevisibe Assistant</div>
              <div className="text-11.5 text-topbar-item truncate flex items-center gap-1"><Lock size={10} className="shrink-0" />{bid ? <>Only <b className="text-white font-semibold truncate">{business.name}</b></> : 'Select a project'}</div>
            </div>
            {msgs.length > 0 && <button type="button" onClick={clear} title="Clear this conversation" aria-label="Clear conversation" className="p-1.5 rounded text-topbar-item hover:text-white hover:bg-white/10 cursor-pointer"><Trash2 size={15} /></button>}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="p-1.5 rounded text-topbar-item hover:text-white hover:bg-white/10 cursor-pointer"><X size={17} /></button>
          </header>

          <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4 space-y-3">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-lg bg-white shadow-card px-4 py-3">
                  <div className="text-14 font-semibold text-slate-900 flex items-center gap-1.5"><Sparkles size={15} className="text-indigo-500" /> Hi, I'm your project guide</div>
                  <p className="text-13 text-slate-600 mt-1">I know <b>{business?.name || 'the selected project'}</b>: its audits, keywords, competitors, Google profile, reviews and what's planned next. I also show you how to use every page. I never use another project's data.</p>
                </div>
                <div className="text-11 font-semibold uppercase tracking-wider text-slate-400">Try asking</div>
                <div className="flex flex-col gap-1.5">
                  {ideas.map(i => <button key={i} type="button" onClick={() => ask(i)} className="text-left text-13 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-700 cursor-pointer transition-colors">{i}</button>)}
                  <button type="button" onClick={() => ask('How does this platform work?')} className="text-left text-13 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100 cursor-pointer inline-flex items-center gap-2"><BookOpen size={14} /> Show me how the platform works</button>
                </div>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-lg rounded-br-sm bg-indigo-500 text-white text-13 px-3.5 py-2 whitespace-pre-wrap">{m.text}</div></div>
            ) : (
              <div key={i} className="flex gap-2">
                <span className="w-7 h-7 rounded-full bg-white shadow-card flex items-center justify-center p-1 shrink-0 mt-0.5"><img src="/bevisibe-icon.png" alt="" className="w-full h-full object-contain" /></span>
                <div className={`min-w-0 max-w-[88%] rounded-lg rounded-tl-sm bg-white shadow-card px-3.5 py-2.5 ${m.error ? 'ring-1 ring-red-200' : ''}`}>
                  <Rich text={m.text} />
                  {m.links?.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{m.links.map(l => <button key={l.to} type="button" onClick={() => go(l.to)} className="h-7 px-2.5 rounded text-12 font-semibold border border-indigo-200 text-indigo-600 hover:bg-indigo-50 inline-flex items-center gap-1 cursor-pointer">{l.label}<ArrowRight size={11} /></button>)}</div>}
                  {m.sources?.length > 0 && <div className="mt-2 text-10.5 text-slate-400">Based on: {m.sources.join(', ')}{m.mode === 'ai' ? ' · AI' : ''}</div>}
                </div>
              </div>
            ))}
            {busy && <div className="flex gap-2 items-center text-12 text-slate-500"><span className="w-7 h-7 rounded-full bg-white shadow-card flex items-center justify-center"><Loader2 size={14} className="animate-spin text-indigo-500" /></span>Checking {business?.name}…</div>}
            <div ref={end} />
          </div>

          <form onSubmit={e => { e.preventDefault(); ask(text); }} className="border-t border-slate-200 bg-white p-3 flex items-end gap-2 shrink-0">
            <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }} rows={1} maxLength={1000} disabled={!bid}
              placeholder={bid ? `Ask about ${business.name}…` : 'Select a project first'} aria-label="Your question"
              className="flex-1 resize-none max-h-28 min-h-[38px] px-3 py-2 text-13 rounded border border-slate-200 bg-white text-slate-800 focus:border-indigo-400 outline-none" />
            <button type="submit" disabled={!text.trim() || busy || !bid} aria-label="Send" className="h-[38px] w-[38px] rounded bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"><Send size={15} /></button>
          </form>
        </section>
      )}

      <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Close bevisibe Assistant' : 'Open bevisibe Assistant'} title="bevisibe Assistant"
        className="fixed z-[65] right-4 sm:right-6 bottom-6 w-14 h-14 rounded-full bg-topbar shadow-xl  ring-white flex items-center justify-center cursor-pointer hover:scale-105 transition-transform">
        {open ? <X size={25} className="text-white" /> : <><img src="/bevisibe-icon.png" alt="" className="w-8 h-8 object-contain bg-white rounded-full p-1" /><span className="absolute -top-1 -right-1 text-9 font-bold px-1.5 py-0.5 rounded-full bg-indigo-500 text-white ring-2 ring-white">AI</span></>}
      </button>
    </>
  );
}
