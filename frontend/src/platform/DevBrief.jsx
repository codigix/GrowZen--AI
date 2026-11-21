import React, { useState } from 'react';
import { FileDown, FileText, Loader2 } from 'lucide-react';
import { api } from './seoApi';

/** Downloads the developer brief: what to replace or add on each page, as a PDF to send or Markdown to paste into a ticket. `page` limits it to one page. */
export async function downloadBrief(b, format, page) {
  const r = await api(`/businesses/${b.id}/keyword-mapping/dev-brief`, { method: 'POST', body: { format, page: page || null }, raw: true, timeout: 170000 });
  const blob = await r.blob();
  const name = ((r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/) || [])[1] || `seo-changes.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export default function BriefButtons({ b, page, size = 'md' }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const go = async (format) => {
    setBusy(format); setMsg('');
    try { const name = await downloadBrief(b, format, page); setMsg(`Downloaded ${name}`); } catch (e) { setMsg(e.message || 'The document could not be made.'); } finally { setBusy(''); }
  };
  const h = size === 'sm' ? 'h-8 text-12.5' : 'h-9 text-13';
  const btn = (format, label, Icon, primary) => (
    <button type="button" disabled={Boolean(busy)} onClick={() => go(format)} title={format === 'pdf' ? 'A document to send to the developer: each page, what to replace or add, and the text to use' : 'The same as plain text, to paste into a ticket or message'}
      className={`${h} px-3 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-wait ${primary ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'}`}>
      {busy === format ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}{busy === format ? 'Preparing…' : label}
    </button>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {btn('pdf', page ? 'Download this page (PDF)' : 'Developer brief (PDF)', FileDown, true)}
      {btn('md', 'Markdown', FileText, false)}
      {msg && <span role="status" className={`text-12 ${/Downloaded/.test(msg) ? 'text-emerald-700' : 'text-red-600'}`}>{msg}</span>}
    </span>
  );
}
