import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, Check, X, Loader2, AlertTriangle, AlertCircle, CheckCircle2, Info, MapPin, Plug, ServerCrash, Plus, Mail, Store, RefreshCw
} from 'lucide-react';
import { api, toUi, SEO_API } from './seoApi';

// Chart colors: validated categorical order (blue, orange, aqua, yellow, magenta) and the
// reserved status colors, which always travel with an icon and a label.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', up: '#006300' };

// Businesses from the SEO backend, shared by every page (one load, then refreshed on demand).
const store = { list: null, error: null, loading: false, listeners: new Set() };
const notify = () => store.listeners.forEach(fn => fn());
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

// The business being viewed (kept in this browser).
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
  const choose = useCallback((next) => {
    try { localStorage.setItem(KEY, String(next)); } catch (e) { /* private window */ }
    setId(Number(next));
    window.dispatchEvent(new Event('seo-business'));
  }, []);
  const business = list ? (list.find(b => b.id === id) || list[0] || null) : null;
  return [business, choose];
};

// Pretend job for the preview-only screens (Content Studio blog writer, Website Builder).
export const useSimulated = () => {
  const [busy, setBusy] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = useCallback((label, fn, ms = 1100) => {
    setBusy(label);
    timer.current = setTimeout(() => { setBusy(''); fn(); }, ms);
  }, []);
  return [busy, run];
};

/** Runs an async action with a busy label and error capture: const [busy, error, run] = useAction(). */
export const useAction = () => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = useCallback(async (label, fn) => {
    setBusy(label); setError('');
    try { return await fn(); } catch (e) { setError(e.message || String(e)); return undefined; } finally { setBusy(''); }
  }, []);
  return [busy, error, run, setError];
};

export const useModulePath = () => {
  return (slug) => `/${slug}`;
};

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
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 h-9 pl-2 pr-2.5 bg-white border border-gray-300 rounded hover:bg-gray-50 cursor-pointer max-w-[280px]">
        <span className="w-6 h-6 rounded bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">{business.name.slice(0, 1)}</span>
        <span className="min-w-0 text-left">
          <span className="block text-[13px] font-medium text-gray-900 truncate">{business.name}</span>
          <span className="block text-[11px] text-gray-500 truncate">{[business.primaryCategory, business.area].filter(Boolean).join(' · ') || 'No category yet'}</span>
        </span>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-white border border-gray-200 rounded shadow-lg z-50 py-1 max-h-[70vh] overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] text-gray-500">Businesses ({list.length})</div>
          {list.map(b => (
            <button key={b.id} onClick={() => { onChange(b.id); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 cursor-pointer">
              <span className="w-6 h-6 rounded bg-gray-100 text-gray-700 text-[11px] font-semibold flex items-center justify-center shrink-0">{b.name.slice(0, 1)}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-gray-900 truncate">{b.name}</span>
                <span className="block text-[11px] text-gray-500 truncate flex items-center gap-1"><MapPin size={10} /> {[b.area, b.city].filter(Boolean).join(', ') || '—'}</span>
              </span>
              {b.id === business.id && <Check size={14} className="text-blue-600" />}
            </button>
          ))}
          <button onClick={() => { setOpen(false); navigate(`${path('gmb-profile')}?connect=1`); }} className="w-full flex items-center gap-2 px-3 py-2 mt-1 border-t border-gray-100 text-left text-[13px] text-blue-700 hover:bg-blue-50 cursor-pointer">
            <Plug size={13} /> Add businesses
          </button>
        </div>
      )}
    </div>
  );
};

export const BackendDown = ({ error, onRetry }) => (
  <div className="bg-white border border-red-200 rounded p-6 max-w-2xl">
    <div className="flex items-center gap-2 text-red-700 font-medium"><ServerCrash size={18} /> {error?.status === 401 ? 'Not signed in to the SEO platform' : error?.status === 403 ? 'No access to the SEO platform' : 'SEO backend not reachable'}</div>
    <p className="text-[13px] text-gray-700 mt-2">{error?.message}</p>
    {!error?.status && (
      <pre className="mt-3 text-[12px] bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto">{'cd seo-platform\\backend\n.venv\\Scripts\\activate\nuvicorn app.main:app --port 8100'}</pre>
    )}
    <p className="text-[12px] text-gray-500 mt-2">API address: {SEO_API}</p>
    <button onClick={onRetry} className="mt-3 h-8 px-3 inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white text-[13px] hover:bg-gray-50 cursor-pointer"><RefreshCw size={13} /> Try again</button>
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
  return (
    <div className="bg-white border border-gray-200 rounded p-6 max-w-3xl">
      <h2 className="text-lg font-semibold text-gray-900">No businesses yet</h2>
      <p className="text-[13px] text-gray-600 mt-1">Add the first client: connect their Google account, forward their onboarding email, or enter them by hand.</p>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <button onClick={() => navigate(`${path('gmb-profile')}?connect=1`)} className="text-left p-3 rounded border border-gray-200 hover:border-blue-400 cursor-pointer"><Store size={16} className="text-blue-600 mb-1" /><div className="text-[13px] font-medium text-gray-900">Connect Google account</div><div className="text-[12px] text-gray-500">Fetch every Business Profile it manages</div></button>
        <button onClick={() => navigate(path('automation-pipeline'))} className="text-left p-3 rounded border border-gray-200 hover:border-blue-400 cursor-pointer"><Mail size={16} className="text-blue-600 mb-1" /><div className="text-[13px] font-medium text-gray-900">Onboarding email</div><div className="text-[12px] text-gray-500">Paste or forward it; the pipeline does the rest</div></button>
      </div>
      <div className="mt-5 text-[13px] font-medium text-gray-900">Or add by hand</div>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
        {[['name', 'Business name *'], ['primary_category', 'Category (e.g. Dentist)'], ['phone', 'Phone'], ['website', 'Website'], ['area', 'Area'], ['city', 'City']].map(([k, l]) => (
          <input key={k} className={inputCls} placeholder={l} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} />
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button className="mt-3" variant="primary" icon={Plus} busy={busy === 'create'} disabled={!form.name.trim()} onClick={create}>Add business</Button>
    </div>
  );
};

/**
 * Page frame for every SEO platform screen: title and business switcher. `children` may be a
 * function of the selected business. Shows a clear screen when the backend is down or there are
 * no businesses yet (unless `needsBusiness` is false).
 */
export const SeoShell = ({ title, subtitle, actions, children, hideSwitcher = false, needsBusiness = true }) => {
  const { list, error, refresh } = useBusinesses();
  const [business, setBusiness] = useSeoBusiness();
  let body;
  if (error && !list) body = <BackendDown error={error} onRetry={refresh} />;
  else if (!list && needsBusiness) body = <div className="py-16 flex items-center justify-center gap-2 text-[13px] text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  else if (needsBusiness && !business) body = <NoBusinesses onCreated={setBusiness} />;
  else body = typeof children === 'function' ? children(business) : children;
  return (
    <div className="min-h-screen bg-[#F7F8F9]">
      <div className="bg-white border-b border-gray-200">
        <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
            {subtitle && <p className="text-[13px] text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {actions}
            {!hideSwitcher && business && list?.length > 0 && <BusinessSwitcher business={business} onChange={setBusiness} list={list} />}
          </div>
        </div>
      </div>
      <div className="p-5">{body}</div>
    </div>
  );
};

/** Error line under an action. */
export const ErrorNote = ({ children }) => (children ? <div className="mt-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{children}</div> : null);

/** Labels results from providers that are not connected yet. */
export const SourceTag = ({ source }) => (source === 'sample'
  ? <span title="Sample data until this data provider is connected" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ring-inset ring-amber-200 bg-amber-50 text-amber-800 text-[11px] font-medium">sample data</span>
  : source === 'live' ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ring-inset ring-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-medium">live</span> : null);

/** Banner for screens with no backend logic yet. */
export const PreviewNote = ({ children }) => (
  <div className="mb-4 p-3 rounded border border-violet-200 bg-violet-50 text-[13px] text-violet-800 flex items-start gap-2"><Info size={14} className="mt-px shrink-0" /> {children}</div>
);

export const Card = ({ title, subtitle, action, children, className = '', pad = true }) => (
  <section className={`bg-white border border-gray-200 rounded ${className}`}>
    {(title || action) && (
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-gray-900">{title}</h2>}
          {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </header>
    )}
    <div className={pad ? 'px-4 pb-4 pt-1' : ''}>{children}</div>
  </section>
);

export const Stat = ({ label, value, delta, deltaGoodWhenUp = true, hint, icon: Icon }) => {
  const up = delta > 0;
  const good = delta === 0 || delta == null ? null : up === deltaGoodWhenUp;
  return (
    <div className="bg-white border border-gray-200 rounded p-3.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] text-gray-500">{Icon && <Icon size={13} className="text-gray-400" />}{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      <div className="text-[12px] mt-0.5 truncate">
        {delta != null && delta !== 0 && <span className={good ? 'text-[#006300] font-medium' : 'text-[#d03b3b] font-medium'}>{up ? '▲' : '▼'} {Math.abs(delta)}%</span>}
        {hint && <span className="text-gray-500"> {hint}</span>}
      </div>
    </div>
  );
};

const TONES = {
  gray: 'bg-gray-100 text-gray-700 ring-gray-200', blue: 'bg-blue-50 text-blue-700 ring-blue-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200', red: 'bg-red-50 text-red-700 ring-red-200', violet: 'bg-violet-50 text-violet-700 ring-violet-200', orange: 'bg-orange-50 text-orange-800 ring-orange-200'
};
export const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ring-inset text-[11px] font-medium whitespace-nowrap ${TONES[tone] || TONES.gray}`}>{children}</span>
);

// Status always shows icon + label, never color alone.
const STATUS_META = {
  good: { icon: CheckCircle2, color: STATUS.good, tone: 'green' },
  warning: { icon: AlertTriangle, color: '#b07800', tone: 'amber' },
  serious: { icon: AlertCircle, color: '#c25a2f', tone: 'orange' },
  critical: { icon: AlertCircle, color: STATUS.critical, tone: 'red' },
  info: { icon: Info, color: INK.secondary, tone: 'gray' }
};
export const StatusPill = ({ level, children }) => {
  const m = STATUS_META[level] || STATUS_META.info;
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon size={11} /> {children}</Badge>;
};
export const scoreLevel = (s) => (s >= 80 ? 'good' : s >= 60 ? 'warning' : s >= 40 ? 'serious' : 'critical');
export const scoreWord = (s) => (s >= 80 ? 'Strong' : s >= 60 ? 'Fair' : s >= 40 ? 'Weak' : 'Poor');

export const ScoreRing = ({ score, size = 112, label = 'Score', level }) => {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const lvl = level || scoreLevel(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f2" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={STATUS[lvl]} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray .6s' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-gray-900 leading-none">{score}</span>
        <span className="text-[11px] text-gray-500 mt-1">{label}</span>
      </div>
    </div>
  );
};

export const Meter = ({ value, max = 100, color = SERIES[0], height = 6 }) => (
  <div className="w-full bg-gray-100 rounded overflow-hidden" style={{ height }}>
    <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color, transition: 'width .5s' }} />
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto no-scrollbar">
    {tabs.map(t => {
      const id = typeof t === 'string' ? t : t.id;
      const label = typeof t === 'string' ? t : t.label;
      return (
        <button key={id} onClick={() => onChange(id)}
          className={`px-3 py-2 text-[13px] whitespace-nowrap border-b-2 -mb-px cursor-pointer ${value === id ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {label}{typeof t !== 'string' && t.count != null && <span className="ml-1.5 text-[11px] text-gray-400">{t.count}</span>}
        </button>
      );
    })}
  </div>
);

export const Button = ({ variant = 'secondary', size = 'md', icon: Icon, busy, children, className = '', ...rest }) => {
  const v = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600',
    secondary: 'bg-white text-gray-800 hover:bg-gray-50 border-gray-300',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 border-transparent',
    danger: 'bg-white text-red-700 hover:bg-red-50 border-red-200',
    ai: 'bg-violet-600 text-white hover:bg-violet-700 border-violet-600'
  }[variant];
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]';
  return (
    <button {...rest} disabled={busy || rest.disabled} className={`inline-flex items-center justify-center gap-1.5 rounded border font-medium whitespace-nowrap cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : Icon ? <Icon size={13} /> : null}
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
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onMouseDown={onClose}>
      <div className={`bg-white rounded shadow-xl w-full ${width} mt-12`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500 cursor-pointer" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

export const Field = ({ label, hint, children, counter }) => (
  <label className="block">
    <span className="flex items-center justify-between text-[12px] text-gray-600 mb-1"><span>{label}</span>{counter}</span>
    {children}
    {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
  </label>
);
export const inputCls = 'w-full h-8 px-2.5 text-[13px] border border-gray-300 rounded bg-white outline-none focus:border-blue-500';
export const areaCls = 'w-full px-2.5 py-2 text-[13px] border border-gray-300 rounded bg-white outline-none focus:border-blue-500';

// Recharts tooltip in the app's style: values in ink, the colored dot carries identity.
export const ChartTooltip = ({ active, payload, label, unit = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-md px-2.5 py-2 text-[12px]">
      {label != null && <div className="text-gray-500 mb-1">{label}</div>}
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color || p.fill }} />
          <span className="text-gray-600">{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-gray-900 tabular-nums">{p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

export const Legend = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-600">
    {items.map(([name, color]) => <span key={name} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{name}</span>)}
  </div>
);

export const Empty = ({ children }) => <div className="py-10 text-center text-[13px] text-gray-500">{children}</div>;

// Brief toast for simulated actions.
export const useToast = () => {
  const [msg, setMsg] = useState('');
  const t = useRef(null);
  const show = (m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2600); };
  const node = msg ? (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] bg-gray-900 text-white text-[13px] rounded shadow-xl px-4 py-2 flex items-center gap-2">
      <CheckCircle2 size={14} className="text-emerald-400" /> {msg}
    </div>
  ) : null;
  return [show, node];
};
