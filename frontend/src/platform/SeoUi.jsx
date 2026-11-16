import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { StepBar } from './JourneyBar';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TAB_BASES, HIDE_STRIP, LIST_BASES } from './tabPages';
import {
  ChevronDown, Check, X, Loader2, AlertTriangle, AlertCircle, CheckCircle2, Info, MapPin,
  Plug, ServerCrash, Plus, Mail, Store, RefreshCw, Sparkles, Building2, ExternalLink, Cpu,
  Bell, Calendar
} from 'lucide-react';
import { api, toUi, SEO_API } from './seoApi';
import NotificationBell from '../components/NotificationBell';
import { MarketBadge } from './MarketBadge';
import Breadcrumbs from './Breadcrumbs';
import { needsSwitchCode, verifyProjectSwitch } from './projectCode';

// Categorical palette, tuned for white surfaces
export const SERIES = ['#6658dd', '#4a81d4', '#1abc9c', '#f7b84b', '#f1556c', '#43bfe5', '#313a46', '#9ba6b7'];
export const STATUS = { good: '#1abc9c', warning: '#f7b84b', serious: '#f1556c', critical: '#f1556c' };
export const INK = { primary: '#0f172a', secondary: '#475569', muted: '#64748b', grid: '#e2e8f0', axis: '#cbd5e1', up: '#059669' };

// Shared businesses store
const store = { list: null, error: null, loading: false, listeners: new Set() };
const notify = () => store.listeners.forEach(fn => fn());

/** Drop the project list and the remembered selection (sign-out / another account). */
export const resetBusinessesStore = () => {
  store.list = null; store.error = null; store.loading = false; notify();
  try { localStorage.removeItem('seoBusinessId'); } catch (e) { /* ignore */ }
  window.dispatchEvent(new Event('seo-business'));
};

export const refreshBusinesses = async () => {
  store.loading = true; notify();
  try {
    store.list = (await api('/businesses')).map(toUi);
    store.error = null;
  } catch (e) {
    store.error = e;
  }
  store.loading = false; notify();
  return store.list;
};

export const useBusinesses = () => {
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => {
    store.listeners.add(force);
    if (!store.list && !store.loading) refreshBusinesses();
    return () => store.listeners.delete(force);
  }, []);
  return { list: store.list, error: store.error, loading: store.loading, refresh: refreshBusinesses };
};

// Selected business in current browser
const KEY = 'seoBusinessId';
export const useSeoBusiness = () => {
  const { list } = useBusinesses();
  const read = () => { try { return Number(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener('seo-business', on);
    return () => window.removeEventListener('seo-business', on);
  }, []);
  // Switching to another project needs an authenticator code (two-step verification). Resolves true when the project was switched, false when
  // the code was not given (cancel): callers that navigate afterwards wait for it: `choose(id).then(ok => ok && navigate(...))`.
  const choose = useCallback(async (next) => {
    const n = Number(next);
    let current = null;
    try { current = Number(localStorage.getItem(KEY)) || null; } catch (e) { /* private window */ }
    current = current || store.list?.[0]?.id || null;
    if (n !== current && (store.list?.length || 0) > 0 && await needsSwitchCode(store.list.length) && !(await verifyProjectSwitch(n))) return false;
    try { localStorage.setItem(KEY, String(n)); } catch (e) { /* private window */ }
    setId(n);
    window.dispatchEvent(new Event('seo-business'));
    return true;
  }, []);
  // A remembered project that is not in this account's list (someone else's, or deleted) falls back to the first one the account owns.
  const business = list ? (list.find(b => b.id === id) || list[0] || null) : null;
  return [business, choose];
};

export const useAction = () => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = useCallback(async (label, fn) => {
    setBusy(label); setError('');
    try { return await fn(); } catch (e) { setError(e.message || String(e)); return undefined; } finally { setBusy(''); }
  }, []);
  return [busy, error, run, setError];
};

export const useModulePath = () => (slug) => `/${slug}`;

// Futuristic Glassmorphic Business Switcher
const BusinessSwitcher = ({ business, onChange, list }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const path = useModulePath();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 h-10 px-3 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-all cursor-pointer text-left group"
      >
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-12 font-bold flex items-center justify-center shrink-0 shadow-sm">
          {business.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 pr-1">
          <div className="text-12 font-bold text-slate-900 truncate max-w-[150px] leading-tight group-hover:text-blue-700 transition-colors">
            {business.name}
          </div>
          <div className="text-10 text-slate-500 truncate leading-tight mt-0.5">
            {[business.city, business.area].filter(Boolean).join(', ') || 'No location set'} ▾
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[21rem] bg-white backdrop-blur-2xl border border-slate-300 rounded shadow-2xl z-50 py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-900 ring-1 ring-slate-900/5">
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
            <span className="text-11 font-bold   text-slate-500 ">Managed Entities</span>
            <span className="text-11 bg-slate-100 text-cyan-700 border border-cyan-500/30 font-bold px-2 py-0.5 rounded-full">
              {list.length} clients
            </span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto no-scrollbar py-1">
            {list.map(b => (
              <button
                key={b.id}
                onClick={() => { onChange(b.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${b.id === business.id ? 'bg-indigo-600/20 text-slate-900 font-medium border-l-2 border-indigo-400' : 'hover:bg-slate-50 text-slate-700'
                  }`}
              >
                <span className={`w-8 h-8 rounded text-12 font-bold flex items-center justify-center shrink-0 ${b.id === business.id ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700 border border-slate-200'
                  }`}>
                  {b.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-13 font-semibold truncate text-slate-900">{b.name}</span>
                  <span className="block text-11 text-slate-500 truncate flex items-center gap-1 mt-0.5">
                    <MapPin size={11} className="text-slate-500" /> {[b.area, b.city].filter(Boolean).join(', ') || 'Online / Remote'}
                  </span>
                </span>
                {b.id === business.id && (
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-600 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <Check size={12} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-2.5 border-t border-slate-200 bg-slate-50">
            <button
              onClick={() => { setOpen(false); navigate(`${path('gmb-profile')}?connect=1`); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded bg-indigo-500 hover:bg-indigo-600 text-white text-12 font-semibold transition-colors cursor-pointer"
            >
              <Plus size={14} /> Add new client business
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const BackendDown = ({ error, onRetry }) => (
  <div className="bg-white backdrop-blur-xl rounded border border-rose-500/30 p-8 max-w-2xl shadow-2xl shadow-rose-200/50 text-slate-900">
    <div className="flex items-center gap-3.5 text-rose-600 font-bold text-lg font-display">
      <div className="w-11 h-11 rounded bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600">
        <ServerCrash size={24} />
      </div>
      <div>
        <div>{error?.status === 401 ? 'Authentication Required' : error?.status === 403 ? 'Access Forbidden' : 'Backend Engine Offline'}</div>
        <p className="text-13 text-slate-500 font-normal mt-0.5">{error?.message || 'FastAPI service on port 8000 is not responding'}</p>
      </div>
    </div>
    {!error?.status && (
      <div className="mt-6">
        <span className="text-12 font-bold text-slate-500   ">Terminal start command:</span>
        <pre className="mt-2 text-12 bg-slate-50 text-slate-800 rounded p-4  overflow-x-auto border border-slate-200 shadow-inner">
          {'cd backend\n.\\.venv\\Scripts\\activate\nuvicorn app.main:app --port 8000'}
        </pre>
      </div>
    )}
    <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-200">
      <span className="text-12 text-slate-500 ">Endpoint: {SEO_API}</span>
      <Button variant="primary" icon={RefreshCw} onClick={onRetry}>Retry Handshake</Button>
    </div>
  </div>
);

const NoBusinesses = ({ onCreated }) => {
  const navigate = useNavigate();
  const path = useModulePath();
  const [form, setForm] = useState({ name: '', primary_category: '', phone: '', website: '', area: '', city: '' });
  const [busy, error, run] = useAction();
  const create = () => run('create', async () => {
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    const b = await api('/businesses', { method: 'POST', body });
    await refreshBusinesses();
    onCreated(b.id);
  });

  const STEPS = [
    ['Full audit', 'Google profile, rankings, technical, on-page, backlinks and citations.'],
    ['Website research', 'Tech stack, metadata on every page, and a list of improvements.'],
    ['Weekly work plan', 'Tasks for each week, carried over until done, with a backlog for later.'],
    ['Weekly & monthly reports', 'Last period vs this period, and what comes next.']
  ];
  const OPTIONS = [
    [Store, 'Connect Google Account', 'Import Business Profiles, locations and live reviews directly.', () => navigate(`${path('gmb-profile')}?connect=1`), 'bg-blue-500/10 text-blue-600 border-blue-500/20'],
    [Mail, 'Onboarding Email Pipeline', 'Paste an onboarding brief; AI extracts the details and starts the audit.', () => navigate(path('automation-pipeline')), 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20']
  ];
  const FIELDS = [['name', 'Business name *'], ['primary_category', 'Category (e.g. Multispeciality Hospital)'], ['phone', 'Phone number'], ['website', 'Website URL'], ['area', 'Area (e.g. Chinchwad)'], ['city', 'City (e.g. PCMC)']];

  return (
    <div className="w-full grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 text-slate-900">
      <div className="grid gap-5">
        <section className="ai-glass-card rounded p-6 flex flex-wrap items-center gap-4">
          <div className="w-14 h-14 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-600"><Building2 size={26} /></div>
          <div className="flex-1 min-w-[240px]">
            <h2 className="text-xl font-bold text-slate-900 font-display">Add your first client</h2>
            <p className="text-13 text-slate-500 mt-0.5">No businesses are managed yet. Add one and the autonomous SEO pipeline starts by itself.</p>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {OPTIONS.map(([Icon, title, text, go, tone]) => (
            <button key={title} type="button" onClick={go} className="ai-glass-card rounded p-6 text-left cursor-pointer group hover:ring-2 hover:ring-indigo-300 transition-all">
              <div className={`w-11 h-11 rounded border flex items-center justify-center mb-4 group-hover:scale-105 transition-transform ${tone}`}><Icon size={20} /></div>
              <div className="text-15 font-bold text-slate-900">{title}</div>
              <div className="text-13 text-slate-500 mt-1">{text}</div>
              <div className="text-12 font-semibold text-indigo-600 mt-4 flex items-center gap-1">Start <ExternalLink size={12} /></div>
            </button>
          ))}
        </div>

        <section className="ai-glass-card rounded p-6">
          <h3 className="text-15 font-bold text-slate-900">Or register a client manually</h3>
          <p className="text-12 text-slate-400 mt-0.5">Only the name is required. You can complete the profile later in Business Onboarding.</p>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {FIELDS.map(([k, l]) => (
              <input key={k} aria-label={l} className={inputCls} placeholder={l} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
            ))}
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" icon={Plus} busy={busy === 'create'} disabled={!form.name.trim()} onClick={create}>Create Business</Button>
          </div>
        </section>
      </div>

      <aside className="ai-glass-card rounded p-6 self-start">
        <div className="flex items-center gap-2 text-indigo-600"><Sparkles size={16} /><span className="text-12 font-bold uppercase tracking-wide">What happens next</span></div>
        <h3 className="text-15 font-bold text-slate-900 mt-2">Everything starts automatically</h3>
        <ol className="mt-5 grid gap-5">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="w-7 h-7 rounded-full bg-indigo-500 text-white text-12 font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <div><div className="text-13 font-semibold text-slate-900">{title}</div><div className="text-12 text-slate-500 mt-0.5">{text}</div></div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
};

/**
 * Top Page Shell: High-tech obsidian glass header with breadcrumbs and business switcher.
 */
export const SeoShell = ({ title, subtitle, actions, children, hideSwitcher = false, needsBusiness = true, step = null }) => {
  const { list, error, refresh } = useBusinesses();
  const [business, setBusiness] = useSeoBusiness();

  let body;
  if (error && !list) body = <BackendDown error={error} onRetry={refresh} />;
  else if (!list && needsBusiness) body = <SkPage header={false} />; // the title, subtitle and breadcrumb above are static, so they stay on screen
  else if (needsBusiness && !business) body = <NoBusinesses onCreated={setBusiness} />;
  else body = typeof children === 'function' ? children(business) : children;

  return (
    <div className="min-h-screen text-slate-700 bg-body">
      {/* Topbar (Ubold: dark bar, light icons) */}
      <header className="bg-topbar sticky top-0 z-30 h-[70px]">
        <div className="h-full px-6 flex items-center justify-between gap-4">
          <div className="min-w-0" />
          <div className="flex items-center gap-2.5">
            <div className="h-9 px-3 rounded bg-topbar-field border border-dashed border-white/10 flex items-center gap-2 text-12 font-medium text-topbar-item hover:text-white cursor-pointer transition-colors">
              <Calendar size={13} />
              <span>Last 30 Days</span>
              <ChevronDown size={13} />
            </div>
            <NotificationBell />
            {actions}
            {!hideSwitcher && business && list?.length > 0 && (
              <BusinessSwitcher business={business} onChange={setBusiness} list={list} />
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1520px] mx-auto px-6 pb-6 animate-in fade-in duration-200">
        {/* Page title with breadcrumb */}
        <div className="py-5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <Breadcrumbs title={title} />
            <h1 className="text-18 font-semibold text-slate-900 tracking-tight flex flex-wrap items-center gap-2">{title}{business && needsBusiness && <MarketBadge business={business} />}</h1>
            {subtitle && <p className="text-12 text-slate-400 mt-0.5 max-w-3xl">{subtitle}</p>}
          </div>
        </div>
        {step && business && !error && <div className="mb-4"><StepBar bid={business.id} step={step} /></div>}
        {body}
      </div>
    </div>
  );
};

/** "Show more" under a list loaded with usePaged. Renders nothing when everything is already shown. */
export const LoadMore = ({ list, label = 'Show more' }) => (
  list?.hasMore ? (
    <div className="flex justify-center pt-3">
      <Button size="sm" busy={list.loadingMore} onClick={list.loadMore}>{label}</Button>
    </div>
  ) : null
);

export const ErrorNote = ({ children }) => (
  children ? (
    <div className="mt-2 text-12 font-semibold text-rose-700 bg-rose-500/10 border border-rose-500/20 rounded px-3.5 py-2 flex items-center gap-2">
      <AlertCircle size={15} className="shrink-0 text-rose-600" />
      <span>{children}</span>
    </div>
  ) : null
);

export const SourceTag = ({ source }) => (
  source === 'sample' ? (
    <span title="Sample simulated data" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/25 text-11 font-semibold ">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> sample
    </span>
  ) : source === 'live' ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/25 text-11 font-semibold ">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live sync
    </span>
  ) : null
);

/**
 * Modern AI Glassmorphism Card
 */
export const Card = ({ title, subtitle, action, children, className = '', pad = true }) => (
  <section className={`ai-glass-card rounded ${className}`}>
    {(title || action) && (
      <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="min-w-0">
          {title && <h2 className="text-15 font-semibold text-slate-900 tracking-tight">{title}</h2>}
          {subtitle && <p className="text-12 text-slate-400 mt-0.5 font-normal">{subtitle}</p>}
        </div>
        {action}
      </header>
    )}
    <div className={pad ? 'p-6' : ''}>{children}</div>
  </section>
);

/**
 * High-impact KPI Stat Card
 */
export const Stat = ({ label, value, delta, deltaGoodWhenUp = true, hint, icon: Icon }) => {
  const up = delta > 0;
  const good = delta === 0 || delta == null ? null : up === deltaGoodWhenUp;

  return (
    <div className="ai-glass-card rounded p-5 min-w-0 relative overflow-hidden group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500  truncate">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded bg-slate-100 group-hover:bg-indigo-500/20 border border-slate-200 group-hover:border-indigo-500/30 flex items-center justify-center text-slate-500 group-hover:text-cyan-700 transition-all shrink-0">
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 mt-2 font-display tracking-tight">{value}</div>
      <div className="text-12 mt-2 flex items-center gap-1.5 flex-wrap">
        {delta != null && delta !== 0 && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full font-bold text-11 ${good ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-600 border border-rose-500/30'
            }`}>
            {up ? '▲ +' : '▼ -'}{Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="text-slate-500 font-medium">{hint}</span>}
      </div>
    </div>
  );
};

const TONES = {
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30',
  green: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
  violet: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
  orange: 'bg-orange-500/15 text-orange-700 border-orange-500/30'
};

export const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-11 font-semibold whitespace-nowrap shadow-sm ${TONES[tone] || TONES.gray}`}>
    {children}
  </span>
);

const STATUS_META = {
  good: { icon: CheckCircle2, color: STATUS.good, tone: 'green' },
  warning: { icon: AlertTriangle, color: '#f59e0b', tone: 'amber' },
  serious: { icon: AlertCircle, color: '#f97316', tone: 'orange' },
  critical: { icon: AlertCircle, color: STATUS.critical, tone: 'red' },
  info: { icon: Info, color: INK.secondary, tone: 'gray' }
};

export const StatusPill = ({ level, children }) => {
  const m = STATUS_META[level] || STATUS_META.info;
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon size={12} className="shrink-0" /> {children}</Badge>;
};

export const scoreLevel = (s) => (s >= 80 ? 'good' : s >= 60 ? 'warning' : s >= 40 ? 'serious' : 'critical');
export const scoreWord = (s) => (s >= 80 ? 'Optimal' : s >= 60 ? 'Moderate' : s >= 40 ? 'Weak' : 'Critical');

export const ScoreRing = ({ score, size = 112, label = 'Score', level }) => {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const lvl = level || scoreLevel(score);

  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STATUS[lvl]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          style={{ transition: 'stroke-dasharray .8s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-extrabold text-slate-900 leading-none font-display">{score}</span>
        <span className="text-10  font-bold text-slate-500  mt-1 ">{label}</span>
      </div>
    </div>
  );
};

export const Meter = ({ value, max = 100, color = SERIES[0], height = 7 }) => (
  <div className="w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200" style={{ height }}>
    <div
      className="h-full rounded-full"
      style={{
        width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
        background: color,
        transition: 'width .6s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    />
  </div>
);

/**
 * Segmented dark pill tabs
 */
/** A tab kept in the address (?tab=), so sidebar links can open a page on a given tab. */
export const useUrlTab = (fallback, valid) => {
  const [params, setParams] = useSearchParams();
  const { tab: routeTab } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const clean = pathname.replace(/\/+$/, '') || '/';
  const base = routeTab ? clean.replace(/\/[^/]+$/, '') : clean;
  const paged = TAB_BASES.includes(base); // a page whose views have their own addresses: /<page>/<view>
  const ok = (t) => Boolean(t) && (!valid || valid.includes(t));
  const queryTab = routeTab ? null : params.get('tab');
  const raw = routeTab || queryTab;
  const tab = ok(raw) ? raw : fallback;
  const goTab = (t, replace = false) => {
    const n = new URLSearchParams(params); n.delete('tab');
    const q = n.toString();
    navigate(`${base}/${t}${q ? `?${q}` : ''}`, { replace });
  };
  useEffect(() => { // an old ?tab= link, or the bare page, becomes the view's own address
    if (!paged || routeTab) return;
    if (ok(queryTab)) goTab(queryTab, true);
    else if (!LIST_BASES.includes(base)) goTab(fallback, true);
  }, [paged, routeTab, queryTab, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = paged ? (t) => goTab(t) : (t) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  setTab.locked = paged && HIDE_STRIP.includes(base); // the sidebar is the menu: no second row of tabs
  return [tab, setTab];
};

export const Tabs = ({ tabs, value, onChange }) => (onChange && onChange.locked ? null : (
  <div className="flex gap-1 p-1 bg-white shadow-card rounded mb-5 overflow-x-auto no-scrollbar w-fit max-w-full">
    {tabs.map(t => {
      const id = typeof t === 'string' ? t : t.id;
      const label = typeof t === 'string' ? t : t.label;
      const active = value === id;
      return (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-4 py-1.5 text-13 font-semibold whitespace-nowrap rounded-lg transition-all duration-150 cursor-pointer flex items-center gap-1.5 ${active
            ? 'bg-indigo-500 text-white font-semibold'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
        >
          <span>{label}</span>
          {typeof t !== 'string' && t.count != null && (
            <span className={`text-11 px-1.5 py-0.2 rounded-full font-bold ${active ? 'bg-slate-200 text-slate-900' : 'bg-slate-100 text-slate-500'
              }`}>
              {t.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
));

export const Button = ({ variant = 'secondary', size = 'md', icon: Icon, busy, children, className = '', ...rest }) => {
  const v = {
    primary: 'bg-indigo-500 hover:bg-indigo-600 text-white border-indigo-500 hover:border-indigo-600',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border-transparent',
    danger: 'bg-rose-500/20 text-rose-700 hover:bg-rose-500/30 border-rose-500/30',
    ai: 'bg-violet-500 hover:bg-violet-600 text-white border-violet-500 hover:border-violet-600'
  }[variant];

  const s = size === 'sm' ? 'h-[30px] px-3 text-xs rounded-lg' : 'h-9 px-4 text-13 rounded';

  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 border font-semibold whitespace-nowrap cursor-pointer active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${v} ${s} ${className}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} className="shrink-0" /> : null}
      {children}
    </button>
  );
};

export const Modal = ({ open, title, onClose, children, footer, width = 'max-w-lg' }) => {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  if (!open) return null;

  // Rendered on <body>: inside the page's scroll area a modal could not cover the sidebar and was clipped by it.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-md flex items-start justify-center p-4 overflow-y-auto animate-in fade-in duration-150" onMouseDown={onClose}>
      <div className={`bg-white backdrop-blur-2xl rounded shadow-2xl border border-slate-300 w-full ${width} mt-12 overflow-hidden animate-in zoom-in-95 duration-150 text-slate-900 ring-1 ring-slate-200`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-15 font-bold text-slate-900 font-display">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

/** A panel that slides in from the right over the page: secondary detail without leaving the screen. */
export const Drawer = ({ open, title, subtitle, onClose, children, width = 'max-w-2xl' }) => {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = overflow; };
  }, [open, onClose]);

  if (!open) return null;

  // On <body>, so an animated (transformed) page container can't clip or offset the fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-150" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={`absolute right-0 top-0 h-full w-full ${width} bg-slate-50 shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-white">
          <div className="min-w-0">
            <h3 className="text-15 font-bold text-slate-900 font-display">{title}</h3>
            {subtitle && <p className="text-12 text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>,
    document.body
  );
};

export const Field = ({ label, hint, children, counter }) => (
  <label className="block">
    <span className="flex items-center justify-between text-12 font-semibold text-slate-700 mb-1.5">
      <span>{label}</span>
      {counter && <span className="text-slate-500 font-normal">{counter}</span>}
    </span>
    {children}
    {hint && <span className="block text-11 text-slate-500 mt-1">{hint}</span>}
  </label>
);

export const inputCls = 'ai-glass-input w-full h-9 px-3 text-13 rounded placeholder-slate-400 text-slate-900';
export const areaCls = 'ai-glass-input w-full px-3 py-2.5 text-13 rounded placeholder-slate-400 text-slate-900';

export const ChartTooltip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white backdrop-blur-xl border border-slate-300 rounded shadow-2xl px-3.5 py-2.5 text-12 text-slate-900">
      {label != null && <div className="text-slate-500  mb-1">{label}</div>}
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-700 font-medium">{p.name}:</span>
          <span className="ml-auto pl-3 font-bold text-slate-900 tabular-nums">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

export const Legend = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-12 text-slate-500 font-medium">
    {items.map(([name, color]) => (
      <span key={name} className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        {name}
      </span>
    ))}
  </div>
);

/** Placeholder shown while data is being fetched. variant "page" = stat tiles + chart + rows; "rows" = a few table-like lines; "line" = one short line. */
export function Skeleton({ variant = 'rows', rows = 4, className = '' }) {
  const bar = 'rounded bg-slate-100 animate-pulse';
  return (
    <div className={className} role="status" aria-busy="true" aria-label="Loading">
      {variant === 'line' ? <div className={`${bar} h-4 w-40`} /> : (
        <div className="space-y-3">
          {variant === 'page' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map(n => <div key={n} className="rounded border border-slate-100 p-3.5 space-y-2" style={{ animationDelay: `${n * 80}ms` }}><div className={`${bar} h-3 w-2/3`} /><div className={`${bar} h-6 w-1/2`} /></div>)}
              </div>
              <div className="rounded border border-slate-100 p-4"><div className={`${bar} h-3 w-36 mb-3`} /><div className="flex items-end gap-1 h-24">{Array.from({ length: 24 }, (_, n) => <div key={n} className={`${bar} flex-1`} style={{ height: `${20 + ((n * 37) % 70)}%`, animationDelay: `${n * 40}ms` }} />)}</div></div>
            </>
          )}
          <div className="space-y-2.5">
            {Array.from({ length: rows }, (_, n) => (
              <div key={n} className="flex items-center gap-3" style={{ opacity: 1 - n * 0.12 }}>
                <div className={`${bar} h-8 w-8 rounded-full shrink-0`} style={{ animationDelay: `${n * 90}ms` }} />
                <div className="flex-1 space-y-1.5"><div className={`${bar} h-3`} style={{ width: `${88 - ((n * 13) % 35)}%`, animationDelay: `${n * 90}ms` }} /><div className={`${bar} h-2.5`} style={{ width: `${55 - ((n * 7) % 20)}%`, animationDelay: `${n * 90}ms` }} /></div>
                <div className={`${bar} h-5 w-14 shrink-0`} style={{ animationDelay: `${n * 90}ms` }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* Layout-matched skeleton pieces: compose them to mirror the real stat tiles, cards, tables and lists they stand in for. */
const SK = 'rounded bg-slate-100 animate-pulse';
export const Sk = ({ w = 'w-full', h = 'h-3', className = '', delay = 0, style }) => <div className={`${SK} ${w} ${h} ${className}`} style={{ animationDelay: `${delay}ms`, ...style }} />;
const pctW = (n, base = 85, step = 11) => `${Math.max(30, base - ((n * step) % 45))}%`;

/** Row of stat tiles (icon circle + label + number), like Stat / Kpi. `labels` shows the real tile names; only the number is a skeleton. */
export const SkStats = ({ n = 4, cols = 'grid-cols-2 lg:grid-cols-4', labels }) => (
  <div className={`grid ${cols} gap-3`} role="status" aria-busy="true" aria-label="Loading">
    {Array.from({ length: labels ? labels.length : n }, (_, i) => (
      <div key={i} className="ai-glass-card rounded p-3.5 flex items-center gap-3 min-w-0">
        <Sk w="w-10" h="h-10" className="!rounded-full shrink-0" delay={i * 80} />
        <div className="flex-1 min-w-0 space-y-2">
          {labels ? <div className="text-11.5 font-semibold text-slate-400 truncate">{labels[i]}</div> : <Sk w="w-2/3" h="h-2.5" delay={i * 80} />}
          <Sk w="w-1/2" h="h-5" delay={i * 80} />
        </div>
      </div>
    ))}
  </div>
);

/** A table: header strip plus rows; `cols` can be widths like ['w-1/3','w-16'] to mirror a left text column and right-aligned numbers. */
export const SkTable = ({ cols = 4, rows = 6, bare = false, headers }) => {
  const widths = Array.isArray(cols) ? cols : ['w-3/4', ...Array.from({ length: (headers ? headers.length : cols) - 1 }, () => 'w-12')];
  return (
    <div className={bare ? '' : 'overflow-hidden'} role="status" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-4 px-5 py-2.5 bg-slate-50">{widths.map((w, i) => <div key={i} className={`flex-1 flex ${i ? 'justify-end' : ''}`}>{headers ? <span className="text-11.5 font-semibold text-slate-500 truncate">{headers[i]}</span> : <Sk w={w.startsWith('w-1/') || w.startsWith('w-3/') ? 'w-1/2' : w} h="h-2.5" />}</div>)}</div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-3" style={{ opacity: 1 - r * 0.07 }}>
            {widths.map((w, i) => <div key={i} className={`flex-1 flex ${i ? 'justify-end' : ''}`}><Sk w={i ? w : ''} h="h-3" delay={r * 70} style={i ? undefined : { width: pctW(r + i) }} /></div>)}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Chart area: bars (default) or an area/line sweep. */
export const SkChart = ({ h = 'h-40', bars = 28 }) => (
  <div className={`${h} flex items-end gap-1 px-1`} role="status" aria-busy="true" aria-label="Loading">
    {Array.from({ length: bars }, (_, i) => <Sk key={i} w="flex-1" h="" className="!w-auto" style={{ height: `${25 + ((i * 37) % 65)}%` }} delay={i * 35} />)}
  </div>
);

/** List rows with an optional avatar/thumbnail, two text lines and a trailing pill, like reviews, posts, accounts. */
export const SkList = ({ rows = 4, avatar = true, trail = true, thumb = false, boxed = false }) => (
  <div className={boxed ? 'space-y-2' : 'divide-y divide-slate-100'} role="status" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className={`flex items-center gap-3 ${boxed ? 'rounded ring-1 ring-inset ring-slate-200 px-3.5 py-2.5' : 'py-3'}`}>
        {avatar && <Sk w={thumb ? 'w-14' : 'w-9'} h={thumb ? 'h-14' : 'h-9'} className={thumb ? '' : '!rounded-full'} delay={i * 80} />}
        <div className="flex-1 space-y-2"><Sk h="h-3" delay={i * 80} style={{ width: pctW(i, 80) }} /><Sk h="h-2.5" delay={i * 80} style={{ width: pctW(i, 50, 7) }} /></div>
        {trail && <Sk w="w-16" h="h-6" delay={i * 80} />}
      </div>
    ))}
  </div>
);

/** Paragraph-like lines. */
export const SkLines = ({ n = 3 }) => (
  <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading">
    {Array.from({ length: n }, (_, i) => <Sk key={i} h="h-3" delay={i * 80} style={{ width: i === n - 1 ? '60%' : '100%' }} />)}
  </div>
);

/** Score ring beside a few lines, like the health score and audit score cards. */
export const SkScore = () => (
  <div className="flex items-center gap-5" role="status" aria-busy="true" aria-label="Loading">
    <Sk w="w-24" h="h-24" className="!rounded-full shrink-0" />
    <div className="flex-1 space-y-2"><Sk w="w-1/2" h="h-4" /><Sk w="w-3/4" /><Sk w="w-2/3" /></div>
  </div>
);

/** A card shell with its real heading (`title`, `subtitle` are static text, never fetched) and a skeleton body. */
export const SkCard = ({ title, subtitle, action, className = '', pad = true, children }) => (
  <section className={`ai-glass-card rounded ${className}`}>
    {(title || action) && (
      <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="min-w-0">
          {title && <h2 className="text-15 font-semibold text-slate-900 tracking-tight">{title}</h2>}
          {subtitle && <p className="text-12 text-slate-400 mt-0.5 font-normal">{subtitle}</p>}
        </div>
        {action}
      </header>
    )}
    <div className={pad ? 'p-5' : ''}>{children}</div>
  </section>
);

/** A page section heading (icon, title, subtitle), rendered for real while the section's data loads. */
export const SkHead = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-center gap-2.5 mb-3">
    {Icon && <span className="w-8 h-8 rounded-lg bg-white ring-1 ring-inset ring-slate-200 shadow-sm flex items-center justify-center text-indigo-600"><Icon size={16} /></span>}
    <div><h2 className="text-15 font-semibold text-slate-900 leading-tight">{title}</h2>{subtitle && <p className="text-12 text-slate-500">{subtitle}</p>}</div>
  </div>
);

/** A whole dashboard-style page: header bar, stat tiles, chart card and table card. Turn parts off to match the real page. */
export const SkPage = ({ header = true, stats = 4, statLabels, statCols, chart = true, chartTitle, tableTitle, tableHeaders, table = 5, tableCols = 5 }) => (
  <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading">
    {header && <SkCard title={false}><div className="flex items-center gap-3"><Sk w="w-10" h="h-10" className="!rounded-full shrink-0" /><div className="flex-1 space-y-2"><Sk w="w-48" h="h-4" /><Sk w="w-32" h="h-2.5" /></div><Sk w="w-28" h="h-9" /></div></SkCard>}
    {(statLabels || stats > 0) && <SkStats n={stats} labels={statLabels} cols={(statLabels?.length ?? stats) === 3 ? 'grid-cols-1 sm:grid-cols-3' : (statLabels?.length ?? stats) === 5 ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'} />}
    {chart && <SkCard title={chartTitle}><SkChart /></SkCard>}
    {table > 0 && <SkCard title={tableTitle}><SkTable cols={tableHeaders ? tableHeaders.length : tableCols} rows={table} headers={tableHeaders} bare /></SkCard>}
  </div>
);

export const Empty = ({ children }) => (
  <div className="py-16 text-center text-13 text-slate-500 font-medium flex flex-col items-center justify-center gap-2">
    <div className="w-12 h-12 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mb-1">
      <Info size={20} />
    </div>
    {children}
  </div>
);

/**
 * Two-step permission before anything is deleted. `ask({ what, effect, onConfirm })` opens a dialog: step 1 asks whether to continue,
 * step 2 repeats what will be lost and needs a tick before the red button works. Nothing is deleted until the second step.
 */
export const useDoubleConfirm = () => {
  const [req, setReq] = useState(null);
  const [step, setStep] = useState(1);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((r) => { setReq(r); setStep(1); setAck(false); }, []);
  const close = () => { if (!busy) setReq(null); };
  const confirm = async () => {
    setBusy(true);
    try { await req.onConfirm(); } finally { setBusy(false); setReq(null); }
  };
  const node = (
    <Modal open={Boolean(req)} onClose={close} width="max-w-md" title={step === 1 ? `Delete ${req?.what || 'this'}?` : 'Final confirmation'}
      footer={step === 1 ? (
        <><Button onClick={close}>Cancel</Button><Button variant="danger" onClick={() => setStep(2)}>Yes, continue</Button></>
      ) : (
        <><Button onClick={() => setStep(1)} disabled={busy}>Go back</Button>
          <Button busy={busy} disabled={!ack} onClick={confirm} className="!bg-rose-600 !text-white !border-rose-600 hover:!bg-rose-700">Delete permanently</Button></>
      )}>
      {step === 1 ? (
        <div className="space-y-2 text-13 text-slate-700">
          <p>You are about to delete <b>{req?.what}</b>.</p>
          {req?.effect && <p className="text-slate-500">{req.effect}</p>}
        </div>
      ) : (
        <div className="space-y-3 text-13 text-slate-700">
          <div className="flex items-start gap-2 rounded bg-rose-50 ring-1 ring-inset ring-rose-200 px-3 py-2.5 text-rose-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>This permanently deletes <b>{req?.what}</b>. It cannot be undone.</span>
          </div>
          {req?.effect && <p className="text-slate-500">{req.effect}</p>}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span>I understand this cannot be undone and I want to delete it.</span>
          </label>
        </div>
      )}
    </Modal>
  );
  return [ask, node];
};

export const useToast = () => {
  const [msg, setMsg] = useState('');
  const t = useRef(null);
  const show = (m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2600); };
  const node = msg ? (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-white backdrop-blur-xl text-slate-900 text-13 font-bold rounded shadow-2xl px-5 py-3 flex items-center gap-3 border border-indigo-500/40 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <Sparkles size={16} className="text-cyan-700" />
      <span>{msg}</span>
    </div>
  ) : null;
  return [show, node];
};
