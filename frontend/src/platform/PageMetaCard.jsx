import React, { useState } from 'react';
import { ClipboardCheck, Download, Copy, Check } from 'lucide-react';
import { Card, Button, Badge, ErrorNote } from './SeoUi';
import { api } from './seoApi';
import { downloadCsv, downloadFile } from './DataTable';

const inputCls = 'w-full rounded-md ring-1 ring-slate-300 bg-white px-2.5 py-1.5 text-13 focus:outline-none focus:ring-2 focus:ring-indigo-400';
const rate = (n, lo, hi) => (n >= lo && n <= hi ? 'text-emerald-700' : 'text-amber-700');

const download = (name, text, type = 'text/plain') => downloadFile(name, text, type);

/** Titles, descriptions, headings and canonical addresses for every page, for a site whose pages all send the same ones. Written from each page's main keyword and the profile; edited here; downloaded to put on the site. */
export default function PageMetaCard({ b, sharedNote }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [files, setFiles] = useState(null);
  const [copied, setCopied] = useState(false);
  const write = async () => {
    setBusy(true); setErr(''); setFiles(null);
    try { const r = await api(`/businesses/${b.id}/page-meta`, { method: 'POST', timeout: 120000 }); setRows(r.pages); }
    catch (e) { setErr(e.message || 'The titles could not be written.'); } finally { setBusy(false); }
  };
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, proposed: { ...r.proposed, [k]: v } } : r)));
  const make = async () => {
    setErr('');
    try { setFiles(await api(`/businesses/${b.id}/page-meta/files`, { method: 'POST', body: { pages: rows.map(r => ({ path: r.path, ...r.proposed })) } })); }
    catch (e) { setErr(e.message); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(files.react); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code is shown below */ } };
  return (
    <Card title="Page titles and descriptions" subtitle={sharedNote ? 'Your pages all send the same title and description: write one for each page' : 'A title, description, heading and canonical address for every page'}
      action={<Button variant="primary" size="sm" icon={ClipboardCheck} busy={busy} onClick={write}>{rows ? 'Write again' : 'Write them for my pages'}</Button>}>
      {!rows && !busy && <p className="text-13 text-slate-600">Writes a title (30 to 60 characters), a description (70 to 160), a main heading and the page's own canonical address for each page, from the page's main keyword and your business profile. You edit them here, download a file and put it on your site. Takes about half a minute.</p>}
      {busy && <p className="text-13 text-slate-500">Writing the titles…</p>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {rows && (
        <div className="space-y-3">
          <p className="text-12.5 text-slate-600">Check every line is true before you use it: only what the software knows about your business is used. Green numbers fit what Google shows in full.</p>
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <div key={r.path} className="rounded-lg ring-1 ring-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2"><span className="text-13 font-semibold text-slate-900">{r.path}</span>{r.primary && <Badge tone="blue">main keyword: {r.primary}</Badge>}{r.problems.map(p => <Badge key={p} tone="amber">{p}</Badge>)}</div>
                <label className="block text-11.5 text-slate-500 mb-0.5">Title <span className={`tabular-nums ${rate(r.proposed.title.length, 30, 60)}`}>{r.proposed.title.length}/60</span></label>
                <input className={inputCls} value={r.proposed.title} onChange={e => set(i, 'title', e.target.value)} aria-label={`Title for ${r.path}`} />
                <label className="block text-11.5 text-slate-500 mt-2 mb-0.5">Description <span className={`tabular-nums ${rate(r.proposed.description.length, 70, 160)}`}>{r.proposed.description.length}/160</span></label>
                <textarea rows={2} className={inputCls} value={r.proposed.description} onChange={e => set(i, 'description', e.target.value)} aria-label={`Description for ${r.path}`} />
                <label className="block text-11.5 text-slate-500 mt-2 mb-0.5">Main heading (H1)</label>
                <input className={inputCls} value={r.proposed.h1} onChange={e => set(i, 'h1', e.target.value)} aria-label={`Heading for ${r.path}`} />
                <p className="mt-1.5 text-11.5 text-slate-500 truncate" title={r.current.title}>Now: {r.current.title || 'no title'}{r.current.h1 ? '' : ' · no heading'}</p>
              </div>))}
          </div>
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="primary" icon={Download} onClick={make}>Create the files</Button><Button size="sm" icon={Download} onClick={() => downloadCsv(`page-titles-and-descriptions-${b.name}`, ['Page', 'Main keyword', 'Title', 'Title length', 'Description', 'Description length', 'Main heading (H1)', 'Current title', 'Current heading', 'Problems'], rows.map(r => [r.path, r.primary || '', r.proposed.title, r.proposed.title.length, r.proposed.description, r.proposed.description.length, r.proposed.h1, r.current.title || '', r.current.h1 || '', (r.problems || []).join('; ')]))} title="Download every page's title, description and heading, as you have edited them, as a CSV file">Download as CSV</Button><span className="text-12 text-slate-500">seo-meta.json for the site, and the code that applies it</span></div>
          {files && (
            <div className="rounded-xl ring-1 ring-indigo-200 bg-indigo-50/40 p-4 space-y-3">
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" icon={Download} onClick={() => download('seo-meta.json', files.json, 'application/json')}>Download seo-meta.json</Button><Button size="sm" variant="secondary" icon={Download} onClick={() => download('PageSeo.jsx', files.react)}>Download PageSeo.jsx</Button><Button size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy the code'}</Button></div>
              <pre className="p-3 rounded-lg bg-white ring-1 ring-slate-200 overflow-x-auto text-12 whitespace-pre-wrap max-h-72">{files.react}</pre>
              <p className="text-12.5 text-slate-700"><b>For your developer:</b> add the file and the component to the React site as the comments say, then publish. Google runs JavaScript, so it will see the new titles. Other crawlers (AI assistants, link previews) read the page before JavaScript runs: pre-render the routes so each page's HTML carries its own title. Then run the Website Audit again to confirm.</p>
            </div>)}
        </div>)}
    </Card>
  );
}
