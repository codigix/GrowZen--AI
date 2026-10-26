import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../platform/seoApi';
import { inputCls } from '../platform/SeoUi';

export default function LoginPage({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      await onSignedIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9] px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-6">
        <h1 className="text-lg font-semibold text-gray-900">SEO Platform</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Sign in to continue</p>
        <label className="block mt-5 text-[12px] font-medium text-gray-700">Email</label>
        <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} className={`${inputCls} mt-1 h-9`} />
        <label className="block mt-3 text-[12px] font-medium text-gray-700">Password</label>
        <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={`${inputCls} mt-1 h-9`} />
        {error && <div className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{error}</div>}
        <button type="submit" disabled={busy} className="mt-5 w-full h-9 inline-flex items-center justify-center gap-2 rounded bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-60 cursor-pointer">
          {busy && <Loader2 size={14} className="animate-spin" />} Sign in
        </button>
      </form>
    </div>
  );
}
