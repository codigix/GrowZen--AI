import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Search, X, ShieldCheck } from 'lucide-react';
import { Modal, Field, Button, ErrorNote, inputCls, areaCls, useAction, refreshBusinesses, useSeoBusiness } from './SeoUi';
import { api, useApi } from './seoApi';
import Select from '../components/Select';

const pin = (s) => (String(s || '').match(/\b[1-9]\d{5}\b/) || [''])[0];

/** Create a brand-new Google Business Profile from the project's own details, check it with Google first, then link it. */
export default function CreateOnGoogle({ b, open, onClose, toast }) {
  const navigate = useNavigate();
  const [, setBusiness] = useSeoBusiness();
  const fresh = Boolean(b.gbp_location); // the open project is already linked: this creates a NEW business with its own profile
  const [np, setNp] = useState({ name: '', phone: '', website: '', description: '' });
  const conns = useApi(open ? '/connections' : null);
  const list = (conns.data || []).filter(c => c.status !== 'revoked');
  const [connectionId, setConnectionId] = useState('');
  const [account, setAccount] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [category, setCategory] = useState(null);
  const [a, setA] = useState({ line1: '', line2: '', locality: '', state: '', postal: '', region: 'IN' });
  const [busy, error, run, setError] = useAction();
  const [checked, setChecked] = useState('');
  const set = (k, v) => { setA(x => ({ ...x, [k]: v })); setChecked(''); };

  useEffect(() => {
    if (!open) return;
    if (fresh) { setNp({ name: '', phone: '', website: '', description: '' }); setA({ line1: '', line2: '', locality: '', state: '', postal: '', region: (b.country || 'IN').toUpperCase().slice(0, 2) }); setCategory(null); setQ(''); setFound([]); setChecked(''); setError(''); return; }
    const parts = String(b.address || '').split(',').map(x => x.trim()).filter(Boolean);
    setA({ line1: parts[0] || '', line2: parts.slice(1).filter(x => x !== b.city && !/^\d{6}$/.test(x)).join(', ').slice(0, 120), locality: b.city || '', state: '', postal: pin(b.address), region: (b.country || 'IN').toUpperCase().slice(0, 2) });
    setCategory(null); setQ(''); setFound([]); setChecked(''); setError('');
  }, [open, b.id, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !connectionId && list.length) setConnectionId(String(list[0].id)); }, [open, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts = useApi(open && connectionId ? `/businesses/${b.id}/gbp/create/accounts?connection_id=${connectionId}` : null);
  useEffect(() => { if (accounts.data?.length && !accounts.data.some(x => x.name === account)) setAccount(accounts.data[0].name); }, [accounts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !connectionId || q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => { api(`/businesses/${b.id}/gbp/create/categories?connection_id=${connectionId}&q=${encodeURIComponent(q.trim())}`).then(setFound).catch(() => setFound([])); }, 350);
    return () => clearTimeout(t);
  }, [q, connectionId, open, b.id]);

  const body = (validate) => ({
    connection_id: Number(connectionId), account, category: category?.name, validate_only: validate,
    address: { address_lines: [a.line1, a.line2].map(x => x.trim()).filter(Boolean), locality: a.locality.trim(), administrative_area: a.state.trim(), postal_code: a.postal.trim(), region_code: a.region.trim().toUpperCase() }
  });
  const problem = useMemo(() => {
    if (!(fresh ? np.name : b.name)?.trim()) return fresh ? 'Enter the business name.' : 'The project needs a business name first.';
    if (!connectionId) return 'Connect a Google account first.';
    if (!account) return 'Choose the Google business account.';
    if (!category) return 'Pick a category.';
    if (!a.line1.trim() || !a.locality.trim()) return 'Enter the street address and city.';
    if (!/^[A-Za-z]{2}$/.test(a.region.trim())) return 'Enter the 2-letter country code, e.g. IN.';
    return '';
  }, [b.name, fresh, np.name, connectionId, account, category, a]);

  const newProjectBody = () => ({ name: np.name.trim(), phone: np.phone.trim() || null, website: np.website.trim() || null, description: np.description.trim() || null, country: a.region.trim().toUpperCase() || null, city: a.locality.trim() || null, address: [a.line1, a.line2, a.locality, a.postal].map(x => x.trim()).filter(Boolean).join(', ') || null, primary_category: category?.displayName || null });
  // For a new business the project is made first (Google needs one to check against) and removed again if Google refuses, so nothing half-made is left behind.
  const viaNewProject = async (validateOnly) => {
    const nb = await api('/businesses', { method: 'POST', body: newProjectBody() });
    try {
      await api(`/businesses/${nb.id}/gbp/create`, { method: 'POST', body: body(true) });
      if (validateOnly) { await api(`/businesses/${nb.id}`, { method: 'DELETE' }).catch(() => {}); return { message: 'Google accepts these details. Nothing was created yet.' }; }
      await api(`/businesses/${nb.id}/gbp/create`, { method: 'POST', body: body(false) });
      return { id: nb.id };
    } catch (e) { await api(`/businesses/${nb.id}`, { method: 'DELETE' }).catch(() => {}); throw e; }
  };
  const check = () => run('check', async () => {
    const r = fresh ? await viaNewProject(true) : await api(`/businesses/${b.id}/gbp/create`, { method: 'POST', body: body(true) });
    setChecked(r.message);
  });
  const create = () => run('create', async () => {
    if (fresh) {
      const r = await viaNewProject(false);
      await refreshBusinesses();
      setBusiness(r.id);
      toast('New business and Google profile created. Next: verify it so it shows on Search and Maps.');
      onClose();
      navigate('/gmb-profile/settings');
      return;
    }
    await api(`/businesses/${b.id}/gbp/create`, { method: 'POST', body: body(false) });
    await refreshBusinesses();
    toast('Profile created on Google. Next: verify it so it shows on Search and Maps.');
    onClose();
    navigate('/gmb-profile/settings');
  });

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={fresh ? "Create a new business and its Google profile" : "Create a Google Business Profile"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button busy={busy === 'check'} disabled={Boolean(problem)} onClick={check}>Check with Google</Button><Button variant="primary" busy={busy === 'create'} disabled={Boolean(problem)} onClick={create}>Create profile</Button></>}>
      <div className="space-y-5">
        {fresh ? (
          <div className="space-y-3">
            <p className="text-13 text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">This adds a <b>new business</b> to your projects and creates its own Google Business Profile. Your current project, {b.name}, is not changed.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><Field label="Business name" hint="The real name on the signboard. No keywords or city names."><input className={inputCls} value={np.name} onChange={e => { setNp({ ...np, name: e.target.value }); setChecked(''); }} /></Field></div>
              <Field label="Phone"><input type="tel" className={inputCls} value={np.phone} onChange={e => setNp({ ...np, phone: e.target.value })} placeholder="+91 …" /></Field>
              <Field label="Website"><input className={inputCls} value={np.website} onChange={e => setNp({ ...np, website: e.target.value })} placeholder="https://" /></Field>
              <div className="md:col-span-2"><Field label="Description (optional)"><textarea rows={3} className={areaCls} value={np.description} onChange={e => setNp({ ...np, description: e.target.value.slice(0, 750) })} /></Field></div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-13 text-slate-600">
            <div className="font-semibold text-slate-800">{b.name || 'Unnamed project'}</div>
            <div className="mt-0.5">{[b.phone, b.website].filter(Boolean).join(' · ') || 'No phone or website yet. Add them on Edit profile, then create.'}</div>
            <div className="text-12 text-slate-500 mt-1">The name, phone, website, description and hours come from this project. Use the real business name: no keywords or city names.</div>
          </div>
        )}

        {list.length === 0 && !conns.loading ? (
          <p className="text-13 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">No Google account is connected yet. Use <b>Connect Google account</b> first, then come back.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Google account"><Select className={inputCls} value={connectionId} onChange={e => { setConnectionId(e.target.value); setAccount(''); setChecked(''); }} aria-label="Google account">{list.map(c => <option key={c.id} value={c.id}>{c.email}</option>)}</Select></Field>
            <Field label="Business account (owner)" hint="The profile is created under this account.">
              <Select className={inputCls} value={account} onChange={e => { setAccount(e.target.value); setChecked(''); }} aria-label="Business account">{(accounts.data || []).map(x => <option key={x.name} value={x.name}>{x.title}</option>)}</Select>
            </Field>
          </div>
        )}

        <Field label="Primary category" hint="Google only accepts its own categories. Type, then pick one.">
          {category ? (
            <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-13 text-indigo-700"><CheckCircle2 size={14} />{category.displayName}</span><button type="button" onClick={() => { setCategory(null); setChecked(''); }} className="text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Change category"><X size={15} /></button></div>
          ) : (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              <input className={`${inputCls} pl-8`} value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. clothing rental, dentist, restaurant" aria-label="Search categories" />
              {found.length > 0 && <ul className="mt-1 rounded-lg ring-1 ring-slate-200 bg-white shadow-sm max-h-48 overflow-y-auto py-1">{found.map(c => <li key={c.name}><button type="button" onClick={() => { setCategory(c); setFound([]); setChecked(''); }} className="w-full text-left px-3 py-2 text-13 hover:bg-indigo-50 cursor-pointer">{c.displayName}</button></li>)}</ul>}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><Field label="Street address"><input className={inputCls} value={a.line1} onChange={e => set('line1', e.target.value)} placeholder="Shop / building, street" /></Field></div>
          <div className="md:col-span-2"><Field label="Area / landmark (optional)"><input className={inputCls} value={a.line2} onChange={e => set('line2', e.target.value)} /></Field></div>
          <Field label="City"><input className={inputCls} value={a.locality} onChange={e => set('locality', e.target.value)} /></Field>
          <Field label="State"><input className={inputCls} value={a.state} onChange={e => set('state', e.target.value)} /></Field>
          <Field label="Postal code"><input className={inputCls} value={a.postal} onChange={e => set('postal', e.target.value)} /></Field>
          <Field label="Country code"><input className={inputCls} value={a.region} onChange={e => set('region', e.target.value.toUpperCase().slice(0, 2))} /></Field>
        </div>

        {problem && <p className="text-12.5 text-slate-500">{problem}</p>}
        {checked && <p className="text-13 text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex items-center gap-2"><CheckCircle2 size={15} />{checked}</p>}
        <ErrorNote>{error}</ErrorNote>
        <p className="text-12 text-slate-500 flex items-start gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0" />A new profile is not shown on Google Search or Maps until it is verified (postcard, phone, email or video). After creating, you go to Settings to verify it.</p>
      </div>
    </Modal>
  );
}
