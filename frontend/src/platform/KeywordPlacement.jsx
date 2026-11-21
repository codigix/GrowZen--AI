import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Eye, Copy, Check, FileSearch } from 'lucide-react';
import { Card, Badge, ErrorNote, SkList, Modal } from './SeoUi';
import { api, useApi } from './seoApi';
import { Act } from './TableBits';

const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const PLACE = { address: 'address', title: 'title', heading: 'heading', description: 'description', subheading: 'section heading', intro: 'first paragraph', text: 'text', image: 'image text' };
const STATUS = { used: ['Used', 'green', 'In a title, heading or address of a page'], weak: ['Weak', 'amber', 'Only in a description'], unused: ['Not used', 'red', 'No page says it yet'] };
const ADD_AT = { title: 'the page title', heading: 'the main heading (H1)', description: 'the meta description', intro: 'the first paragraph', subheading: 'a section heading', text: 'the page text', image: "an image's alt text" };
const scopeTone = { home: 'blue', offer: 'green', blog: 'violet', info: 'gray', policy: 'gray' };

/** Every picked keyword: the pages that use it and where, the page it is meant for, and where else it could go. */
export function KeywordsView({ b, onOpen }) {
  const r = useApi(`/businesses/${b.id}/keyword-placement`);
  const [show, setShow] = useState('all');
  if (r.error) return <Card><ErrorNote>{r.error.message}</ErrorNote></Card>;
  if (!r.data) return <SkList rows={5} />;
  const d = r.data;
  const rows = d.keywords.filter(k => show === 'all' || k.status === show);
  const tab = (id, label) => <button key={id} type="button" onClick={() => setShow(id)} className={`h-7 px-2.5 text-11.5 font-semibold rounded-md cursor-pointer ${show === id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>;
  return (
    <Card pad={false} title="Where each picked keyword is used" subtitle="From the last website scan: the places Google reads most (address, title, heading, description)">
      <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">{tab('all', `All ${d.keywords.length}`)}{tab('used', `Used ${d.counts.used}`)}{tab('weak', `Weak ${d.counts.weak}`)}{tab('unused', `Not used ${d.counts.unused}`)}</div>
        <span className="text-12 text-slate-500">Press <b>Where to add</b> to open the page and see exactly where the keyword goes.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-13 min-w-[860px]">
          <thead className="bg-slate-50 text-11.5 uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Keyword</th><th className="px-3 py-2 text-right">Searches / mo</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Used on</th><th className="px-3 py-2 text-left">Meant for</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(k => {
              const [w, tone, tip] = STATUS[k.status];
              const target = k.meant_for?.url || k.other_fits[0]?.url;
              return (
                <tr key={k.id} className="hover:bg-slate-50 align-top">
                  <td className="px-3 py-2.5 font-semibold text-slate-900 min-w-[170px]">{k.keyword}{k.rank ? <span className="block text-11.5 font-normal text-slate-500">Google position {k.rank}</span> : null}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n0(k.volume)}</td>
                  <td className="px-3 py-2.5" title={tip}><Badge tone={tone}>{w}</Badge></td>
                  <td className="px-3 py-2.5 min-w-[200px]">{k.used_on.length ? <div className="space-y-1">{k.used_on.slice(0, 3).map(u => <div key={u.url} className="text-12.5"><button type="button" onClick={() => onOpen(u.url, k.keyword)} className="font-medium text-indigo-700 hover:underline cursor-pointer">{u.path}</button> <span className="text-slate-500">in {u.places.map(p => PLACE[p]).join(', ')}</span></div>)}{k.used_on.length > 3 && <div className="text-11.5 text-slate-500">+{k.used_on.length - 3} more pages</div>}</div> : <span className="text-slate-400">No page yet</span>}</td>
                  <td className="px-3 py-2.5 text-12.5">{k.meant_for ? <span><button type="button" onClick={() => onOpen(k.meant_for.url, k.keyword)} className="font-medium text-indigo-700 hover:underline cursor-pointer">{k.meant_for.path}</button> <span className="text-slate-500">({k.meant_for.role} keyword)</span></span>
                    : k.other_fits.length ? <span className="text-slate-600">Could go on {k.other_fits.map(f => f.path).join(', ')}</span> : <span className="text-amber-700">{k.kind === 'post' ? 'Needs a blog post' : 'Needs a new page'}</span>}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                    {target ? <Act icon={Eye} tone="indigo" tip="Where to add: open the page and see exactly where this keyword goes." onClick={() => onOpen(target, k.keyword)}>Where to add</Act> : <Link to={`/ai-content-generation/blog?keyword=${encodeURIComponent(k.keyword)}`}><Act icon={FileSearch} tone="violet" tip="Write: a page or post is needed for this keyword." >Write it</Act></Link>}
                  </span></td>
                </tr>);
            })}
            {!rows.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-13 text-slate-500">{d.keywords.length ? 'No keyword in this group.' : 'No keywords are picked yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
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
          {res.keywords.length === 0 && <p className="text-13 text-slate-600">None of your picked keywords belong on this page. {res.scope.takes}</p>}
          <div className="space-y-3">
            {res.keywords.map(k => (
              <div key={k.id} className={`rounded-lg ring-1 p-3 ${k.focus ? 'ring-indigo-300 bg-indigo-50/40' : 'ring-slate-200'}`}>
                <div className="flex flex-wrap items-center gap-2 mb-2"><span className="text-14 font-semibold text-slate-900">{k.keyword}</span><Badge tone={k.role === 'main' ? 'blue' : 'gray'}>{k.role === 'main' ? 'Main keyword' : 'Supporting'}</Badge>{k.volume ? <span className="text-12 text-slate-500">{n0(k.volume)} searches/mo</span> : null}{k.rank ? <span className="text-12 text-slate-500">· position {k.rank}</span> : null}
                  <span className="ml-auto flex flex-wrap gap-1">{[['title', 'Title'], ['heading', 'Heading'], ['description', 'Description'], ['intro', 'First paragraph'], ['subheading', 'Sections']].map(([key, label]) => <Badge key={key} tone={k.used[key] ? 'green' : 'gray'}>{k.used[key] ? '✓ ' : ''}{label}</Badge>)}</span></div>
                {k.to_add.length === 0 ? <p className="text-12.5 text-emerald-700 inline-flex items-center gap-1"><Check size={14} />Already in the places that matter on this page.</p> : (
                  <ul className="space-y-2">{k.to_add.map(a => { const id = `${k.id}-${a.place}`; return (
                    <li key={a.place} className="rounded-md bg-white ring-1 ring-slate-200 px-3 py-2">
                      <div className="text-12.5 text-slate-800"><b>Add it to {ADD_AT[a.place] || a.place}.</b> <span className="text-slate-500">{a.why}</span></div>
                      {a.example && <div className="mt-1.5 flex items-start gap-2"><div className="flex-1 text-12.5 text-slate-900 bg-slate-50 rounded px-2.5 py-1.5 ring-1 ring-slate-200">{a.example}</div><Act icon={copied === id ? Check : Copy} tone="slate" tip="Copy: copy this line to paste on the page." onClick={() => copy(a.example, id)} /></div>}
                    </li>); })}</ul>)}
              </div>))}
          </div>
          <p className="text-11.5 text-slate-500">Suggested lines use only what the software knows about your business: read each one and change it to be true to you. Write for people first: use the keyword once or twice, in plain words.</p>
        </div>)}
    </Modal>
  );
}
