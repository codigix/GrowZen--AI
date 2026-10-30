import React, { useState, useEffect } from 'react';
import { KeyRound, Loader2, X, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { api } from '../platform/seoApi';

export default function PasswordGate({ user, onClose, onChanged }) {
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const bad = form.next.length < 10 
    ? 'Use at least 10 characters for your new password.' 
    : form.next !== form.again 
    ? 'The two new passwords do not match.' 
    : '';

  const save = async (e) => {
    e.preventDefault();
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { current: form.current, new: form.next }
      });
      setSuccess('Password changed successfully!');
      setTimeout(() => {
        if (onChanged) onChanged();
        if (onClose) onClose();
      }, 1200);
    } catch (err) {
      if (err.status === 403 || err.message?.toLowerCase().includes('wrong')) {
        setError('The current password entered is incorrect.');
      } else {
        setError(err.message || 'Could not change the password.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Change your password"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 relative">
        {/* Close Button */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}

        {/* Modal Header */}
        <div className="flex items-start gap-3.5 mb-5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
            <KeyRound size={20} />
          </div>
          <div className="pr-6">
            <h2 className="text-16 font-bold text-slate-900">Change Password</h2>
            <p className="text-12 text-slate-500 mt-0.5">
              Update password for <span className="font-semibold text-slate-700">{user?.email || 'your account'}</span>.
            </p>
          </div>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-12 font-semibold text-slate-700 mb-1">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={form.current}
                onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
                autoComplete="current-password"
                required
                placeholder="Enter current password"
                className="w-full h-10 pl-3 pr-10 text-13 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(s => !s)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-12 font-semibold text-slate-700 mb-1">
              New Password (10+ characters)
            </label>
            <div className="relative">
              <input
                type={showNext ? 'text' : 'password'}
                value={form.next}
                onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
                autoComplete="new-password"
                required
                placeholder="Enter at least 10 characters"
                className="w-full h-10 pl-3 pr-10 text-13 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNext(s => !s)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showNext ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-12 font-semibold text-slate-700 mb-1">
              Confirm New Password
            </label>
            <input
              type={showNext ? 'text' : 'password'}
              value={form.again}
              onChange={e => setForm(f => ({ ...f, again: e.target.value }))}
              autoComplete="new-password"
              required
              placeholder="Re-enter new password"
              className="w-full h-10 px-3 text-13 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
            />
          </div>

          {error && (
            <div className="text-12 font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {success && (
            <div className="text-12 font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-600" />
              <span>{success}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg text-13 font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="h-9 px-5 rounded-lg bg-indigo-600 text-white text-13 font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              <span>Save Password</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
