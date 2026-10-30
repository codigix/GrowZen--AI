import React, { useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { api } from '../platform/seoApi';

/**
 * Shown over everything while the signed-in account still uses a password that was published in the project's
 * source (GET /me says must_change_password). It cannot be dismissed: the account is not safe until it changes.
 */
export default function PasswordGate({ user, onChanged }) {
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bad = form.next.length < 10 ? 'Use at least 10 characters.' : form.next !== form.again ? 'The two new passwords differ.' : '';
  const save = async (e) => {
    e.preventDefault();
    if (bad) { setError(bad); return; }
    setBusy(true); setError('');
    try { await api('/auth/change-password', { method: 'POST', body: { current: form.current, new: form.next } }); onChanged(); } catch (err) { setError(err.message || 'Could not change the password.'); } finally { setBusy(false); }
  };
  const field = (k, label, type = 'password') => (
    <label className="block text-12 font-medium text-slate-600">{label}
      <input type={type} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} autoComplete={k === 'current' ? 'current-password' : 'new-password'} required
        className="mt-1 w-full h-10 px-3 text-14 rounded border border-slate-200 bg-white text-slate-900 focus:border-indigo-400 outline-none" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Change your password">
      <form onSubmit={save} className="w-full max-w-md rounded-lg bg-white shadow-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center shrink-0"><ShieldAlert size={20} /></span>
          <div>
            <h2 className="text-16 font-bold text-slate-900">Change your password to continue</h2>
            <p className="text-13 text-slate-500 mt-1">{user?.email || 'This account'} still uses a password that was published with the project. Anyone who has seen it can sign in. Choose your own.</p>
          </div>
        </div>
        {field('current', 'Current password')}
        {field('next', 'New password (10+ characters)')}
        {field('again', 'New password again')}
        {error && <div className="text-12.5 text-red-600 bg-red-50 rounded px-3 py-2">{error}</div>}
        <button type="submit" disabled={busy} className="w-full h-10 rounded bg-indigo-500 text-white text-14 font-semibold hover:bg-indigo-600 disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />}Change password</button>
      </form>
    </div>
  );
}
