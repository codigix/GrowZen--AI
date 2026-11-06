import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Smartphone, Loader2, KeyRound } from 'lucide-react';
import { Modal, Button, ErrorNote, useBusinesses } from './SeoUi';
import { api } from './seoApi';
import { currentCodeRequest, markTwoFactor, subscribeProjectCode, twoFactorStatus } from './projectCode';

const digits = (s) => String(s || '').replace(/\D/g, '').slice(0, 6);

/** The 6-digit code in one field: numeric, paste-friendly (spaces are dropped), Enter submits. */
function CodeInput({ value, onChange, onEnter, disabled }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input ref={ref} value={value} onChange={e => onChange(digits(e.target.value))} onKeyDown={e => e.key === 'Enter' && onEnter?.()} disabled={disabled}
      inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="6-digit authenticator code"
      className="w-full h-12 text-center text-[22px] font-semibold tracking-[0.5em] rounded bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 placeholder-slate-300" />
  );
}

/** Set up the authenticator app: a QR code (or the key), then one code to prove it works. `onDone` runs after it is switched on. */
export function TwoFactorSetup({ businessId, onDone, onCancel }) {
  const [info, setInfo] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api('/auth/2fa/setup', { method: 'POST' }).then(d => live && setInfo(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, []);
  const confirm = async () => {
    if (code.length !== 6) { setError('Enter the 6-digit code shown in your app.'); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/2fa/enable', { method: 'POST', body: { code, ...(businessId ? { business_id: businessId } : {}) } });
      markTwoFactor(true);
      onDone();
    } catch (e) { setError(e.message); setCode(''); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 text-13 text-slate-700">
      <ol className="space-y-1.5 list-decimal pl-5 text-slate-600">
        <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
        <li>Scan the QR code, or type the key in by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {!info && !error && <div className="flex items-center justify-center gap-2 py-6 text-slate-500"><Loader2 size={16} className="animate-spin" /> Preparing…</div>}
      {info && (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {info.qr && <img src={info.qr} alt="QR code for your authenticator app" className="w-40 h-40 rounded ring-1 ring-slate-200 bg-white p-1 shrink-0" />}
          <div className="min-w-0 w-full">
            <div className="text-11 font-bold uppercase tracking-wide text-slate-500">Setup key</div>
            <code className="block mt-1 px-2.5 py-2 rounded bg-slate-100 text-12 break-all select-all">{info.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <div className="mt-1 text-11 text-slate-500">Time-based, 6 digits. Keep it private: anyone with it can make your codes.</div>
          </div>
        </div>
      )}
      {info && <CodeInput value={code} onChange={setCode} onEnter={confirm} disabled={busy} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button variant="primary" busy={busy} disabled={!info} onClick={confirm}>{businessId ? 'Turn on and continue' : 'Turn on'}</Button>
      </div>
    </div>
  );
}

/** The window that appears whenever a project is switched (or a project's data asks for a code). Mounted once, in App. */
export default function ProjectCodeHost() {
  const [, force] = useState(0);
  useEffect(() => subscribeProjectCode(() => force(x => x + 1)), []);
  const req = currentCodeRequest();
  const { list } = useBusinesses();
  const [enabled, setEnabled] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = req?.businessId;
  useEffect(() => {
    setCode(''); setError(''); setEnabled(null);
    if (id) twoFactorStatus().then(s => setEnabled(s.enabled));
  }, [id]);
  if (!req) return null;
  const name = list?.find(b => b.id === req.businessId)?.name;
  const submit = async () => {
    if (code.length !== 6) { setError('Enter the 6-digit code shown in your app.'); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/switch-project', { method: 'POST', body: { business_id: req.businessId, code } });
      req.resolve(true);
    } catch (e) {
      if (/set up your authenticator/i.test(e.message)) { markTwoFactor(false); setEnabled(false); } else setError(e.message);
      setCode('');
    } finally { setBusy(false); }
  };
  const cancel = () => req.resolve(false);
  return (
    <Modal open onClose={cancel} width="max-w-md" title={enabled === false ? 'Set up two-step verification' : 'Confirm it is you'}
      footer={enabled ? <><Button onClick={cancel} disabled={busy}>Cancel</Button><Button variant="primary" busy={busy} onClick={submit}>Open project</Button></> : null}>
      {enabled === null && <div className="flex items-center justify-center gap-2 py-8 text-13 text-slate-500"><Loader2 size={16} className="animate-spin" /> Checking…</div>}
      {enabled === false && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded bg-indigo-50 ring-1 ring-inset ring-indigo-100 px-3 py-2.5 text-13 text-indigo-900">
            <ShieldCheck size={16} className="shrink-0 mt-0.5" />
            <span>Switching projects needs a code from your authenticator app{name ? <>, to open <b>{name}</b></> : ''}. Set it up once; after that you only enter the code.</span>
          </div>
          <TwoFactorSetup businessId={req.businessId} onDone={() => req.resolve(true)} onCancel={cancel} />
        </div>
      )}
      {enabled === true && (
        <div className="space-y-3 text-13 text-slate-700">
          <div className="flex items-start gap-2"><Smartphone size={16} className="shrink-0 mt-0.5 text-indigo-600" />
            <span>Open your authenticator app and enter the 6-digit code{name ? <> to open <b>{name}</b></> : ' to open this project'}.</span></div>
          <CodeInput value={code} onChange={setCode} onEnter={submit} disabled={busy} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <p className="text-12 text-slate-500">Lost your phone or app? Ask an administrator to reset your two-step verification.</p>
        </div>
      )}
    </Modal>
  );
}

/** Account security card: status and turn on / off (shown in the account window next to the password). */
export function TwoFactorCard() {
  const [st, setSt] = useState(null);
  const [mode, setMode] = useState('idle'); // idle | setup | off
  const [form, setForm] = useState({ code: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { twoFactorStatus(true).then(setSt); }, []);
  const turnOff = async () => {
    setBusy(true); setError('');
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: form });
      markTwoFactor(false); setSt({ enabled: false, can: true }); setMode('idle'); setForm({ code: '', password: '' });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!st) return null;
  const inp = 'w-full h-9 px-3 text-13 rounded bg-white ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none';
  return (
    <div className="mt-5 pt-5 border-t border-slate-200 text-13">
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${st.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}><ShieldCheck size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900">Two-step verification {st.enabled
            ? <span className="ml-1 text-11 font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">ON</span>
            : <span className="ml-1 text-11 font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">OFF</span>}</div>
          <div className="text-12 text-slate-500 mt-0.5">{!st.can ? 'This account signs in through the CRM, so it is not available here.' : 'Asks for a code from your authenticator app every time you switch to another project.'}</div>
          {st.can && mode === 'idle' && (
            <div className="mt-2">{st.enabled
              ? <Button onClick={() => setMode('off')}>Turn off…</Button>
              : <Button variant="primary" onClick={() => setMode('setup')}><KeyRound size={13} /> Set up</Button>}</div>
          )}
          {mode === 'setup' && <div className="mt-3"><TwoFactorSetup onDone={() => { setSt({ enabled: true, can: true }); setMode('idle'); }} onCancel={() => setMode('idle')} /></div>}
          {mode === 'off' && (
            <div className="mt-3 space-y-2 max-w-xs">
              <input type="password" className={inp} placeholder="Your password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="current-password" />
              <input className={inp} placeholder="Current 6-digit code" inputMode="numeric" value={form.code} onChange={e => setForm({ ...form, code: digits(e.target.value) })} autoComplete="one-time-code" />
              {error && <ErrorNote>{error}</ErrorNote>}
              <div className="flex gap-2"><Button onClick={() => { setMode('idle'); setError(''); }} disabled={busy}>Cancel</Button><Button busy={busy} onClick={turnOff} className="!bg-rose-600 !text-white !border-rose-600 hover:!bg-rose-700">Turn off</Button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
