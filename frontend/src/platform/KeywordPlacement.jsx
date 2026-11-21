import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Eye, Copy, Check, FileSearch, Sparkles } from 'lucide-react';
import { Card, Badge, ErrorNote, SkList, Modal } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act } from './TableBits';
import BriefButtons from './DevBrief';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const PLACE = { address: 'address', title: 'title', heading: 'heading', description: 'description', subheading: 'section heading', intro: 'first paragraph', text: 'text', image: 'image text' };
const STATUS = { used: ['Used', 'green', 'In a title, heading or address of a page'], weak: ['Weak', 'amber', 'Only in a description'], unused: ['Not used', 'red', 'No page says it yet'] };
const ADD_AT = { title: 'the page title', heading: 'the main heading (H1)', description: 'the meta description', intro: 'the first paragraph', subheading: 'a section heading', text: 'the page text', image: "an image's alt text" };
const scopeTone = { home: 'blue', offer: 'green', blog: 'violet', info: 'gray', policy: 'gray' };

/** Every picked keyword: where it is used, the page it is meant for, and what to use it for (page, FAQ, meta data, blog, Google post, Google profile, AI questions) with the exact thing to add. */
export function KeywordsView({ b, onOpen }) {
  const r = useApi(`/businesses/${b.id}/keyword-placement`);
  const [show, setShow] = useState('all');
  const [open, setOpen] = useState(null); // { id, key }: the suggestion shown under a keyword
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!r.data) return <SkList rows={5} />;
  const d = r.data;
  const rows = d.keywords.filter(k => show === 'all' || k.status === show);
  const tab = (id, label) => <button key={id} type="button" onClick={() => setShow(id)} className={`h-7 px-2.5 text-11.5 font-semibold rounded-md cursor-pointer ${show === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>;
  const setPlan = async (k, key, on) => {
    const planned = k.purposes.filter(p => p.planned && p.key !== key).map(p => p.key);
    setBusy(`${k.id}-${key}`);
    try { await api(`/businesses/${b.id}/keywords/${k.id}`, { method: 'PATCH', body: { keyword: k.keyword, uses: on ? [...planned, key] : planned } }); await r.reload(true); } catch (e) { setNote(e.message); } finally { setBusy(''); }
  };
  const askAi = async (k) => {
    setBusy(`${k.id}-geo`);
    try { const out = await api(`/businesses/${b.id}/keywords/${k.id}/geo-prompt`, { method: 'POST', body: {} }); setNote(out.added ? 'Added to the AI search questions.' : 'It is already one of the AI search questions.'); await r.reload(true); } catch (e) { setNote(e.message); } finally { setBusy(''); }
  };
  const copy = async (text, id) => { try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1800); } catch { /* the text is shown */ } };
  const chip = (k, p) => {
    const on = open?.id === k.id && open.key === p.key;
    return (
      <button key={p.key} type="button" onClick={() => setOpen(on ? null : { id: k.id, key: p.key })} aria-expanded={on}
        title={p.used ? 'Already used here' : p.planned ? 'Planned: not done yet' : 'Not used here yet'}
        className={`h-7 px-2.5 rounded-full text-12 font-semibold cursor-pointer inline-flex items-center gap-1 ring-1 ring-inset transition-colors ${on ? 'bg-indigo-600 text-white ring-indigo-600' : p.used ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : p.planned ? 'bg-indigo-50 text-indigo-800 ring-indigo-200' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'}`}>
        {p.used ? <Check size={12} /> : null}{p.label}{!p.used && p.planned ? <span className="text-10 font-medium opacity-80">planned</span> : null}
      </button>
    );
  };
  const suggestion = (k) => {
    const p = k.purposes.find(x => x.key === open.key);
    if (!p) return null;
    const id = `${k.id}-${p.key}`;
    const action = p.to.kind === 'page' ? <Act icon={Eye} tone="indigo" tip="Open the page overview and see exactly where it goes." onClick={() => onOpen(p.to.url, k.keyword)}>{p.cta}</Act>
      : p.to.kind === 'geo' ? <Act icon={Sparkles} tone="violet" busy={busy === `${k.id}-geo`} tip="Add this question to the AI search tracker." onClick={() => askAi(k)}>{p.cta}</Act>
        : p.to.kind === 'none' ? null : <Link to={p.to.href}><Act icon={ExternalLink} tone="indigo" tip={`${p.cta}: open the right place with the keyword ready.`}>{p.cta}</Act></Link>;
    return (
      <div className="rounded-lg ring-1 ring-indigo-200 bg-indigo-50/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2"><span className="text-13 font-semibold text-slate-900">{p.label}: {p.headline}</span>{p.used && <Badge tone="green">Already used</Badge>}{!p.used && p.planned && <Badge tone="blue">Planned</Badge>}</div>
        <div className="mt-1.5 flex items-start gap-2"><pre className="flex-1 whitespace-pre-wrap text-12.5 text-slate-800 bg-white rounded px-3 py-2 ring-1 ring-slate-200 font-sans">{p.text}</pre><Act icon={copied === id ? Check : Copy} tone="slate" tip="Copy: copy this text to paste where it goes." onClick={() => copy(p.text, id)} /></div>
        <div className="mt-2 flex flex-wrap items-center gap-2">{action}
          <Act tone="slate" busy={busy === id} tip={p.planned ? 'Remove it from the plan for this keyword.' : 'Plan: mark this as something you will do for this keyword.'} onClick={() => setPlan(k, p.key, !p.planned)}>{p.planned ? 'Remove from plan' : 'Plan it'}</Act></div>
      </div>
    );
  };
  return (
    <Card pad={false} title="Your picked keywords" subtitle="Where each is used, the page it is meant for, and what to use it for. Pick a purpose under a keyword to see exactly what to add.">
      <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">{tab('all', `All ${d.keywords.length}`)}{tab('used', `Used ${d.counts.used}`)}{tab('weak', `Weak ${d.counts.weak}`)}{tab('unused', `Not used ${d.counts.unused}`)}</div>
        <span className="text-12 text-slate-500">Green = already used there · blue = planned · grey = not yet</span>
        {note && <span role="status" className="ml-auto text-12.5 text-emerald-800 bg-emerald-50 rounded px-2.5 py-1">{note}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[820px]">
          <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Keyword</th><th className="px-3 py-2 text-right">Searches / mo</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Used on</th><th className="px-3 py-2 text-left">Meant for</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
          {rows.map(k => {
            const [w, tone, tip] = STATUS[k.status];
            const target = k.meant_for?.url || k.other_fits[0]?.url;
            return (
              <tbody key={k.id} className="border-t border-slate-200">
                <tr className="hover:bg-slate-50 align-top">
                  <td className="px-3 pt-2.5 pb-1 font-semibold text-slate-900 min-w-[170px]">{k.keyword}{k.rank ? <span className="block text-11.5 font-normal text-slate-500">Google position {k.rank}</span> : null}</td>
                  <td className="px-3 pt-2.5 pb-1 text-right tabular-nums">{n0(k.volume)}</td>
                  <td className="px-3 pt-2.5 pb-1" title={tip}><Badge tone={tone}>{w}</Badge></td>
                  <td className="px-3 pt-2.5 pb-1 min-w-[200px]">{k.used_on.length ? <div className="space-y-1">{k.used_on.slice(0, 3).map(u => <div key={u.url} className="text-12.5"><button type="button" onClick={() => onOpen(u.url, k.keyword)} className="font-medium text-indigo-700 hover:underline cursor-pointer">{u.path}</button> <span className="text-slate-500">in {u.places.map(p => PLACE[p]).join(', ')}</span></div>)}{k.used_on.length > 3 && <div className="text-11.5 text-slate-500">+{k.used_on.length - 3} more pages</div>}</div> : <span className="text-slate-400">No page yet</span>}</td>
                  <td className="px-3 pt-2.5 pb-1 text-12.5">{k.meant_for ? <span><button type="button" onClick={() => onOpen(k.meant_for.url, k.keyword)} className="font-medium text-indigo-700 hover:underline cursor-pointer">{k.meant_for.path}</button> <span className="text-slate-500">({k.meant_for.role} keyword)</span></span>
                    : k.other_fits.length ? <span className="text-slate-600">Could go on {k.other_fits.map(f => f.path).join(', ')}</span> : <span className="text-amber-700">{k.kind === 'post' ? 'Needs a blog post' : 'Needs a new page'}</span>}</td>
                  <td className="px-3 pt-2.5 pb-1 text-right whitespace-nowrap">{target ? <Act icon={Eye} tone="indigo" tip="Where to add: open the page and see exactly where this keyword goes." onClick={() => onOpen(target, k.keyword)}>Where to add</Act> : <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(k.keyword)}`}><Act icon={FileSearch} tone="violet" tip="Write: a page or post is needed for this keyword.">Write it</Act></Link>}</td>
                </tr>
                <tr><td colSpan={6} className="px-3 pb-3">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="text-11.5 font-semibold uppercase tracking-wide text-slate-500 mr-1">Use it for</span>{k.purposes.map(p => chip(k, p))}</div>
                  {open?.id === k.id && <div className="mt-2">{suggestion(k)}</div>}
                </td></tr>
              </tbody>);
          })}
          {!rows.length && <tbody><tr><td colSpan={6} className="px-5 py-8 text-center text-13 text-slate-500">{d.keywords.length ? 'No keyword in this group.' : 'No keywords are picked yet.'}</td></tr></tbody>}
        </table>
      </div>
    </Card>
  );
}

const STOP = new Set(['in', 'near', 'me', 'the', 'best', 'top', 'for', 'a', 'an', 'of', 'and', 'to', 'at', 'on', 'with', 'by', 'cheap', 'affordable', 'my', 'your', 'nearby', 'online', 'is', 'are', 'how', 'what']);
const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
/** A text with the words of the chosen keywords marked: the main one strongly, the others lightly. */
function Highlight({ text, focus = [], others = [] }) {
  if (!text) return null;
  const f = new Set(focus.map(stem)), o = new Set(others.map(stem));
  return <>{String(text).split(/(\s+)/).map((tok, i) => {
    const w = stem(tok.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''));
    if (!w || STOP.has(w)) return <React.Fragment key={i}>{tok}</React.Fragment>;
    return f.has(w) ? <mark key={i} className="bg-amber-200 text-slate-900 rounded px-0.5">{tok}</mark> : o.has(w) ? <mark key={i} className="bg-indigo-100 text-slate-900 rounded px-0.5">{tok}</mark> : <React.Fragment key={i}>{tok}</React.Fragment>;
  })}</>;
}

/** One page read live: what it says, the picked keywords it should carry, and where to add each missing one, with a line to paste. */
export function PageOverview({ b, target, onClose }) {
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!target) return undefined;
    let live = true;
    setRes(null); setErr('');
    api(`/businesses/${b.id}/keyword-placement/page`, { method: 'POST', body: { url: target.url, focus: target.focus || null }, timeout: 90000 }).then(r => { if (live) setRes(r); }).catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [target, b.id]);
  const copy = async (text, id) => { try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1800); } catch { /* the line is shown */ } };
  return (
    <Modal open={Boolean(target)} onClose={onClose} width="max-w-4xl" title={target ? `Page overview: ${(target.url || '').replace(/^https?:\/\/[^/]+/, '') || '/'}` : ''}>
      {target && !res && !err && <p className="text-13 text-slate-500">Reading the page on your website…</p>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {res && (
        <div className="max-h-[72vh] overflow-y-auto pr-1 space-y-4">
          <div className="rounded-lg ring-1 ring-slate-200 p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={scopeTone[res.scope.kind] || 'gray'}>{res.scope.label}</Badge><a href={res.url} target="_blank" rel="noreferrer" className="text-12.5 text-indigo-700 hover:underline inline-flex items-center gap-1">{res.url}<ExternalLink size={11} /></a><span className="text-12 text-slate-500">{res.words} words · {res.images} images{res.images_without_alt ? ` (${res.images_without_alt} without alt text)` : ''}</span></div>
            <p className="text-12.5 text-slate-600"><b>What belongs here:</b> {res.scope.takes}</p>
            <div className="text-12.5 text-slate-700 space-y-0.5"><div><b>Title:</b> {res.title || <i className="text-slate-400">none</i>}</div><div><b>Description:</b> {res.description || <i className="text-slate-400">none</i>}</div><div><b>Main heading:</b> {res.h1.join(' | ') || <i className="text-slate-400">none</i>}</div>
              {res.headings.length > 0 && <div><b>Sections:</b> {res.headings.join(' · ')}</div>}</div>
          </div>
          {res.notes.map(n => <p key={n} className="text-12.5 text-amber-900 bg-amber-50 rounded px-3 py-1.5">{n}</p>)}
          {(() => {
            const focusKw = res.keywords.find(k => k.focus) || res.keywords.find(k => k.role === 'main');
            const focus = focusKw?.words || [];
            const others = res.keywords.filter(k => k !== focusKw).flatMap(k => k.words || []);
            const c = res.content;
            const row = (label, children) => <div className="grid grid-cols-[110px_1fr] gap-3 py-1.5 border-t border-slate-100 first:border-t-0"><div className="text-11.5 font-semibold uppercase tracking-wide text-slate-400 pt-0.5">{label}</div><div className="text-13 text-slate-800 leading-relaxed">{children}</div></div>;
            const none = <i className="text-slate-400">none</i>;
            return (
              <div className="rounded-lg ring-1 ring-slate-200 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 py-1.5"><span className="text-13 font-semibold text-slate-900">What the page says now</span>
                  {focusKw && <span className="text-12 text-slate-500">words of <mark className="bg-amber-200 rounded px-1">{focusKw.keyword}</mark> are marked{others.length ? <>, the other picked keywords <mark className="bg-indigo-100 rounded px-1">lightly</mark></> : null}</span>}</div>
                {row('Title', c.title ? <Highlight text={c.title} focus={focus} others={others} /> : none)}
                {row('Description', c.description ? <Highlight text={c.description} focus={focus} others={others} /> : none)}
                {row('Main heading', c.h1.length ? c.h1.map((h, i) => <div key={i}><Highlight text={h} focus={focus} others={others} /></div>) : none)}
                {row('Sections', c.headings.length ? <ul className="list-disc pl-4 space-y-0.5">{c.headings.map((h, i) => <li key={i}><Highlight text={h} focus={focus} others={others} /></li>)}</ul> : none)}
                {row('Text', c.paragraphs.length ? <div className="space-y-2">{c.paragraphs.slice(0, 6).map((p, i) => <p key={i}><Highlight text={p} focus={focus} others={others} /></p>)}{c.paragraphs.length > 6 && <p className="text-12 text-slate-400">+ {c.paragraphs.length - 6} more paragraphs</p>}</div> : <span className="text-slate-400">No paragraphs could be read ({res.words} words). {res.words < 40 ? 'The text is loaded by JavaScript.' : ''}</span>)}
              </div>);
          })()}
          {res.keywords.length === 0 && <p className="text-13 text-slate-600">None of your picked keywords belong on this page. {res.scope.takes}</p>}
          <div className="space-y-3">
            {res.keywords.map(k => (
              <div key={k.id} className={`rounded-lg ring-1 p-3 ${k.focus ? 'ring-indigo-300 bg-indigo-50/40' : 'ring-slate-200'}`}>
                <div className="flex flex-wrap items-center gap-2 mb-2"><span className="text-14 font-semibold text-slate-900">{k.keyword}</span><Badge tone={k.role === 'main' ? 'blue' : 'gray'}>{k.role === 'main' ? 'Main keyword' : 'Supporting'}</Badge>{k.volume ? <span className="text-12 text-slate-500">{n0(k.volume)} searches/mo</span> : null}{k.rank ? <span className="text-12 text-slate-500">· position {k.rank}</span> : null}
                  <span className="ml-auto flex flex-wrap gap-1">{[['title', 'Title'], ['heading', 'Heading'], ['description', 'Description'], ['intro', 'First paragraph'], ['subheading', 'Sections']].map(([key, label]) => <Badge key={key} tone={k.used[key] ? 'green' : 'gray'}>{k.used[key] ? '✓ ' : ''}{label}</Badge>)}</span></div>
                {k.warning && <p className="mb-2 text-12.5 text-amber-900 bg-amber-50 rounded px-3 py-1.5">⚠ {k.warning}</p>}
                {k.to_add.length === 0 ? <p className="text-12.5 text-emerald-700 inline-flex items-center gap-1"><Check size={14} />Already in the places that matter on this page.</p> : (
                  <ul className="space-y-2">{k.to_add.map(a => { const id = `${k.id}-${a.place}`; return (
                    <li key={a.place} className="rounded-md bg-white ring-1 ring-slate-200 px-3 py-2">
                      <div className="text-12.5 text-slate-800"><b>{a.current ? 'Replace' : 'Add'} {ADD_AT[a.place] || a.place}.</b> <span className="text-slate-500">{a.why}</span></div>
                      {a.current && <div className="mt-1.5 grid grid-cols-[60px_1fr] gap-2 items-start"><span className="text-11.5 font-semibold uppercase tracking-wide text-red-500 pt-1.5">Now</span><div className="text-12.5 text-slate-600 bg-red-50/50 rounded px-2.5 py-1.5 ring-1 ring-red-100 line-through decoration-red-300"><Highlight text={a.current} focus={k.words} /></div></div>}
                      {a.example && <div className="mt-1.5 grid grid-cols-[60px_1fr] gap-2 items-start"><span className="text-11.5 font-semibold uppercase tracking-wide text-emerald-600 pt-1.5">{a.current ? 'Change to' : 'Add'}</span><div className="flex items-start gap-2"><div className="flex-1 text-12.5 text-slate-900 bg-emerald-50/60 rounded px-2.5 py-1.5 ring-1 ring-emerald-100"><Highlight text={a.example} focus={k.words} /></div><Act icon={copied === id ? Check : Copy} tone="slate" tip="Copy: copy this text to paste on the page." onClick={() => copy(a.example, id)} /></div></div>}
                    </li>); })}</ul>)}
              </div>))}
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-indigo-50/60 ring-1 ring-indigo-100 px-4 py-2.5"><span className="text-12.5 text-slate-700">Send this page's changes to your developer:</span><BriefButtons b={b} page={res.url} size="sm" /></div>
          <p className="text-11.5 text-slate-500">Suggested lines use only what the software knows about your business: read each one and change it to be true to you. Write for people first: use the keyword once or twice, in plain words.</p>
        </div>)}
    </Modal>
  );
}
