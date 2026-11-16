import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Users, Megaphone, AlertTriangle, Plus, Trash2, KeyRound, Mail, Phone, MapPinned, Bot, ExternalLink } from 'lucide-react';
import { Card, Badge, Button, ErrorNote, Field, inputCls, useAction, useDoubleConfirm } from './SeoUi';
import { api, useApi } from './seoApi';
import Select from '../components/Select';
import { VerifyPill } from './GbpAccounts';

const METHOD_INFO = {
  EMAIL: ['Email', Mail, 'Google emails a code to the address you choose.'],
  PHONE_CALL: ['Phone call', Phone, 'An automated call reads out a code. Answer on the business number.'],
  SMS: ['Text message', Phone, 'Google texts a code to the business number.'],
  ADDRESS: ['Postcard', MapPinned, 'A postcard with a code is mailed to the business address. It takes about 5 days.'],
  AUTO: ['Instant', ShieldCheck, 'Google can already confirm the business, so it is verified straight away.'],
  VETTED_PARTNER: ['Partner', Users, 'Verified through a Google partner, with no code.']
};
const ROLE_LABEL = { PRIMARY_OWNER: 'Primary owner', OWNER: 'Owner', MANAGER: 'Manager', SITE_MANAGER: 'Site manager' };
const ROLE_INFO = { OWNER: 'Full control, can add and remove people', MANAGER: 'Edits the profile, cannot manage owners', SITE_MANAGER: 'Can edit only the website and basic details' };

/** Settings card: verify the profile with Google (choose a method, enter the code Google sends). */
export function VerificationCard({ b, state, onChanged, toast }) {
  const v = useApi(`/businesses/${b.id}/gbp/verification`);
  const [busy, error, run] = useAction();
  const [method, setMethod] = useState('');
  const [target, setTarget] = useState('');
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(null); // the verification just started, waiting for its code
  const d = v.data;
  const options = d?.options || [];
  const chosen = options.find(o => o.verificationMethod === method);
  const targets = chosen?.verificationMethod === 'EMAIL' ? (chosen.emailData ? [`${chosen.emailData.user}@${chosen.emailData.domainName}`] : []) : chosen?.phoneNumber ? [chosen.phoneNumber] : [];
  const waiting = pending || (d?.history || []).find(h => h.state === 'PENDING');
  const start = () => run('start', async () => {
    const body = { method, ...(method === 'EMAIL' ? { email: target || targets[0] } : {}), ...(method === 'PHONE_CALL' || method === 'SMS' ? { phone: target || targets[0] } : {}) };
    const r = await api(`/businesses/${b.id}/gbp/verification/start`, { method: 'POST', body });
    setPending(r); v.reload(true);
    toast(r.state === 'COMPLETED' ? 'Verified' : 'Verification started: enter the code when it arrives');
    if (r.state === 'COMPLETED') onChanged?.();
  });
  const complete = () => run('done', async () => {
    const r = await api(`/businesses/${b.id}/gbp/verification/complete`, { method: 'POST', body: { verification_id: waiting.name, pin } });
    setPin(''); setPending(null); v.reload(true);
    toast(r.state === 'COMPLETED' ? 'Your profile is verified' : 'Code received: Google is still checking it');
    onChanged?.();
  });
  return (
    <Card title="Verification" subtitle="Google must verify the business before it can edit hours, post or reply to reviews." action={<VerifyPill state={state} />}>
      {!d ? <p className="text-13 text-slate-500">Asking Google…</p> : state === 'verified' ? (
        <p className="text-13 text-emerald-700">This profile is verified. Nothing more to do.</p>
      ) : (
        <div className="space-y-4">
          {waiting && (
            <div className="rounded-lg bg-indigo-50 ring-1 ring-indigo-200 p-3.5">
              <div className="text-13 font-semibold text-indigo-900 flex items-center gap-1.5"><KeyRound size={14} />Enter the code Google sent ({METHOD_INFO[waiting.method]?.[0] || waiting.method})</div>
              <div className="mt-2 flex gap-2">
                <input className={`${inputCls} w-44 font-mono tracking-widest`} value={pin} onChange={e => setPin(e.target.value.replace(/\s/g, ''))} placeholder="123456" aria-label="Verification code" inputMode="numeric" />
                <Button variant="primary" busy={busy === 'done'} disabled={pin.length < 3} onClick={complete}>Verify</Button>
              </div>
            </div>
          )}
          {options.length > 0 ? (
            <div>
              <div className="text-13 font-semibold text-slate-800 mb-2">Choose a way to verify</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {options.map(o => {
                  const [label, Icon, info] = METHOD_INFO[o.verificationMethod] || [o.verificationMethod, ShieldCheck, ''];
                  const on = method === o.verificationMethod;
                  return (
                    <button key={o.verificationMethod} type="button" onClick={() => { setMethod(o.verificationMethod); setTarget(''); }} aria-pressed={on}
                      className={`text-left rounded-lg p-3 ring-1 cursor-pointer transition-colors ${on ? 'ring-2 ring-indigo-500 bg-indigo-50' : 'ring-slate-200 hover:bg-slate-50'}`}>
                      <div className="flex items-center gap-2 text-13 font-semibold text-slate-900"><Icon size={15} className="text-indigo-600" />{label}</div>
                      <div className="text-12 text-slate-500 mt-1">{info}</div>
                    </button>
                  );
                })}
              </div>
              {method && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {targets.length > 1 && <div className="w-64"><Field label="Send it to"><Select className={inputCls} value={target || targets[0]} onChange={e => setTarget(e.target.value)}>{targets.map(t => <option key={t} value={t}>{t}</option>)}</Select></Field></div>}
                  {targets.length === 1 && <div className="text-13 text-slate-600 pb-2">Sent to <b>{targets[0]}</b></div>}
                  <Button variant="primary" busy={busy === 'start'} onClick={start}>{method === 'ADDRESS' ? 'Mail me the postcard' : 'Send the code'}</Button>
                </div>
              )}
            </div>
          ) : <p className="text-13 text-slate-600">Google gave no verification method right now{d.options_error ? `: ${d.options_error}` : '.'}</p>}
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

/** Settings card: who manages this profile on Google, add and remove. */
export function ManagersCard({ b, toast }) {
  const list = useApi(`/businesses/${b.id}/gbp/managers`);
  const [busy, error, run] = useAction();
  const [ask, confirmNode] = useDoubleConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MANAGER');
  const add = () => run('add', async () => {
    await api(`/businesses/${b.id}/gbp/managers`, { method: 'POST', body: { email: email.trim(), role } });
    setEmail(''); list.reload(true); toast('Invitation sent: they accept it from the email Google sends');
  });
  const remove = (m) => ask({ what: `${m.email} from this profile`, effect: 'They lose access to this Business Profile on Google straight away.', onConfirm: () => run(`r${m.name}`, async () => { await api(`/businesses/${b.id}/gbp/managers?name=${encodeURIComponent(m.name)}`, { method: 'DELETE' }); list.reload(true); toast('Removed from Google'); }) });
  return (
    <Card title="People with access" subtitle="Who can manage this profile on Google. Changes apply on Google itself.">
      {confirmNode}
      {!list.data ? <p className="text-13 text-slate-500">{list.error ? list.error.message : 'Asking Google…'}</p> : (
        <ul className="divide-y divide-slate-100">
          {list.data.map(m => (
            <li key={m.name} className="py-2.5 flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 text-12 font-semibold flex items-center justify-center shrink-0">{(m.email || '?').charAt(0).toUpperCase()}</span>
              <div className="flex-1 min-w-0"><div className="text-13 text-slate-900 truncate">{m.email}</div></div>
              <Badge tone={m.role === 'PRIMARY_OWNER' || m.role === 'OWNER' ? 'violet' : 'blue'}>{ROLE_LABEL[m.role] || m.role}</Badge>
              {m.pending && <Badge tone="amber">Invited</Badge>}
              {m.removable ? <button type="button" onClick={() => remove(m)} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Remove ${m.email}`}><Trash2 size={14} /></button> : <span className="w-6" />}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]"><Field label="Add a person by email"><input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></Field></div>
        <div className="w-44"><Field label="Role"><Select className={inputCls} value={role} onChange={e => setRole(e.target.value)} aria-label="Role">{Object.keys(ROLE_INFO).map(k => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}</Select></Field></div>
        <Button variant="primary" icon={Plus} busy={busy === 'add'} disabled={!/.+@.+\..+/.test(email.trim())} onClick={add}>Invite</Button>
      </div>
      <p className="text-12 text-slate-400 mt-2">{ROLE_INFO[role]}. The primary owner and the account connected to this software cannot be removed here.</p>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

export function AdvertiseCard() {
  return (
    <Card title="Advertise on Google" subtitle="Reach more people in your area with Google Ads.">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center shrink-0"><Megaphone size={18} /></span>
        <div className="flex-1 text-13 text-slate-600">
          Campaigns are created and paid for inside Google Ads. Our assistant prepares what you need first: keywords, ad headlines and a daily budget, from this project's services and city.
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/ads-assistant"><Button icon={Bot}>Plan ads with our assistant</Button></Link>
            <a href="https://ads.google.com/" target="_blank" rel="noreferrer"><Button icon={ExternalLink}>Open Google Ads</Button></a>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Settings card: delete the listing on Google (the project stays, unlinked). */
export function DangerCard({ b, onChanged, toast }) {
  const [busy, error, run] = useAction();
  const [ask, confirmNode] = useDoubleConfirm();
  const [typed, setTyped] = useState('');
  const go = () => ask({ what: 'this Business Profile on Google', effect: 'The listing disappears from Google Search and Maps, with its reviews, photos and posts. This cannot be undone. The project stays here, unlinked.', onConfirm: () => run('del', async () => {
    await api(`/businesses/${b.id}/gbp/profile`, { method: 'DELETE', body: { confirm_name: typed.trim() } });
    setTyped(''); toast('The profile was deleted on Google and unlinked from this project'); onChanged?.();
  }) });
  return (
    <section className="rounded border border-red-200 bg-red-50/40 p-5">
      {confirmNode}
      <h3 className="text-15 font-semibold text-red-700 flex items-center gap-2"><AlertTriangle size={16} />Danger zone</h3>
      <p className="text-13 text-slate-700 mt-1.5">Delete this Business Profile from Google. Customers will no longer find it, and its reviews, photos and posts are lost for good. Only do this for a duplicate or a business that has closed.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]"><Field label={`Type “${b.name}” to confirm`}><input className={inputCls} value={typed} onChange={e => setTyped(e.target.value)} aria-label="Business name to confirm" /></Field></div>
        <Button variant="danger" icon={Trash2} busy={busy === 'del'} disabled={typed.trim() !== b.name.trim()} onClick={go}>Delete on Google</Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
