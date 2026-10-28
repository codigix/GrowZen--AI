import React, { useState } from 'react';
import { Loader2, Mail, Lock, Eye, EyeOff, Sparkles, Zap, CheckCircle2, ArrowRight, ShieldCheck, TrendingUp, Star } from 'lucide-react';
import { api } from '../platform/seoApi';

export default function LoginPage({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    if (e) e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      await onSignedIn();
    } catch (err) {
      setError(err.message || 'Failed to sign in. Please verify your credentials.');
      setBusy(false);
    }
  };

  const fillAdmin = () => {
    setEmail('info@codigixinfotech.com');
    setPassword('Seo@1d86f6a045');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center relative overflow-hidden ">
      {/* Ambient background glow orbs */}
      <div className="absolute pointer-events-none -top-40 -left-40 w-96 h-96 rounded-full bg-indigo-400/20 blur-3xl" />
      <div className="absolute pointer-events-none -bottom-40 -right-40 w-96 h-96 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute pointer-events-none top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-purple-400/10 blur-[120px]" />

      {/* Decorative Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-12 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left column: Value Proposition & Brand */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 text-xs font-semibold backdrop-blur">
            <Sparkles size={13} className="text-cyan-700" />
            <span>Autonomous Local Growth Platform</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-white border border-blue-500/20 p-2 flex items-center justify-center text-slate-900 shadow-xl shadow-blue-500/10 ring-1 ring-slate-200 shrink-0">
                <img src="/bevisibe-icon.png" alt="bevisibe Logo" className="w-full h-full object-contain filter drop-shadow" />
              </div>
              <div>
                <h1 className="text-3xl lg:text-4xl font-extrabold tracking-tight font-display text-slate-900 flex items-center gap-2">
                  <span>bevisibe</span> <span className="text-gradient">AI</span>
                </h1>
                <p className="text-[11px] text-teal-700 font-mono font-bold uppercase tracking-wider mt-0.5">
                  Autonomous Local SEO Engine
                </p>
              </div>
            </div>
            <p className="text-slate-500 text-base max-w-lg leading-relaxed pt-2">
              The next-generation enterprise engine for local SEO automation, Google Business Profile management, rank grid analysis, and AI-driven growth.
            </p>
          </div>

          {/* Value cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="p-4 rounded-2xl bg-white border border-slate-200 backdrop-blur-md">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center mb-2.5">
                <TrendingUp size={16} />
              </div>
              <div className="text-[14px] font-bold text-slate-900">Live Geo Rank Grids</div>
              <p className="text-[12px] text-slate-500 mt-1">Multi-point radius tracking on Google Maps with centroid density maps.</p>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-slate-200 backdrop-blur-md">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-700 flex items-center justify-center mb-2.5">
                <Star size={16} />
              </div>
              <div className="text-[14px] font-bold text-slate-900">Autonomous Review AI</div>
              <p className="text-[12px] text-slate-500 mt-1">Instant sentiment classification and personalized AI responses on autopilot.</p>
            </div>
          </div>

          <div className="flex items-center gap-6 pt-2 text-xs text-slate-500 font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-700" />
              <span>DeepSeek & Gemini AI logic</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-cyan-700" />
              <span>Multi-client management</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-indigo-600" />
              <span>Lighthouse audits</span>
            </div>
          </div>
        </div>

        {/* Right column: Login Card */}
        <div className="lg:col-span-5">
          <div className="relative bg-white backdrop-blur-xl border border-slate-200 rounded-3xl p-7 lg:p-8 shadow-2xl shadow-slate-900/10 ring-1 ring-slate-200">
            <div className="mb-6 text-center lg:text-left">
              <div className="flex items-center justify-center lg:justify-start mb-4">
                <img src="/bevisibe-horizontal.png" alt="bevisibe" className="h-12 w-auto object-contain filter drop-shadow-md" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 font-display">Sign In</h2>
              <p className="text-[13px] text-slate-500 mt-1">Access your agency dashboard and client portfolios</p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Mail size={16} />
                  </div>
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    placeholder="admin@agency.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full h-10 pl-10 pr-3.5 text-[13px] bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock size={16} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full h-10 pl-10 pr-10 text-[13px] bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="text-[12px] font-medium text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 text-white text-[13px] font-bold hover:opacity-95 shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : (
                  <>
                    <span>Enter Platform</span>
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>

            {/* Quick Demo Credentials Helper */}
            <div className="mt-6 pt-5 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">Default Dev Account:</span>
                <button
                  type="button"
                  onClick={fillAdmin}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Sparkles size={11} /> Auto-fill Admin
                </button>
              </div>
              <div className="mt-2 text-[11px] bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-500 font-mono flex flex-col gap-0.5">
                <div><span className="text-slate-500">Email:</span> info@codigixinfotech.com</div>
                <div><span className="text-slate-500">Password:</span> Seo@1d86f6a045</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
