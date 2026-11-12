import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Check, Copy, ExternalLink, Plus, Trash2, X, ShieldCheck, ShieldAlert, Sparkles, Upload, FileText, Link2, Info, Lock, CircleCheck, Circle, Download } from 'lucide-react';
import { SeoShell, Card, Button, Badge, Field, Modal, ErrorNote, inputCls, areaCls, useAction, useToast, useUrlTab, useDoubleConfirm, useSeoBusiness, SkList } from './SeoUi';
import { api, useApi } from './seoApi';
import { useCrumb } from './crumbs';
import Select from '../components/Select';

const HUB_URL = 'https://chatgpt.com/business-hub';
const STATUSES = [['Unclaimed', 'Unclaimed'], ['Claim_Pending', 'Claim pending'], ['Claim_Approved', 'Claim approved'], ['Disputed', 'Disputed']];
const STATUS_ORDER = STATUSES.map(([v]) => v);
const STATUS_TONE = { Unclaimed: 'gray', Claim_Pending: 'amber', Claim_Approved: 'green', Disputed: 'red' };
const METHODS = [['', 'Not chosen yet'], ['DNS_TXT', 'DNS TXT record'], ['Shopify', 'Shopify'], ['Business_Email', 'Business email'], ['Business_Phone', 'Business phone']];
const METHOD_LABEL = Object.fromEntries(METHODS);
const AVAILABILITY = [['in_stock', 'In stock'], ['out_of_stock', 'Out of stock'], ['preorder', 'Pre-order'], ['limited', 'Limited stock']];
const BANNER_KEY = 'chatgpt.hub.banner';
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthName = (m) => { const [y, mo] = String(m).split('-').map(Number); return Number.isFinite(y) && mo ? new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : m; };
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const label = (v) => (STATUSES.find(([k]) => k === v) || [v, v])[1];
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

// ---------- small pieces

function useCopy() {
  const [done, setDone] = useState('');
  const copy = async (key, text) => {
    try { await navigator.clipboard.writeText(text || ''); } catch {
      const t = document.createElement('textarea'); t.value = text || ''; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* the browser blocked it */ }
      t.remove();
    }
    setDone(key); setTimeout(() => setDone(d => (d === key ? '' : d)), 1600);
  };
  return [done, copy];
}

function CopyBtn({ id, text, copy, done, children, size = 'sm', disabled }) {
  const on = done === id;
  return <Button size={size} icon={on ? Check : Copy} disabled={disabled || !text} onClick={() => copy(id, text)}>{on ? 'Copied' : children}</Button>;
}

function TopicChips({ values, onChange, max = 20, placeholder = 'Type and press Enter', ariaLabel = 'Add a topic' }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (v && !values.some(x => x.toLowerCase() === v.toLowerCase()) && values.length < max) onChange([...values, v]);
    setText('');
  };
  return (
    <div className="flex flex-wrap gap-1.5 items-center rounded-lg ring-1 ring-slate-200 p-2 focus-within:ring-2 focus-within:ring-indigo-300 bg-white">
      {values.map(t => <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-12 text-indigo-700">{t}<button type="button" onClick={() => onChange(values.filter(x => x !== t))} className="text-indigo-300 hover:text-red-600 cursor-pointer" aria-label={`Remove ${t}`}><X size={12} /></button></span>)}
      {values.length < max && <input className="flex-1 min-w-[140px] h-7 text-13 outline-none bg-transparent" value={text} aria-label={ariaLabel} placeholder={values.length ? 'Add another…' : placeholder}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)); }} onBlur={add} />}
      {values.length >= max && <span className="text-11.5 text-slate-400">Up to {max}</span>}
    </div>
  );
}

const filled = (v) => String(v ?? '').trim() !== '';
/** The four core steps, worked out from what is on screen right now (unsaved edits included). */
export function coreSteps(profile, claim, feedItems) {
  return [
    { key: 'profile', label: 'Profile filled', done: ['business_name', 'category', 'description', 'website_url'].every(k => filled(profile?.[k])), to: 'profile' },
    { key: 'policies', label: 'Policies written', done: filled(profile?.delivery_policy) && filled(profile?.return_policy), to: 'profile' },
    { key: 'feed', label: 'Feed items added', done: Number(feedItems) >= 1, to: 'feed' },
    { key: 'verification', label: 'Verification completed', done: claim?.claim_status === 'Claim_Approved' && filled(claim?.verification_method), to: 'claim' }
  ];
}

function ReadinessWidget({ profile, claim, feedItems, serverItems }) {
  const steps = coreSteps(profile, claim, feedItems);
  const score = steps.filter(s => s.done).length * 25;
  const recommended = (serverItems || []).filter(i => i.core === false);
  const color = score === 100 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <section aria-label="Readiness" className="mb-4 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="text-13 font-semibold text-slate-900">Readiness</span>
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} /></div>
        <span className="text-14 font-bold tabular-nums text-slate-900 w-12 text-right">{score}%</span>
      </div>
      <ul className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {steps.map(s => (
          <li key={s.key}>
            <Link to={`/chatgpt-business/${s.to}`} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-13 ring-1 ring-inset transition-colors ${s.done ? 'bg-emerald-50/70 ring-emerald-200 text-emerald-900' : 'bg-slate-50 ring-slate-200 text-slate-700 hover:bg-indigo-50 hover:ring-indigo-200'}`}>
              {s.done ? <CircleCheck size={16} className="text-emerald-500 shrink-0" /> : <Circle size={16} className="text-slate-300 shrink-0" />}<span className="font-medium">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {recommended.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-11.5 font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Recommended <span className="font-normal normal-case">(not part of the percentage)</span></div>
          <ul className="flex flex-wrap gap-2">
            {recommended.map(i => (
              <li key={i.key}><Link to={`/chatgpt-business/${fixView(i.key)}`} title={i.hint || ''} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-12 ring-1 ring-inset ${i.done ? 'bg-slate-50 ring-slate-200 text-slate-500' : 'bg-white ring-slate-300 text-slate-700 hover:ring-indigo-300'}`}>{i.done ? <Check size={12} className="text-emerald-500" /> : <Circle size={12} className="text-slate-300" />}{i.label}</Link></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Banner() {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(BANNER_KEY) === '1'; } catch { return false; } });
  if (hidden) return null;
  const close = () => { setHidden(true); try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* private window */ } };
  return (
    <div role="note" className="mb-4 rounded-xl bg-sky-50 ring-1 ring-inset ring-sky-200 px-4 py-3 flex gap-3 text-13 text-sky-900">
      <Info size={17} className="text-sky-500 mt-0.5 shrink-0" />
      <p className="flex-1">OpenAI manages claims and verification on its own site (chatgpt.com/business-hub). This hub keeps your information in one place, tracks each business's status, and hosts the feed. Field limits and the feed layout follow the brief we were given; confirm them against OpenAI's current instructions.</p>
      <button type="button" onClick={close} aria-label="Dismiss this note" className="text-sky-400 hover:text-sky-700 cursor-pointer shrink-0"><X size={16} /></button>
    </div>
  );
}

// which view fixes a readiness item
const fixView = (key = '') => (/catalog|feed|item|product|service/i.test(key) ? 'feed' : /agent|insight/i.test(key) ? 'agent' : /claim|verif|dns|persona|status/i.test(key) ? 'claim' : 'profile');

// a CSV with quoted fields, doubled quotes and line breaks inside quotes
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}
const CSV_FIELDS = ['sku', 'title', 'description', 'price', 'currency', 'availability', 'product_url', 'image_url'];
export function csvToItems(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], problem: 'Paste the header row and at least one item.' };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const missing = ['sku', 'title'].filter(f => !head.includes(f));
  if (missing.length) return { items: [], problem: `The first row must name the columns. Missing: ${missing.join(', ')}.` };
  const items = rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { if (CSV_FIELDS.includes(h)) o[h] = (r[i] || '').trim(); });
    if (o.price !== undefined && o.price !== '' && !Number.isNaN(Number(o.price))) o.price = Number(o.price);
    return o;
  });
  return { items, problem: '' };
}

// ---------- 1. Claim & verification

function ClaimView({ b, d, setData, toast, f, setF }) {
  const c = d.claim;
  const [busy, error, run] = useAction();
  const [done, copy] = useCopy();
  const overview = useApi('/chatgpt/overview');
  const [, chooseBusiness] = useSeoBusiness();
  const set = (k, v) => setF(x => ({ ...x, [k]: v, ...(k === 'claim_status' && v !== 'Claim_Approved' ? { persona_verified: false } : {}) }));
  const dirty = f.claim_status !== (c.status || 'Unclaimed') || f.verification_method !== (c.verification_method || '') || f.dns_txt_record !== (c.dns_txt_record || '') || f.persona_verified !== Boolean(c.persona_verified);
  const save = () => run('save', async () => {
    const r = await api(`/businesses/${b.id}/chatgpt`, { method: 'PUT', body: { claim_status: f.claim_status, verification_method: f.verification_method || null, dns_txt_record: f.dns_txt_record.trim(), persona_verified: f.persona_verified } });
    setData(r); overview.reload(true); toast('Saved');
  });
  const at = STATUS_ORDER.indexOf(f.claim_status);
  const steps = [
    { n: 1, title: 'Claim in ChatGPT Business Hub', hint: 'Open the Business Hub, sign in and start the claim for this business.', done: at >= 1 },
    { n: 2, title: 'Verify ownership', hint: `By ${f.verification_method ? METHOD_LABEL[f.verification_method] : 'DNS TXT, Shopify, business email or business phone'}.`, done: f.claim_status === 'Claim_Approved' },
    { n: 3, title: 'Persona ID check', hint: 'Identity check that earns the verified badge.', done: f.persona_verified }
  ];
  const current = steps.find(s => !s.done)?.n;
  const alert = f.claim_status === 'Disputed' ? 'Another claim is disputing this business. Resolve it in the Business Hub.' : '';
  return (
    <div className="space-y-4">
      <Card title="Claim & verification" subtitle="Follow the three steps in the Business Hub, and record where this business is."
        action={<a href={HUB_URL} target="_blank" rel="noreferrer"><Button variant="primary" icon={ExternalLink}>Open ChatGPT Business Hub ↗</Button></a>}>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {steps.map(s => (
            <li key={s.n} aria-current={current === s.n ? 'step' : undefined} className={`rounded-xl p-4 ring-1 ring-inset ${s.done ? 'bg-emerald-50/70 ring-emerald-200' : current === s.n ? 'bg-indigo-50/70 ring-indigo-300' : 'bg-slate-50 ring-slate-200'}`}>
              <div className="flex items-center gap-2.5">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-13 font-bold ${s.done ? 'bg-emerald-500 text-white' : current === s.n ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`}>{s.done ? <Check size={16} /> : s.n}</span>
                <div className="text-13.5 font-semibold text-slate-900 leading-tight">{s.title}</div>
              </div>
              <p className="text-12 text-slate-500 mt-2">{s.hint}</p>
            </li>
          ))}
        </ol>
        {alert && <p className="mb-4 text-13 text-red-800 bg-red-50 ring-1 ring-red-200 rounded-lg px-3 py-2 flex gap-2"><ShieldAlert size={16} className="mt-0.5 shrink-0" />{alert}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Claim status"><Select className={inputCls} value={f.claim_status} onChange={e => set('claim_status', e.target.value)} aria-label="Claim status">{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Verification method"><Select className={inputCls} value={f.verification_method} onChange={e => set('verification_method', e.target.value)} aria-label="Verification method">{METHODS.map(([v, l]) => <option key={v || 'none'} value={v}>{l}</option>)}</Select></Field>
          <div className="md:col-span-2">
            <Field label="DNS TXT record" hint="Paste the TXT record OpenAI gives you, so whoever manages the DNS can add it. Kept with this business only.">
              <textarea className={`${areaCls} font-mono text-12`} rows={3} value={f.dns_txt_record} onChange={e => set('dns_txt_record', e.target.value)} placeholder="openai-domain-verification=…" aria-label="DNS TXT record" />
            </Field>
            <div className="mt-2"><CopyBtn id="txt" text={f.dns_txt_record} copy={copy} done={done}>Copy TXT record</CopyBtn></div>
          </div>
          <div className="md:col-span-2">
            <label className={`inline-flex items-start gap-2.5 ${f.claim_status === 'Claim_Approved' ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
              <input type="checkbox" className="mt-1" checked={f.persona_verified} disabled={f.claim_status !== 'Claim_Approved'} onChange={e => set('persona_verified', e.target.checked)} />
              <span className="text-13 text-slate-700"><b>Persona identity check approved</b> (verified badge){f.claim_status !== 'Claim_Approved' && <span className="block text-12 text-slate-500 inline-flex items-center gap-1"><Lock size={11} />Available once the claim is approved.</span>}</span>
            </label>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-4 flex items-center gap-3"><Button variant="primary" busy={busy === 'save'} disabled={!dirty} onClick={save}>Save</Button>{!dirty && <span className="text-12 text-slate-400">All changes saved</span>}</div>
      </Card>

      <div className="grid grid-cols-1 gap-4 items-start">
        <Card title="History" subtitle="Every change of status for this business">
          {(c.history || []).length === 0 ? <p className="text-13 text-slate-500 py-3">No changes yet.</p> : (
            <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {[...c.history].reverse().map((h, i) => <li key={i} className="py-2.5 text-13 flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="text-11.5 text-slate-400 w-40 shrink-0">{stamp(h.at)}</span><Badge tone={STATUS_TONE[h.from] || 'gray'}>{label(h.from)}</Badge><span className="text-slate-400">→</span><Badge tone={STATUS_TONE[h.to] || 'gray'}>{label(h.to)}</Badge>{h.by && <span className="text-12 text-slate-500">by {h.by}</span>}</li>)}
            </ul>
          )}
        </Card>
      </div>

      <Card title="All your businesses" subtitle="Claim and verification status across every project. Click a row to switch to it.">
        {!overview.data ? (overview.error ? <ErrorNote>{overview.error.message}</ErrorNote> : <SkList rows={4} />) : overview.data.length === 0 ? <p className="text-13 text-slate-500 py-3">No businesses yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-13">
              <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">Business</th><th className="p-2 text-left font-medium">Status</th><th className="p-2 text-left font-medium">Method</th><th className="p-2 text-left font-medium">Verified badge</th><th className="p-2 text-right font-medium">Feed items</th><th className="p-2 text-right font-medium">Readiness</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {overview.data.map(o => (
                  <tr key={o.business_id} tabIndex={0} onClick={() => chooseBusiness(o.business_id)} onKeyDown={e => { if (e.key === 'Enter') chooseBusiness(o.business_id); }} className={`cursor-pointer hover:bg-slate-50 ${o.business_id === b.id ? 'bg-indigo-50/60' : ''}`}>
                    <td className="p-2.5 font-medium text-slate-900">{o.name}{o.business_id === b.id && <span className="ml-2 text-10 font-bold uppercase text-indigo-600">Open</span>}</td>
                    <td className="p-2.5"><Badge tone={STATUS_TONE[o.claim_status] || 'gray'}>{label(o.claim_status)}</Badge></td>
                    <td className="p-2.5 text-slate-600">{METHOD_LABEL[o.verification_method] || '—'}</td>
                    <td className="p-2.5">{o.persona_verified ? <span className="inline-flex items-center gap-1 text-emerald-600"><ShieldCheck size={14} />Yes</span> : <span className="text-slate-400">No</span>}</td>
                    <td className="p-2.5 text-right tabular-nums">{fmt(o.items)}</td>
                    <td className="p-2.5 text-right tabular-nums font-semibold">{o.readiness_score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- 2. Profile & policies

function JsonLdCard({ b, version }) {
  const ld = useApi(`/businesses/${b.id}/chatgpt/jsonld`);
  const [done, copy] = useCopy();
  useEffect(() => { if (version) ld.reload(true); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = ld.data;
  return (
    <Card title="Schema markup (JSON-LD)" subtitle="Put this on your website so ChatGPT's web crawler matches the profile you claimed."
      action={<CopyBtn id="ld" text={d?.text} copy={copy} done={done}>Copy JSON-LD</CopyBtn>}>
      {!d ? (ld.error ? <ErrorNote>{ld.error.message}</ErrorNote> : <SkList rows={4} />) : (
        <>
          {(d.warnings || []).length > 0 && <div className="flex flex-wrap gap-1.5 mb-3">{d.warnings.map(w => <span key={w} className="text-12 bg-amber-50 text-amber-800 ring-1 ring-amber-200 rounded-full px-2.5 py-1">{w}</span>)}</div>}
          <pre className="rounded-lg bg-slate-900 text-slate-100 text-12 leading-relaxed p-4 overflow-x-auto max-h-96" aria-label="JSON-LD markup"><code>{d.text}</code></pre>
          <p className="text-12 text-slate-500 mt-3">Place it inside a <code className="bg-slate-100 rounded px-1">&lt;script type="application/ld+json"&gt;</code> tag in the page head of your website, then check it with a structured-data testing tool.</p>
        </>
      )}
    </Card>
  );
}

const PROFILE_FIELDS = [
  ['business_name', 'Business name', 'input'], ['category', 'Category', 'input'], ['description', 'Description', 'area'], ['website_url', 'Website URL', 'input'],
  ['logo_url', 'Logo URL', 'input'], ['delivery_policy', 'Delivery policy', 'area'], ['return_policy', 'Return policy', 'area']
];

function ProfileView({ b, d, setData, toast, f, setF }) {
  const p0 = d.profile || {};
  const [busy, error, run] = useAction();
  const [done, copy] = useCopy();
  const [version, setVersion] = useState(0);
  const [logoOk, setLogoOk] = useState(true);
  const max = d.limits?.description_max || 500;
  const over = f.description.length > max;
  const dirty = PROFILE_FIELDS.some(([k]) => f[k] !== (p0[k] || ''));
  useEffect(() => { setLogoOk(true); }, [f.logo_url]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run('save', async () => { const r = await api(`/businesses/${b.id}/chatgpt`, { method: 'PUT', body: { profile: f } }); setData(r); setVersion(v => v + 1); toast('Profile saved'); });
  const fromProfile = () => { const dflt = d.defaults?.description; if (dflt) set('description', dflt); else toast('There is no description on the business profile yet.'); };
  return (
    <div className="space-y-4">
      <Card title="Profile & policies" subtitle="Keep this wording ready. Copy each field into the Business Hub with one click."
        action={<Button variant="primary" busy={busy === 'save'} disabled={!dirty || over} onClick={save}>Save</Button>}>
        <div className="space-y-5">
          {PROFILE_FIELDS.map(([k, name, kind]) => (
            <div key={k}>
              <Field label={name} counter={k === 'description' ? <span className={over ? 'text-red-600 font-semibold' : ''}>{f.description.length}/{max}</span> : null}
                hint={k === 'description' ? 'Short and clear: ChatGPT uses this to describe you in answers.' : k === 'logo_url' ? 'A public image address (https://…).' : undefined}>
                {kind === 'area' ? <textarea className={`${areaCls} ${k === 'description' && over ? '!ring-red-300' : ''}`} rows={k === 'description' ? 5 : 3} value={f[k]} onChange={e => set(k, e.target.value)} aria-label={name} />
                  : <input className={inputCls} value={f[k]} onChange={e => set(k, e.target.value)} aria-label={name} inputMode={k.endsWith('_url') ? 'url' : undefined} />}
              </Field>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <CopyBtn id={k} text={f[k]} copy={copy} done={done}>Copy for Business Hub</CopyBtn>
                {k === 'description' && <Button size="sm" icon={Sparkles} onClick={fromProfile}>Use from profile</Button>}
                {k === 'description' && over && <span className="text-12 text-red-600">{f.description.length - max} characters over the limit.</span>}
                {k === 'logo_url' && f.logo_url && logoOk && <img src={f.logo_url} alt="Logo preview" className="h-10 w-10 rounded object-contain ring-1 ring-slate-200 bg-white" onError={() => setLogoOk(false)} />}
                {k === 'logo_url' && f.logo_url && !logoOk && <span className="text-12 text-amber-700">This image could not be loaded.</span>}
              </div>
            </div>
          ))}
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>
      <JsonLdCard b={b} version={version} />
    </div>
  );
}

// ---------- 3. Product / service feed

const EMPTY_ITEM = { sku: '', title: '', description: '', price: '', currency: 'INR', availability: 'in_stock', product_url: '', image_url: '' };
const isUrl = (v) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v.trim());

function ItemModal({ b, open, onClose, onDone, toast }) {
  const [f, setF] = useState(EMPTY_ITEM);
  const [busy, error, run, setError] = useAction();
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setF(EMPTY_ITEM); setTried(false); setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const errs = {
    sku: !f.sku.trim() && 'Enter a SKU: a code that is unique for this item.',
    title: !f.title.trim() && 'Enter the item title.',
    price: (f.price === '' || Number.isNaN(Number(f.price)) || Number(f.price) < 0) && 'Enter the price as a number, for example 499.',
    currency: !/^[A-Za-z]{3}$/.test(f.currency.trim()) && 'Use a 3-letter currency code, for example INR.',
    product_url: !isUrl(f.product_url) && 'Enter the full link to the item, starting with https://',
    image_url: f.image_url.trim() && !isUrl(f.image_url) && 'The image link must start with https://'
  };
  const bad = Object.values(errs).some(Boolean);
  const err = (k) => (tried && errs[k] ? <span className="block text-11.5 text-red-600 mt-1">{errs[k]}</span> : null);
  const save = () => { setTried(true); if (bad) return; run('add', async () => { const r = await api(`/businesses/${b.id}/chatgpt/catalog`, { method: 'POST', body: { items: [{ ...f, sku: f.sku.trim(), title: f.title.trim(), price: Number(f.price), currency: f.currency.trim().toUpperCase(), product_url: f.product_url.trim(), image_url: f.image_url.trim() || null }] } }); if (r.errors?.length) throw new Error(r.errors[0].error); toast(r.updated ? 'Item updated' : 'Item added'); onDone(); onClose(); }); };
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title="Add an item" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy === 'add'} onClick={save}>Add item</Button></>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="SKU *"><input className={inputCls} value={f.sku} onChange={set('sku')} autoFocus />{err('sku')}</Field>
        <Field label="Title *"><input className={inputCls} value={f.title} onChange={set('title')} />{err('title')}</Field>
        <div className="md:col-span-2"><Field label="Description"><textarea className={areaCls} rows={3} value={f.description} onChange={set('description')} /></Field></div>
        <Field label="Price *"><input type="number" min="0" step="any" className={inputCls} value={f.price} onChange={set('price')} />{err('price')}</Field>
        <Field label="Currency *"><input className={inputCls} value={f.currency} onChange={set('currency')} maxLength={3} />{err('currency')}</Field>
        <Field label="Availability"><Select className={inputCls} value={f.availability} onChange={set('availability')} aria-label="Availability">{AVAILABILITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Item link *"><input className={inputCls} value={f.product_url} onChange={set('product_url')} placeholder="https://" inputMode="url" />{err('product_url')}</Field>
        <div className="md:col-span-2"><Field label="Image link"><input className={inputCls} value={f.image_url} onChange={set('image_url')} placeholder="https://" inputMode="url" />{err('image_url')}</Field></div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  );
}

function CsvModal({ b, open, onClose, onDone, toast }) {
  const [text, setText] = useState('');
  const [busy, error, run, setError] = useAction();
  const [rowErrors, setRowErrors] = useState([]);
  useEffect(() => { if (open) { setText(''); setRowErrors([]); setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => (text.trim() ? csvToItems(text) : null), [text]);
  const send = () => run('csv', async () => {
    setRowErrors([]);
    const r = await api(`/businesses/${b.id}/chatgpt/catalog`, { method: 'POST', body: { items: parsed.items } });
    setRowErrors(r.errors || []);
    toast(`${r.added || 0} added, ${r.updated || 0} updated${r.errors?.length ? `, ${r.errors.length} with problems` : ''}`);
    onDone();
    if (!r.errors?.length) onClose();
  });
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title="Paste items as CSV"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Upload} busy={busy === 'csv'} disabled={!parsed || Boolean(parsed.problem) || !parsed.items.length} onClick={send}>Import {parsed && !parsed.problem ? `${parsed.items.length} item${parsed.items.length === 1 ? '' : 's'}` : ''}</Button></>}>
      <p className="text-13 text-slate-600 mb-2">The first row names the columns: <code className="bg-slate-100 rounded px-1 text-12">{CSV_FIELDS.join(',')}</code>. Quote a value that contains a comma. An item with an existing SKU is updated.</p>
      <textarea className={`${areaCls} font-mono text-12`} rows={10} value={text} onChange={e => setText(e.target.value)} aria-label="CSV items" placeholder={`${CSV_FIELDS.join(',')}\nLEH-001,"Bridal lehenga, red",Heavy work,4999,INR,in_stock,https://example.com/lehenga,https://example.com/lehenga.jpg`} />
      {parsed?.problem && <p className="text-12.5 text-red-600 mt-2">{parsed.problem}</p>}
      {parsed && !parsed.problem && <p className="text-12.5 text-slate-500 mt-2">{parsed.items.length} row{parsed.items.length === 1 ? '' : 's'} read.</p>}
      <ErrorNote>{error}</ErrorNote>
      {rowErrors.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3"><div className="text-13 font-semibold text-amber-900 mb-1">These rows were not imported</div>
          <ul className="text-12.5 text-amber-900 space-y-0.5 max-h-40 overflow-y-auto">{rowErrors.map((e, i) => <li key={i}>Row {e.row}{e.sku ? ` (${e.sku})` : ''}: {e.error}</li>)}</ul></div>
      )}
    </Modal>
  );
}

function FeedView({ b, d, reloadAll, toast }) {
  const cat = useApi(`/businesses/${b.id}/chatgpt/catalog`);
  const [done, copy] = useCopy();
  const [adding, setAdding] = useState(false);
  const [csv, setCsv] = useState(false);
  const [busy, error, run] = useAction();
  const [ask, confirmNode] = useDoubleConfirm();
  const feed = d.feed || {};
  const refresh = () => { cat.reload(true); reloadAll(); };
  const items = cat.data?.items || [];
  const fromServices = () => run('services', async () => { const r = await api(`/businesses/${b.id}/chatgpt/catalog/from-services`, { method: 'POST', body: {} }); toast(r.added || r.updated ? `${r.added || 0} added, ${r.updated || 0} updated from your services` : 'Your services are already in the feed.'); refresh(); });
  const del = (it) => ask({ what: it.title || it.sku, effect: 'It is removed from the hosted feed the next time ChatGPT fetches it.', onConfirm: () => run(`d${it.sku}`, async () => { await api(`/businesses/${b.id}/chatgpt/catalog/${encodeURIComponent(it.sku)}`, { method: 'DELETE' }); refresh(); }) });
  return (
    <div className="space-y-4">
      {confirmNode}
      <section className="rounded-2xl bg-indigo-50/70 ring-1 ring-inset ring-indigo-200 p-5" aria-label="Hosted CSV feed URL">
        <div className="flex items-center gap-2 text-13 font-semibold text-indigo-900"><Link2 size={16} />Your live product feed</div>
        <div className="mt-3 flex flex-wrap items-stretch gap-2">
          <input readOnly value={feed.csv_url || ''} onFocus={e => e.target.select()} className={`${inputCls} flex-1 min-w-[240px] font-mono text-12 bg-white`} aria-label="Hosted CSV feed URL" />
          <CopyBtn id="csv" text={feed.csv_url} copy={copy} done={done} size="md">Copy Feed URL</CopyBtn>
          {feed.csv_url && <a href={feed.csv_url} target="_blank" rel="noreferrer"><Button icon={ExternalLink}>Open</Button></a>}
        </div>
        <p className="text-12.5 text-indigo-900/80 mt-2.5">Paste this into the Product Feed section of ChatGPT Business Hub; it updates live.</p>
        <p className="text-11.5 text-indigo-900/60 mt-1">{feed.items ?? 0} item{feed.items === 1 ? '' : 's'} in the feed{feed.updated_at ? ` · last changed ${stamp(feed.updated_at)}` : ''}. The address must be reachable from the internet for OpenAI to fetch it.</p>
      </section>

      <Card title="Products & services" subtitle={`${cat.data?.total ?? 0} in the feed${d.limits?.catalog_max ? ` (up to ${fmt(d.limits.catalog_max)})` : ''}`}
        action={<div className="flex flex-wrap gap-2"><Button size="sm" icon={FileText} busy={busy === 'services'} onClick={fromServices}>Import from my services</Button><Button size="sm" icon={Upload} onClick={() => setCsv(true)}>Paste CSV</Button><Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add item</Button></div>}>
        <ErrorNote>{error || cat.error?.message}</ErrorNote>
        {!cat.data ? <SkList rows={4} /> : items.length === 0 ? (
          <div className="py-10 text-center">
            <span className="inline-flex w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 items-center justify-center"><Link2 size={22} /></span>
            <div className="text-15 font-semibold text-slate-900 mt-3">Your feed is empty</div>
            <p className="text-13 text-slate-500 mt-1 max-w-md mx-auto">A feed is the list of what you sell or offer, with prices and links, that ChatGPT can read and keep up to date. Add items one by one, paste a CSV, or start from the services on your profile.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-13">
              <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">SKU</th><th className="p-2 text-left font-medium">Title</th><th className="p-2 text-right font-medium">Price</th><th className="p-2 text-left font-medium">Availability</th><th className="p-2 text-left font-medium">Link</th><th className="p-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(it => (
                  <tr key={it.sku}>
                    <td className="p-2.5 font-mono text-12 text-slate-600">{it.sku}</td>
                    <td className="p-2.5 text-slate-900 max-w-[280px]"><div className="truncate" title={it.title}>{it.title}</div>{it.description && <div className="text-11.5 text-slate-500 truncate" title={it.description}>{it.description}</div>}</td>
                    <td className="p-2.5 text-right tabular-nums whitespace-nowrap">{fmt(it.price)} <span className="text-slate-400 text-12">{it.currency}</span></td>
                    <td className="p-2.5"><Badge tone={it.availability === 'in_stock' ? 'green' : it.availability === 'out_of_stock' ? 'red' : 'amber'}>{(AVAILABILITY.find(([v]) => v === it.availability) || [0, it.availability])[1]}</Badge></td>
                    <td className="p-2.5 text-12 max-w-[200px]">{it.product_url ? <a href={it.product_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate block">{it.product_url.replace(/^https?:\/\/(www\.)?/, '')}</a> : '—'}</td>
                    <td className="p-2.5 text-right"><button type="button" onClick={() => del(it)} aria-label={`Delete ${it.title || it.sku}`} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ItemModal b={b} open={adding} onClose={() => setAdding(false)} onDone={refresh} toast={toast} />
      <CsvModal b={b} open={csv} onClose={() => setCsv(false)} onDone={refresh} toast={toast} />
    </div>
  );
}

// ---------- 4. Business agent & insights

function AgentView({ b, d, setData, toast }) {
  const a0 = d.agent || {};
  const [f, setF] = useState({ is_enabled: Boolean(a0.is_enabled), instructions: a0.instructions || '' });
  const [busy, error, run] = useAction();
  const [done, copy] = useCopy();
  useEffect(() => { const a = d.agent || {}; setF({ is_enabled: Boolean(a.is_enabled), instructions: a.instructions || '' }); }, [b.id, d.claim?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = d.limits?.instructions_max || 4000;
  const over = f.instructions.length > max;
  const dirty = f.is_enabled !== Boolean(a0.is_enabled) || f.instructions !== (a0.instructions || '');
  const save = () => run('save', async () => { const r = await api(`/businesses/${b.id}/chatgpt`, { method: 'PUT', body: { agent: { is_enabled: f.is_enabled, instructions: f.instructions } } }); setData(r); toast('Agent settings saved'); });
  const starter = () => run('starter', async () => { const r = await api(`/businesses/${b.id}/chatgpt/agent-guidelines`); setF(x => ({ ...x, instructions: r.text || '' })); toast('Starter written from your profile: read it and change what you need'); });

  const [ins, setIns] = useState({ month: thisMonth(), mentions: '', website_clicks: '', topics: [] });
  const [ibusy, ierror, irun] = useAction();
  const [ask, confirmNode] = useDoubleConfirm();
  const insights = useMemo(() => [...(d.insights || [])].sort((x, y) => (y.month > x.month ? 1 : -1)), [d.insights]);
  const last3 = insights.slice(0, 3);
  const topTopics = useMemo(() => { const n = {}; last3.forEach(m => (m.topics || []).forEach(t => { n[t] = (n[t] || 0) + 1; })); return Object.entries(n).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([t]) => t); }, [last3]);
  const chart = [...insights].reverse().slice(-12).map(m => ({ name: monthName(m.month), mentions: m.mentions, clicks: m.website_clicks }));
  const insBad = !ins.month || ins.month > thisMonth() || ins.mentions === '' || ins.website_clicks === '' || Number(ins.mentions) < 0 || Number(ins.website_clicks) < 0;
  const logMonth = () => irun('log', async () => {
    const r = await api(`/businesses/${b.id}/chatgpt/insights`, { method: 'POST', body: { month: ins.month, mentions: Number(ins.mentions), website_clicks: Number(ins.website_clicks), topics: ins.topics } });
    setData(x => ({ ...x, insights: r.insights })); setIns({ month: thisMonth(), mentions: '', website_clicks: '', topics: [] }); toast(`${monthName(ins.month)} saved`);
  });
  const delMonth = (m) => ask({ what: `the ${monthName(m.month)} numbers`, effect: 'Only the numbers you entered here are removed.', onConfirm: () => irun(`d${m.month}`, async () => { const r = await api(`/businesses/${b.id}/chatgpt/insights/${m.month}`, { method: 'DELETE' }); setData(x => ({ ...x, insights: r.insights })); }) });

  return (
    <div className="space-y-4">
      {confirmNode}
      <Card title="Business Agent" subtitle="Write the rules the ChatGPT Business Agent follows when it answers for this business."
        action={<Button variant="primary" busy={busy === 'save'} disabled={!dirty || over} onClick={save}>Save</Button>}>
        <label className="flex items-start gap-3 cursor-pointer">
          <button type="button" role="switch" aria-checked={f.is_enabled} onClick={() => setF(x => ({ ...x, is_enabled: !x.is_enabled }))} className={`mt-0.5 w-11 h-6 rounded-full relative transition-colors shrink-0 cursor-pointer ${f.is_enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${f.is_enabled ? 'translate-x-5' : ''}`} /></button>
          <span className="text-13 text-slate-700"><b>Business Agent enabled for this business</b><span className="block text-12 text-slate-500">Only for eligible businesses, and always subject to OpenAI's Business Agents policy. Turning this on here only records your intent: OpenAI decides eligibility.</span></span>
        </label>
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-12.5 text-slate-600">
          <b className="text-slate-800">What to cover:</b> the tone (friendly, short, plain words), what the agent may and may not promise (prices, delivery times, medical or legal advice), and when to hand over to a person (complaints, refunds, anything it is unsure about).
        </div>
        <div className="mt-4">
          <Field label="Agent instructions" counter={<span className={over ? 'text-red-600 font-semibold' : ''}>{f.instructions.length}/{max}</span>}>
            <textarea className={`${areaCls} ${over ? '!ring-red-300' : ''}`} rows={10} value={f.instructions} onChange={e => setF(x => ({ ...x, instructions: e.target.value }))} aria-label="Agent instructions" />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="ai" icon={Sparkles} busy={busy === 'starter'} onClick={starter}>Generate starter from my profile</Button><CopyBtn id="agent" text={f.instructions} copy={copy} done={done}>Copy agent instructions</CopyBtn></div>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <Card title="ChatGPT Business Hub insights" subtitle="You enter these numbers from your Business Hub reports; ChatGPT does not send them to us.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <div className="ai-glass-card rounded p-3.5"><div className="text-11.5 font-semibold text-slate-400">Mentions · {last3[0] ? monthName(last3[0].month) : 'latest month'}</div><div className="text-24 font-bold text-slate-900 tabular-nums">{last3[0] ? fmt(last3[0].mentions) : '—'}</div></div>
          <div className="ai-glass-card rounded p-3.5"><div className="text-11.5 font-semibold text-slate-400">Website clicks · {last3[0] ? monthName(last3[0].month) : 'latest month'}</div><div className="text-24 font-bold text-slate-900 tabular-nums">{last3[0] ? fmt(last3[0].website_clicks) : '—'}</div></div>
          <div className="ai-glass-card rounded p-3.5"><div className="text-11.5 font-semibold text-slate-400">Top discovery topics · last 3 months</div><div className="flex flex-wrap gap-1.5 mt-1.5">{topTopics.length ? topTopics.map(t => <span key={t} className="text-12 bg-indigo-50 text-indigo-700 rounded-full px-2.5 py-0.5">{t}</span>) : <span className="text-13 text-slate-400">None logged yet</span>}</div></div>
        </div>

        <div className="rounded-xl ring-1 ring-slate-200 p-4 mb-5">
          <div className="text-13 font-semibold text-slate-800 mb-3">Log a month</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Month"><input type="month" className={inputCls} value={ins.month} max={thisMonth()} onChange={e => setIns(x => ({ ...x, month: e.target.value }))} /></Field>
            <Field label="Mentions"><input type="number" min="0" className={inputCls} value={ins.mentions} onChange={e => setIns(x => ({ ...x, mentions: e.target.value }))} /></Field>
            <Field label="Website clicks"><input type="number" min="0" className={inputCls} value={ins.website_clicks} onChange={e => setIns(x => ({ ...x, website_clicks: e.target.value }))} /></Field>
            <div className="md:col-span-3"><Field label="Discovery topics" hint="What people asked about when they found you."><TopicChips values={ins.topics} onChange={v => setIns(x => ({ ...x, topics: v }))} max={12} placeholder="e.g. bridal lehenga rental" ariaLabel="Add a discovery topic" /></Field></div>
          </div>
          <ErrorNote>{ierror}</ErrorNote>
          <div className="mt-3"><Button variant="primary" icon={Plus} busy={ibusy === 'log'} disabled={insBad} onClick={logMonth}>Save month</Button>{insights.some(m => m.month === ins.month) && <span className="ml-3 text-12 text-slate-500">This month already has numbers: saving replaces them.</span>}</div>
        </div>

        {insights.length === 0 ? <p className="text-13 text-slate-500 py-3">Nothing logged yet. After each month, copy the numbers from your Business Hub reports into the form above.</p> : (
          <>
            {chart.length > 1 && (
              <div className="h-56 mb-4" aria-label="Mentions and website clicks per month">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} /><Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="mentions" name="Mentions" fill="#6366f1" radius={[3, 3, 0, 0]} /><Bar dataKey="clicks" name="Website clicks" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-13">
                <thead className="text-12 text-slate-500 border-b border-slate-200"><tr><th className="p-2 text-left font-medium">Month</th><th className="p-2 text-right font-medium">Mentions</th><th className="p-2 text-right font-medium">Website clicks</th><th className="p-2 text-left font-medium">Discovery topics</th><th className="p-2" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {insights.map(m => (
                    <tr key={m.month}><td className="p-2.5 font-medium text-slate-900">{monthName(m.month)}</td><td className="p-2.5 text-right tabular-nums">{fmt(m.mentions)}</td><td className="p-2.5 text-right tabular-nums">{fmt(m.website_clicks)}</td>
                      <td className="p-2.5"><div className="flex flex-wrap gap-1">{(m.topics || []).map(t => <span key={t} className="text-11.5 bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{t}</span>)}</div></td>
                      <td className="p-2.5 text-right"><button type="button" onClick={() => delMonth(m)} aria-label={`Delete ${monthName(m.month)}`} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"><Trash2 size={14} /></button></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------- the page

const TITLES = { claim: 'Claim & verification', profile: 'Profile & policies', feed: 'Product / service feed', agent: 'Business agent & insights' };

const claimFrom = (c = {}) => ({ claim_status: c.status || 'Unclaimed', verification_method: c.verification_method || '', dns_txt_record: c.dns_txt_record || '', persona_verified: Boolean(c.persona_verified) });
const profileFrom = (p = {}) => Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, p[k] || '']));

function Hub({ b, tab }) {
  const data = useApi(`/businesses/${b.id}/chatgpt`);
  const [toast, toastNode] = useToast();
  useCrumb(TITLES[tab]);
  const d = data.data;
  const setData = (v) => data.setData(typeof v === 'function' ? v(data.data) : v);
  // The forms live here so the readiness widget above every view reflects unsaved edits too.
  const [claimF, setClaimF] = useState(null);
  const [profF, setProfF] = useState(null);
  const stamped = d?.claim?.updated_at || '';
  useEffect(() => { if (d) { setClaimF(claimFrom(d.claim)); setProfF(profileFrom(d.profile)); } }, [Boolean(d), stamped, b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = Boolean(d && claimF && profF);
  return (
    <div>
      <Banner />
      {!d ? (data.error ? (
        <Card><div className="py-8 text-center">
          <div className="text-15 font-semibold text-slate-900">{data.error.status === 404 ? 'This module is not available on the server yet' : 'Could not load the ChatGPT hub'}</div>
          <p className="text-13 text-slate-500 mt-1">{data.error.status === 404 ? 'Update and restart the backend, then reload this page.' : data.error.message}</p>
          <div className="mt-3"><Button icon={Download} onClick={() => data.reload()}>Try again</Button></div>
        </div></Card>
      ) : <Card><SkList rows={6} /></Card>) : !ready ? <Card><SkList rows={6} /></Card> : (
        <>
          <ReadinessWidget profile={profF} claim={claimF} feedItems={d.feed?.items} serverItems={d.readiness?.items} />
          {tab === 'claim' && <ClaimView b={b} d={d} setData={setData} toast={toast} f={claimF} setF={setClaimF} />}
          {tab === 'profile' && <ProfileView b={b} d={d} setData={setData} toast={toast} f={profF} setF={setProfF} />}
          {tab === 'feed' && <FeedView b={b} d={d} reloadAll={() => data.reload(true)} toast={toast} />}
          {tab === 'agent' && <AgentView b={b} d={d} setData={setData} toast={toast} />}
        </>
      )}
      {toastNode}
    </div>
  );
}

export default function ChatGPTBusinessPage() {
  const [tab] = useUrlTab('claim', ['claim', 'profile', 'feed', 'agent']);
  return (
    <SeoShell title="Your business, in ChatGPT" subtitle="Claim your business to share what you offer, keep your information up to date, and understand and shape how you show up.">
      {(b) => <Hub key={b.id} b={b} tab={tab} />}
    </SeoShell>
  );
}
