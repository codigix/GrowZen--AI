import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench as WrenchIcon, Download, AlertTriangle, Bell, Sparkles, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, ExternalLink, ShieldCheck, FileText, Loader2, Mail, Play, RefreshCw, Search, SkipForward, Wrench, XCircle } from 'lucide-react';
import { Button, Drawer } from './SeoUi';
import Select from '../components/Select';
import { api, SEO_API } from './seoApi';

const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtDay = (d) => { if (!d) return '—'; const t = new Date(`${String(d).slice(0, 10)}T00:00:00`); return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const fmtWhen = (iso) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const num = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const signed = (v) => (!isNum(v) ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`);
const Card = ({ children, className = '' }) => <section className={`bg-white rounded-xl border border-slate-200 shadow-sm min-w-0 ${className}`}>{children}</section>;
const Chip = ({ children, cls = 'bg-slate-100 text-slate-700', title }) => <span title={title} className={`inline-flex items-center gap-1 text-12 rounded-full px-2.5 py-1 leading-none font-medium whitespace-nowrap ${cls}`}>{children}</span>;
const Skeleton = ({ h = 'h-24' }) => <div className={`rounded-xl bg-slate-100 animate-pulse ${h}`} />;
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Muscat', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Singapore', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Australia/Sydney', 'Pacific/Auckland', 'Africa/Johannesburg', 'Africa/Nairobi', 'Africa/Lagos'];
const MODE = { auto: 'bg-emerald-50 text-emerald-700', ai_approve: 'bg-violet-50 text-violet-700', ai_apply: 'bg-indigo-50 text-indigo-700', manual: 'bg-slate-100 text-slate-700' };
const ModeChip = ({ m, label, help }) => <Chip cls={MODE[m] || MODE.manual} title={help}>{m === 'auto' || m === 'ai_approve' || m === 'ai_apply' ? <Sparkles size={11} /> : null}{label}</Chip>;
const SEV = {
  critical: ['Critical', 'bg-red-50 text-red-700', 'due in 3 days'],
  serious: ['Serious', 'bg-orange-50 text-orange-700', 'due in 7 days'],
  warning: ['Warning', 'bg-amber-50 text-amber-700', 'due in 14 days'],
  info: ['Improvement', 'bg-slate-100 text-slate-700', 'due in 30 days']
};
const AREA = { gmb: 'Google profile', local: 'Listings & rankings', seo: 'Website SEO & security', aeo: 'Answer engines', geo: 'AI search', chatgpt: 'ChatGPT' };

// ---------------------------------------------------------------------------------------------------------------- start the plan
export function StartCard({ bid, onDone }) {
  const [st, setSt] = useState({ state: 'idle', steps: [] });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const done = useRef(onDone);
  done.current = onDone;

  const poll = useCallback(async () => {
    try {
      const s = await api(`/businesses/${bid}/growth/start/status`);
      setSt(s);
      if (s.state === 'running') timer.current = setTimeout(poll, 2000);
      else if (s.state !== 'idle') done.current && done.current();
    } catch (e) { setErr(e.message || 'Could not read the progress.'); }
  }, [bid]);
  useEffect(() => { setSt({ state: 'idle', steps: [] }); setErr(''); poll(); return () => clearTimeout(timer.current); }, [poll]);

  const start = async () => {
    setBusy(true); setErr('');
    try { const s = await api(`/businesses/${bid}/growth/start`, { method: 'POST', body: {} }); setSt(s); clearTimeout(timer.current); timer.current = setTimeout(poll, 1500); } catch (e) { setErr(e.message || 'Could not start the plan.'); } finally { setBusy(false); }
  };
  const running = st.state === 'running';
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[260px]">
          <h3 className="text-15 font-semibold text-slate-900 flex items-center gap-2"><Play size={16} className="text-indigo-600" aria-hidden="true" />Start the plan</h3>
          <p className="mt-1 text-13 text-slate-600 leading-relaxed">Measures everything live, syncs the Google profile, runs the audits and rank check, finds every issue and makes a fix task for it, drafts replies and a post for your approval, sets today's, this week's and this month's plan and emails you. Nothing is published or changed on Google or your website without you.</p>
        </div>
        <Button variant="primary" icon={running ? Loader2 : Play} disabled={running || busy} onClick={start}>{running ? 'Running…' : st.state === 'done' || st.state === 'failed' ? 'Run again' : 'Start plan'}</Button>
      </div>
      {err && <p className="mt-3 text-13 text-red-700" role="alert">{err}</p>}
      {arr(st.steps).length > 0 && st.state !== 'idle' && (
        <ol className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2" aria-live="polite">
          {st.steps.map(s => (
            <li key={s.key} className="flex gap-2 text-13 min-w-0">
              {s.state === 'running' ? <Loader2 size={16} className="animate-spin text-indigo-600 mt-0.5 shrink-0" /> : s.state === 'done' ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> : s.state === 'skipped' ? <SkipForward size={16} className="text-amber-500 mt-0.5 shrink-0" /> : <Circle size={16} className="text-slate-300 mt-0.5 shrink-0" />}
              <span className="min-w-0"><span className={s.state === 'waiting' ? 'text-slate-400' : 'text-slate-800 font-medium'}>{s.label}</span>{s.detail && <span className="block text-12 text-slate-500 break-words">{s.detail}</span>}</span>
            </li>
          ))}
        </ol>
      )}
      {st.state === 'failed' && <p className="mt-3 text-13 text-red-700 flex gap-1.5"><XCircle size={15} className="mt-0.5 shrink-0" />The start stopped early{st.error ? `: ${st.error}` : ''}. Run it again.</p>}
      {st.state === 'done' && <p className="mt-3 text-12.5 text-slate-500">Finished {fmtWhen(st.finished_at)}. Steps marked with a skip arrow could not run; the reason is shown under them.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------- issues
const STATUS = {
  todo: ['To do', 'bg-slate-100 text-slate-700'], done: ['Done, not checked', 'bg-indigo-50 text-indigo-700'], unverified: ['Not confirmed', 'bg-amber-50 text-amber-700'],
  failed: ['Overdue', 'bg-red-50 text-red-700'], blocked: ['Blocked', 'bg-slate-100 text-slate-500'], verified: ['Fixed', 'bg-emerald-50 text-emerald-700'], skipped: ['Skipped', 'bg-slate-100 text-slate-500']
};
const isExt = (l) => !!l && /^https?:\/\//i.test(l);
const OpenLink = ({ link, children, variant }) => (isExt(link)
  ? <a href={link} target="_blank" rel="noreferrer"><Button size="sm" variant={variant} icon={ExternalLink}>{children}</Button></a>
  : <Link to={link}><Button size="sm" variant={variant} icon={ExternalLink}>{children}</Button></Link>);

function Block({ title, children }) {
  return <div className="min-w-0"><div className="text-12 font-semibold uppercase tracking-wide text-slate-500 mb-1">{title}</div><div className="text-13.5 text-slate-700 leading-relaxed">{children}</div></div>;
}


function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked: the text can still be selected */ } };
  return <button type="button" onClick={copy} className="text-12 font-semibold text-indigo-600 hover:underline cursor-pointer">{ok ? 'Copied' : 'Copy'}</button>;
}

function DraftBox({ a, bid, onChanged }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const d = a.draft;
  const data = d?.data || {};
  const run = async (path) => {
    setBusy(path); setErr('');
    try { await api(`/businesses/${bid}/growth/actions/${a.id}/${path}`, { method: 'POST', body: {} }); await onChanged(); } catch (e) { setErr(e.message || 'That did not work.'); } finally { setBusy(''); }
  };
  const Field = ({ label, value }) => value ? (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3"><span className="text-12 font-semibold text-slate-500 uppercase tracking-wide">{label}</span><CopyBtn text={value} /></div>
      <p className="mt-1 text-13.5 text-slate-800 whitespace-pre-wrap break-words">{value}</p>
      <p className="mt-1 text-11 text-slate-400">{value.length} characters</p>
    </div>
  ) : null;
  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><div className="text-13.5 font-semibold text-slate-900 flex items-center gap-1.5"><Sparkles size={15} className="text-indigo-600" />Draft for your approval</div>
          <p className="text-12.5 text-slate-600">{d ? 'Read it, correct any fact, then use it. Nothing is published or changed for you.' : 'Let AI write the text for this task from your profile and keywords.'}</p></div>
        <Button size="sm" variant={d ? undefined : 'primary'} icon={busy === 'draft' ? Loader2 : Sparkles} disabled={!!busy} onClick={() => run('draft')}>{busy === 'draft' ? 'Writing…' : d ? 'Write again' : 'Write a draft'}</Button>
      </div>
      {err && <p className="mt-2 text-13 text-red-700" role="alert">{err}</p>}
      {d && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">{Object.entries(d.keyword_used || {}).map(([k, v]) => <Chip key={k} cls={v ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} title={v ? 'The draft uses this keyword' : 'The draft does not use this keyword: edit it in'}>{v ? '✓' : '!'} {k}</Chip>)}</div>
          {d.page && <p className="text-12.5 text-slate-600">For page: <span className="font-medium break-all">{d.page}</span></p>}
          {d.kind === 'meta' && <><Field label="Page title" value={data.title} /><Field label="Meta description" value={data.description} /><Field label="H1 heading" value={data.h1} /></>}
          {d.kind === 'profile' && <><Field label="Business description" value={data.description} />{arr(data.services).map((x, i) => <Field key={i} label={`Service ${i + 1}: ${x.name}`} value={x.description} />)}</>}
          {d.kind === 'post' && <><Field label="Post title" value={data.title} /><Field label="Post text" value={data.body} />
            {d.applied ? <p className="text-13 text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} />Saved as a draft post. <Link to="/google-posts" className="font-semibold underline">Open Google Posts</Link> to review and publish it.</p>
              : <Button size="sm" variant="primary" icon={busy === 'draft/apply' ? Loader2 : Check} disabled={!!busy} onClick={() => run('draft/apply')}>Save as a draft post</Button>}</>}
          {d.kind === 'alt' && arr(data.alts).map((x, i) => <Field key={i} label={`Image alt text ${i + 1}`} value={x} />)}
          {d.kind === 'blog' && <><Field label="Article title" value={data.title} /><Field label="Meta description" value={data.meta_description} /><Field label="Intro" value={data.intro} />{arr(data.headings).length > 0 && <Field label="Section headings" value={data.headings.map((h, i) => `${i + 1}. ${h}`).join('\n')} />}</>}
          <p className="text-11.5 text-slate-500">{d.model_note}</p>
        </div>
      )}
    </div>
  );
}

function IssueDetail({ a, bid, onChanged }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [panel, setPanel] = useState(null);
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const call = async (kind, body) => {
    setBusy(kind); setErr('');
    try { const r = await api(`/businesses/${bid}/growth/actions/${a.id}/${kind}`, { method: 'POST', body: body || {} }); if (kind === 'verify') setRes(r?.result || null); setPanel(null); setText(''); await onChanged(); } catch (e) { setErr(e.message || 'That did not work.'); } finally { setBusy(''); }
  };
  const last = res?.details || a.last_check;
  return (
    <div className="bg-slate-50/70 border-t border-slate-200 px-4 sm:px-6 py-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-5">
        <Block title="What is wrong and why it matters">{a.why || '—'}</Block>
        <Block title="How to fix it"><ol className="list-decimal pl-5 space-y-1">{arr(a.how).map((h, i) => <li key={i}>{h}</li>)}</ol></Block>
        <Block title="How we know it is fixed">{a.closes_when}<span className="block text-12 text-slate-500 mt-1">Pressing “Mark done” is never proof: the issue closes only when the real data confirms it.</span></Block>
        <Block title="Where it came from">{a.source_label || '—'}<span className="block text-12 text-slate-500 mt-0.5">{a.found_at ? `Found ${fmtDay(a.found_at)}` : ''}{a.first_seen ? ` · first seen ${fmtDay(a.first_seen)}` : ''} · about {a.est_minutes} min of work</span></Block>
        {last && <Block title="Last check">{last}{a.checked_at && <span className="block text-12 text-slate-500 mt-0.5">{fmtWhen(a.checked_at)}</span>}</Block>}
        {a.confidence === 'check_first' && a.note_check && <Block title="Check first"><span className="text-violet-800">{a.note_check}</span></Block>}
        {a.note && <Block title="Note">{a.note}</Block>}
      </div>
      {a.draft_kind && <DraftBox a={a} bid={bid} onChanged={onChanged} />}
      {panel && (
        <div className="mt-4 max-w-xl">
          <label className="text-12 font-semibold text-slate-700 block mb-1" htmlFor={`iss-note-${a.id}`}>{panel === 'skip' ? 'Why are you skipping this? (at least 5 characters)' : 'Add a note (optional)'}</label>
          <textarea id={`iss-note-${a.id}`} rows={2} value={text} onChange={e => setText(e.target.value.slice(0, 500))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-13 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <div className="mt-2 flex gap-2">
            {panel === 'skip' ? <Button size="sm" variant="primary" busy={busy === 'skip'} disabled={text.trim().length < 5} onClick={() => call('skip', { reason: text.trim() })}>Skip this issue</Button>
              : <Button size="sm" variant="primary" busy={busy === 'done'} onClick={() => call('done', text.trim() ? { note: text.trim() } : {})}>Confirm done</Button>}
            <Button size="sm" onClick={() => { setPanel(null); setText(''); }}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <p className="mt-3 text-13 text-red-700" role="alert">{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/growth/fix/${a.id}`}><Button size="sm" variant="primary" icon={WrenchIcon}>Get the exact fix</Button></Link>
        {a.link && <OpenLink link={a.link}>{a.website_side ? 'See the live page check' : 'Open where it is fixed'}</OpenLink>}
        {a.status === 'todo' && !panel && <><Button size="sm" icon={Check} onClick={() => setPanel('done')}>Mark done</Button><Button size="sm" onClick={() => setPanel('skip')}>Skip</Button></>}
        {['todo', 'done', 'unverified', 'failed'].includes(a.status) && <Button size="sm" icon={busy === 'verify' ? Loader2 : ShieldCheck} disabled={busy === 'verify'} onClick={() => call('verify')}>{busy === 'verify' ? 'Checking live data…' : 'Check now'}</Button>}
      </div>
    </div>
  );
}

function IssueTable({ rows, bid, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const th = 'px-3 py-3 text-left font-medium whitespace-nowrap';
  return (
    <Card className="overflow-hidden">
      <ul className="md:hidden divide-y divide-slate-100">
        {rows.map(a => {
          const sv = SEV[a.severity] || SEV.warning, stt = STATUS[a.status] || STATUS.todo, on = openId === a.id;
          return (
            <li key={a.id}>
              <button type="button" aria-expanded={on} onClick={() => setOpenId(on ? null : a.id)} className="w-full text-left px-4 py-3.5 cursor-pointer">
                <div className="flex flex-wrap items-center gap-1.5"><Chip cls={sv[1]}>{sv[0]}</Chip><Chip cls={stt[1]}>{stt[0]}</Chip><span className={`text-12 ${a.overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>due {fmtDay(a.due_on)}{a.overdue ? ' · overdue' : ''}</span></div>
                <div className="mt-1.5 font-medium text-slate-900 leading-snug">{a.title}</div><div className="mt-1"><ModeChip m={a.fix_mode} label={a.fix_mode_label} /></div>
                <div className="mt-0.5 text-12.5 text-slate-500">{AREA[a.area] || a.area} · {a.source_label || '—'}</div>
              </button>
              {on && <IssueDetail a={a} bid={bid} onChanged={onChanged} />}
            </li>
          );
        })}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-14 min-w-[980px]">
          <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200">
            <th className={`${th} w-10`}><span className="sr-only">Expand</span></th><th className={th}>Severity</th><th className={`${th} w-[34%]`}>Issue</th><th className={th}>Area</th><th className={th}>Source</th><th className={th}>Found</th><th className={th}>Due</th><th className={th}>Status</th><th className={`${th} text-right`}>Fix</th>
          </tr></thead>
          <tbody>
            {rows.map(a => {
              const sv = SEV[a.severity] || SEV.warning, stt = STATUS[a.status] || STATUS.todo, on = openId === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr className={`border-b border-slate-100 align-top cursor-pointer ${on ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}`} onClick={() => setOpenId(on ? null : a.id)}>
                    <td className="px-3 py-3.5"><button type="button" aria-expanded={on} aria-label={on ? 'Hide details' : 'Show details'} onClick={e => { e.stopPropagation(); setOpenId(on ? null : a.id); }} className="text-slate-500 cursor-pointer">{on ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></td>
                    <td className="px-3 py-3.5"><Chip cls={sv[1]}>{sv[0]}</Chip></td>
                    <td className="px-3 py-3.5 min-w-0"><div className="font-medium text-slate-900 leading-snug">{a.title}</div><div className="mt-1"><ModeChip m={a.fix_mode} label={a.fix_mode_label} /></div>{a.confidence === 'check_first' && <div className="mt-1"><Chip cls="bg-violet-50 text-violet-700" title={a.note_check || ''}>Check first</Chip></div>}<div className="mt-0.5 text-12.5 text-slate-500 line-clamp-2">{a.why}</div></td>
                    <td className="px-3 py-3.5 text-13 text-slate-700 whitespace-nowrap">{AREA[a.area] || a.area}</td>
                    <td className="px-3 py-3.5 text-12.5 text-slate-600 min-w-[150px] max-w-[200px]">{a.source_label || '—'}</td>
                    <td className="px-3 py-3.5 text-13 text-slate-600 whitespace-nowrap">{fmtDay(a.found_at || a.first_seen)}</td>
                    <td className={`px-3 py-3.5 text-13 whitespace-nowrap ${a.overdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{fmtDay(a.due_on)}{a.overdue && <span className="block text-11 font-medium">overdue</span>}</td>
                    <td className="px-3 py-3.5"><Chip cls={stt[1]}>{stt[0]}</Chip></td>
                    <td className="px-3 py-3.5 text-right" onClick={e => e.stopPropagation()}><Link to={`/growth/fix/${a.id}`}><Button size="sm" variant="primary" icon={WrenchIcon}>Fix it</Button></Link></td>
                  </tr>
                  {on && <tr><td colSpan={9} className="p-0"><IssueDetail a={a} bid={bid} onChanged={onChanged} /></td></tr>}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-12 text-slate-500 border-t border-slate-100 bg-slate-50/60">Click a row to read what is wrong, the steps to fix it, how it will be verified and where it came from. Severity sets the deadline: critical 3 days, serious 7, warning 14, improvement 30.</p>
    </Card>
  );
}

function BriefDrawer({ brief, onClose }) {
  const [ok, setOk] = useState(false);
  const text = brief?.markdown || '';
  const copy = async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* clipboard blocked */ } };
  const download = () => { const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); const a = document.createElement('a'); a.href = url; a.download = 'website-fixes.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return (
    <Drawer open={!!brief} onClose={onClose} title="Developer brief" subtitle="Every open website fix with its exact code, in order of importance" width="max-w-3xl">
      {brief?.loading ? <div className="py-10 text-center text-13 text-slate-600"><Loader2 size={22} className="mx-auto animate-spin text-indigo-600 mb-2" />Building the brief from your live site. This can take a minute when AI is writing titles and answers.</div>
        : brief?.error ? <p className="text-13 text-red-700 bg-red-50 rounded-lg px-3 py-2">{brief.error}</p>
          : brief ? (
            <div className="space-y-3">
              <p className="text-13 text-slate-700">{brief.count} fix{brief.count === 1 ? '' : 'es'}, about {brief.minutes} minutes of work in total. Send this to whoever edits your website: every item says where the code goes and how it is checked.</p>
              <div className="flex flex-wrap gap-2"><Button variant="primary" icon={ok ? Check : undefined} onClick={copy}>{ok ? 'Copied' : 'Copy brief'}</Button><Button icon={Download} onClick={download}>Download .md</Button></div>
              {arr(brief.skipped).length > 0 && <p className="text-12.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Not included: {brief.skipped.join(' · ')}</p>}
              <pre className="text-12.5 leading-relaxed text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3.5 whitespace-pre-wrap break-words font-mono max-h-[60vh] overflow-auto">{text}</pre>
            </div>
          ) : null}
    </Drawer>
  );
}

export function IssuesView({ bid }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [area, setArea] = useState('all');
  const [sev, setSev] = useState('all');
  const [showClosed, setShowClosed] = useState(false);
  const [msg, setMsg] = useState('');
  const [brief, setBrief] = useState(null); // {loading} | {markdown, count, minutes, skipped} | {error}
  useEffect(() => {
    if (!brief?.loading) return undefined;
    let live = true;
    api(`/businesses/${bid}/growth/handoff`, { timeout: 180000 }).then(r => { if (live) setBrief(r); }).catch(e => { if (live) setBrief({ error: e.message || 'The brief could not be built.' }); });
    return () => { live = false; };
  }, [brief?.loading, bid]);
  const load = useCallback(async () => {
    try { setD(await api(`/businesses/${bid}/growth/issues`)); setError(''); } catch (e) { setError(e.message || 'Could not load the issues.'); }
  }, [bid]);
  useEffect(() => { setD(null); load(); }, [load]);
  const scan = async () => {
    setScanning(true); setMsg('');
    try {
      const r = await api(`/businesses/${bid}/growth/issues/scan`, { method: 'POST', body: {} });
      setD(r); setError('');
      const s = r.scan || {};
      setMsg(`${s.found} issue${s.found === 1 ? '' : 's'} found, ${s.created} new task${s.created === 1 ? '' : 's'}, ${s.closed} closed.${arr(s.skipped).length ? ` Not checked: ${s.skipped.join('; ')}.` : ''}`);
    } catch (e) { setError(e.message || 'The scan did not finish.'); } finally { setScanning(false); }
  };
  if (error && !d) return <Card className="p-6 text-13 text-red-700">{error} <button type="button" className="font-semibold underline cursor-pointer" onClick={load}>Try again</button></Card>;
  if (!d) return <div className="space-y-4"><Skeleton h="h-16" /><Skeleton h="h-40" /><Skeleton h="h-40" /></div>;
  const open = arr(d.open).filter(x => (area === 'all' || x.area === area) && (sev === 'all' || x.severity === sev));
  const areas = Object.keys(d.by_area || {});
  return (
    <div className="space-y-5">
      <BriefDrawer brief={brief} onClose={() => setBrief(null)} />
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <h3 className="text-15 font-semibold text-slate-900 flex items-center gap-2"><Wrench size={16} className="text-indigo-600" aria-hidden="true" />{d.open_total} open issue{d.open_total === 1 ? '' : 's'}{d.overdue > 0 && <span className="text-12 font-semibold text-red-600">· {d.overdue} overdue</span>}</h3>
            <p className="mt-0.5 text-12.5 text-slate-500">Every problem found in the website, Google profile, listings, rankings and ChatGPT module. Open a task to land on the page where it is fixed; it closes only when the real data stops reporting it.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button icon={Download} onClick={() => setBrief({ loading: true })}>Developer brief</Button>
            <Button variant="primary" icon={scanning ? Loader2 : Search} disabled={scanning} onClick={scan}>{scanning ? 'Scanning…' : 'Scan now'}</Button></div>
        </div>
        {d.by_mode && (
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2.5" aria-label="Who fixes the open issues">
            {Object.entries(d.modes || {}).map(([m, v]) => (
              <div key={m} className="rounded-lg border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><ModeChip m={m} label={v.label} /><span className="text-20 font-semibold tabular-nums text-slate-900">{d.by_mode[m] || 0}</span></div><p className="mt-1.5 text-12 text-slate-500 leading-snug">{v.help}</p></div>
            ))}
          </div>
        )}
        {msg && <p className="mt-3 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{msg}</p>}
        {error && <p className="mt-3 text-13 text-red-700" role="alert">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {['all', 'critical', 'serious', 'warning', 'info'].map(k => {
            const n = k === 'all' ? d.open_total : (d.counts || {})[k] || 0;
            return <button key={k} type="button" aria-pressed={sev === k} onClick={() => setSev(k)} className={`text-13 rounded-full px-3 py-1.5 border cursor-pointer ${sev === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{k === 'all' ? 'All' : SEV[k][0]} <span className="tabular-nums">{n}</span></button>;
          })}
          <span className="w-px bg-slate-200 mx-1" aria-hidden="true" />
          {['all', ...areas].map(k => <button key={k} type="button" aria-pressed={area === k} onClick={() => setArea(k)} className={`text-13 rounded-full px-3 py-1.5 border cursor-pointer ${area === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{k === 'all' ? 'Every area' : AREA[k] || k}{k !== 'all' && <span className="tabular-nums"> {d.by_area[k]}</span>}</button>)}
          {['seo', 'aeo', 'geo', 'gmb', 'local', 'chatgpt'].includes(area) && <Link to={`/fix-plan?area=${area}`} className="ml-auto self-center text-13 font-semibold text-indigo-600 hover:underline">See this area in the Fix Plan →</Link>}
        </div>
      </Card>

      {open.length === 0 ? (
        <Card className="p-8 text-center"><CheckCircle2 size={28} className="mx-auto text-emerald-500" aria-hidden="true" /><h3 className="mt-2 text-15 font-semibold text-slate-900">{d.open_total ? 'No issue matches this filter' : 'No open issues'}</h3><p className="mt-1 text-13 text-slate-500">{d.open_total ? 'Clear a filter to see the rest.' : 'The latest scan found nothing to fix. Scan again after changes to your website or profile.'}</p></Card>
      ) : (
        <IssueTable rows={open} bid={bid} onChanged={load} />
      )}

      {arr(d.closed).length > 0 && (
        <Card className="p-4 sm:p-5">
          <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed(v => !v)} className="text-14 font-semibold text-slate-900 cursor-pointer">Fixed in the last 30 days ({d.closed.length}) <span className="text-indigo-600 text-13">{showClosed ? 'Hide' : 'Show'}</span></button>
          {showClosed && <ul className="mt-3 space-y-2">{d.closed.map(a => <li key={a.id} className="flex gap-2 text-13 text-slate-700"><CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" /><span className="min-w-0">{a.title}<span className="text-slate-400"> · {fmtDay(a.verified_at)}</span></span></li>)}</ul>}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- reports
function Delta({ v, invert }) {
  if (!isNum(v) || v === 0) return <span className="text-slate-400 tabular-nums">{isNum(v) ? '0' : '—'}</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={`tabular-nums font-semibold ${good ? 'text-emerald-600' : 'text-red-600'}`}>{signed(v)}</span>;
}

function ReportBody({ r }) {
  const d = r.data || {};
  const p = d.presence || {};
  const t = d.targets || {};
  const k = d.tasks || {};
  const i = d.issues || {};
  return (
    <div className="space-y-5">
      <div>
        <div className="text-12 text-slate-500">{d.period === 'week' ? 'Weekly' : 'Monthly'} report · {fmtDay(d.start)} to {fmtDay(d.end)}{d.in_progress ? ' · in progress' : ''}</div>
        <h3 className="mt-1 text-18 font-semibold text-slate-900">{d.headline}</h3>
        <ul className="mt-2 space-y-1.5 text-13.5 text-slate-700">{arr(d.narrative).map((x, n) => <li key={n} className="flex gap-2"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />{x}</li>)}</ul>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Presence', isNum(p.end) ? `${Math.round(p.end)}` : '—', <Delta key="d" v={p.delta} />], ['Targets met', `${t.met ?? 0}/${t.total ?? 0}`, <span key="m" className="text-slate-500">{t.missed || 0} missed</span>],
          ['Tasks verified', `${k.verified ?? 0}/${k.total ?? 0}`, <span key="u" className="text-slate-500">{(k.unverified || 0) + (k.failed || 0)} not verified</span>], ['Issues fixed', `${i.resolved ?? 0}`, <span key="o" className="text-slate-500">{i.open_total ?? 0} still open</span>]].map(([l, v, sub]) => (
          <div key={l} className="rounded-xl border border-slate-200 p-3.5"><div className="text-12 text-slate-500">{l}</div><div className="text-22 font-semibold text-slate-900 tabular-nums leading-tight">{v}</div><div className="text-12">{sub}</div></div>
        ))}
      </div>
      {arr(d.areas).some(a => isNum(a.end)) && (
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-13.5">
          <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200"><th className="px-4 py-2.5 text-left font-medium">Area</th><th className="px-4 py-2.5 text-right font-medium">Start</th><th className="px-4 py-2.5 text-right font-medium">End</th><th className="px-4 py-2.5 text-right font-medium">Change</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{arr(d.areas).map(a => <tr key={a.key} className="h-10"><td className="px-4 text-slate-800">{a.label}</td><td className="px-4 text-right tabular-nums text-slate-600">{num(a.start)}</td><td className="px-4 text-right tabular-nums text-slate-900">{num(a.end)}</td><td className="px-4 text-right"><Delta v={a.delta} /></td></tr>)}</tbody>
        </table></div>
      )}
      {arr(d.metrics).length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-13.5">
          <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200"><th className="px-4 py-2.5 text-left font-medium">Key number</th><th className="px-4 py-2.5 text-right font-medium">Start</th><th className="px-4 py-2.5 text-right font-medium">End</th><th className="px-4 py-2.5 text-right font-medium">Change</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{arr(d.metrics).map(m => <tr key={m.key} className="h-10"><td className="px-4 text-slate-800">{m.label}</td><td className="px-4 text-right tabular-nums text-slate-600">{num(m.start)}</td><td className="px-4 text-right tabular-nums text-slate-900">{num(m.end)} <span className="text-slate-400">{m.unit}</span></td><td className="px-4 text-right"><Delta v={m.delta} invert={m.direction === 'down'} /></td></tr>)}</tbody>
        </table></div>
      )}
      {arr(d.keywords).length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-13.5">
          <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200"><th className="px-4 py-2.5 text-left font-medium">Keyword (Google position)</th><th className="px-4 py-2.5 text-right font-medium">Start</th><th className="px-4 py-2.5 text-right font-medium">End</th><th className="px-4 py-2.5 text-right font-medium">Change</th><th className="px-4 py-2.5 text-right font-medium">Maps now</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.keywords.map(k => <tr key={k.keyword} className="h-10"><td className="px-4 text-slate-800">{k.keyword}</td><td className="px-4 text-right tabular-nums text-slate-600">{num(k.start)}</td><td className="px-4 text-right tabular-nums text-slate-900">{k.end == null ? <span className="text-slate-400">not in results</span> : k.end}</td><td className="px-4 text-right"><Delta v={k.change} /></td><td className="px-4 text-right tabular-nums text-slate-600">{num(k.maps_end)}</td></tr>)}</tbody>
        </table></div>
      )}
      {arr(t.items).length > 0 && (
        <div><h4 className="text-14 font-semibold text-slate-900 mb-2">Targets</h4>
          <ul className="space-y-1.5">{t.items.map((x, n) => <li key={n} className="flex gap-2 text-13.5 text-slate-700">{x.status === 'met' ? <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" /> : x.status === 'missed' ? <XCircle size={15} className="text-red-500 mt-0.5 shrink-0" /> : <Circle size={15} className="text-slate-300 mt-0.5 shrink-0" />}<span className="min-w-0">{x.label}: {num(x.baseline)} → {num(x.final)} <span className="text-slate-400">(target {num(x.target)} {x.unit})</span></span></li>)}</ul></div>
      )}
      {arr(i.top_open).length > 0 && (
        <div><h4 className="text-14 font-semibold text-slate-900 mb-2">Fix next</h4>
          <ul className="space-y-1.5">{i.top_open.map((x, n) => <li key={n} className="flex flex-wrap items-center gap-2 text-13.5 text-slate-700"><Chip cls={(SEV[x.severity] || SEV.warning)[1]}>{(SEV[x.severity] || SEV.warning)[0]}</Chip><span className="min-w-0">{x.title}</span><span className="text-12 text-slate-400">due {fmtDay(x.due_on)}</span></li>)}</ul></div>
      )}
      {(arr(d.next?.targets).length > 0 || arr(d.next?.tasks).length > 0) && (
        <div><h4 className="text-14 font-semibold text-slate-900 mb-2">Next {d.period}</h4>
          <ul className="space-y-1.5">{arr(d.next.tasks).map((x, n) => <li key={n} className="flex gap-2 text-13.5 text-slate-700"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />{x.title}</li>)}</ul></div>
      )}
    </div>
  );
}

function NotifySettings({ bid, s, onSaved }) {
  const [form, setForm] = useState({ email: !!s.email, weekly: !!s.weekly, monthly: !!s.monthly, alerts: !!s.alerts, to: s.to || '', timezone: s.timezone || '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      if ((s.timezone || '') !== form.timezone) await api(`/businesses/${bid}`, { method: 'PATCH', body: { timezone: form.timezone }, repeat: true });
      const { timezone: _tz, ...prefs } = form;
      const out = await api(`/businesses/${bid}/growth/notifications`, { method: 'PUT', body: { ...prefs, to: form.to.trim() } }); setMsg(`Saved. Reports go to ${out.sends_to || 'no address yet'}.`); onSaved(); } catch (e) { setErr(e.message || 'Could not save.'); } finally { setBusy(false); }
  };
  const Tog = ({ k, label, hint }) => (
    <label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked }))} className="mt-1 w-4 h-4 accent-indigo-600" /><span><span className="text-13.5 font-medium text-slate-800">{label}</span><span className="block text-12 text-slate-500">{hint}</span></span></label>
  );
  return (
    <Card className="p-5">
      <h3 className="text-15 font-semibold text-slate-900 flex items-center gap-2"><Bell size={16} className="text-indigo-600" aria-hidden="true" />Email notifications</h3>
      {!s.smtp_ready && <p className="mt-2 text-12.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />Email is not set up on this server (the SMTP settings are missing), so nothing can be sent yet. Reports are still saved here and in the bell.</p>}
      <div className="mt-3 space-y-3">
        <Tog k="email" label="Send emails" hint="The master switch for growth emails." />
        <Tog k="weekly" label="Weekly report" hint="Every Monday: the week that just ended." />
        <Tog k="monthly" label="Monthly report" hint="On the 1st: the month that just ended." />
        <Tog k="alerts" label="Critical issue alerts" hint="At most one email a day, only when a new critical issue is found." />
      </div>
      <label className="mt-4 block text-12.5 font-semibold text-slate-700" htmlFor="gp-to">Send to</label>
      <input id="gp-to" type="email" inputMode="email" autoComplete="email" maxLength={254} value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} placeholder={s.sends_to || 'Registered email'} className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-14 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
      <p className="mt-1 text-12 text-slate-500">Leave empty to use the registered address{s.sends_to ? ` (${s.sends_to})` : ''}.</p>
      <label className="mt-4 block text-12.5 font-semibold text-slate-700" htmlFor="gp-tz">Time zone</label>
      <Select className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-14" aria-label="Time zone" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}>
        <option value="">Automatic (from the project's country)</option>
        {TIMEZONES.map(z => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
      </Select>
      <p className="mt-1 text-12 text-slate-500">Days, weeks and report dates follow it. In use now: {s.timezone_in_use}; today is {s.today}.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="primary" busy={busy} onClick={save}>Save settings</Button>{msg && <span className="text-13 text-emerald-700" role="status">{msg}</span>}{err && <span className="text-13 text-red-700" role="alert">{err}</span>}</div>
    </Card>
  );
}

export function ReportsView({ bid }) {
  const [list, setList] = useState(null);
  const [settings, setSettings] = useState(null);
  const [sel, setSel] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async (keep) => {
    try {
      const r = await api(`/businesses/${bid}/growth/reports`);
      setList(arr(r.reports)); setSettings(r.settings); setError('');
      const id = keep || arr(r.reports)[0]?.id;
      if (id) setSel(await api(`/businesses/${bid}/growth/reports/${id}`)); else setSel(null);
    } catch (e) { setError(e.message || 'Could not load the reports.'); }
  }, [bid]);
  useEffect(() => { setList(null); setSel(null); load(); }, [load]);
  const make = async (period, current) => {
    setBusy(`${period}${current ? '-now' : ''}`); setNote('');
    try { const r = await api(`/businesses/${bid}/growth/reports/generate`, { method: 'POST', body: { period, current } }); await load(r.id); } catch (e) { setError(e.message || 'Could not build the report.'); } finally { setBusy(''); }
  };
  const send = async () => {
    if (!sel) return;
    setBusy('send'); setNote('');
    try { const r = await api(`/businesses/${bid}/growth/reports/${sel.id}/send`, { method: 'POST', body: {} }); setNote(r.sent ? r.reason : `Not sent: ${r.reason}`); await load(sel.id); } catch (e) { setError(e.message || 'Could not send.'); } finally { setBusy(''); }
  };
  if (error && !list) return <Card className="p-6 text-13 text-red-700">{error} <button type="button" className="font-semibold underline cursor-pointer" onClick={() => load()}>Try again</button></Card>;
  if (!list) return <div className="space-y-4"><Skeleton h="h-16" /><Skeleton h="h-72" /></div>;
  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]"><h3 className="text-15 font-semibold text-slate-900 flex items-center gap-2"><FileText size={16} className="text-indigo-600" aria-hidden="true" />Growth reports</h3>
            <p className="mt-0.5 text-12.5 text-slate-500">A weekly report every Monday and a monthly one on the 1st are built from the real measurements and emailed to {settings?.sends_to || 'the registered address'}.</p></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={busy === 'week-now' ? Loader2 : RefreshCw} disabled={!!busy} onClick={() => make('week', true)}>This week so far</Button>
            <Button size="sm" icon={busy === 'week' ? Loader2 : FileText} disabled={!!busy} onClick={() => make('week', false)}>Last week</Button>
            <Button size="sm" icon={busy === 'month' ? Loader2 : FileText} disabled={!!busy} onClick={() => make('month', false)}>Last month</Button>
          </div>
        </div>
        {error && <p className="mt-3 text-13 text-red-700" role="alert">{error}</p>}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
        <Card className="p-2">
          {list.length === 0 ? <p className="p-4 text-13 text-slate-500">No report yet. Press Start plan, or build one with the buttons above. The first weekly report arrives on Monday once a full week has been measured.</p> : (
            <ul>{list.map(x => (
              <li key={x.id}><button type="button" onClick={async () => { setNote(''); setSel(await api(`/businesses/${bid}/growth/reports/${x.id}`)); }} aria-current={sel?.id === x.id ? 'true' : undefined}
                className={`w-full text-left rounded-lg px-3 py-2.5 cursor-pointer ${sel?.id === x.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                <div className="flex items-center gap-2 text-13.5 font-medium text-slate-900">{x.period === 'week' ? 'Week' : 'Month'} · {fmtDay(x.start)}{x.in_progress && <Chip cls="bg-amber-50 text-amber-700">to date</Chip>}</div>
                <div className="mt-0.5 text-12 text-slate-500 flex items-center gap-1.5">{x.emailed_at ? <><Mail size={12} />Emailed {fmtWhen(x.emailed_at)}</> : x.email_error ? <span className="text-amber-700">Not emailed</span> : 'Not emailed'}</div>
              </button></li>))}</ul>
          )}
        </Card>
        <div className="space-y-5 min-w-0">
          {sel ? (
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <a href={`${SEO_API}/businesses/${bid}/growth/reports/${sel.id}/pdf`} target="_blank" rel="noreferrer"><Button size="sm" icon={FileText}>Download PDF</Button></a>
                <Button size="sm" icon={busy === 'send' ? Loader2 : Mail} disabled={busy === 'send'} onClick={send}>{sel.emailed_at ? 'Email again' : 'Email this report'}</Button>
                {sel.emailed_at && <span className="text-12.5 text-slate-500">Last emailed to {sel.emailed_to} on {fmtWhen(sel.emailed_at)}</span>}
                {!sel.emailed_at && sel.email_error && <span className="text-12.5 text-amber-700">{sel.email_error}</span>}
              </div>
              {note && <p className="mb-4 text-13 text-slate-700 bg-slate-50 rounded-lg px-3 py-2" role="status">{note}</p>}
              <ReportBody r={sel} />
            </Card>
          ) : null}
          {settings && <NotifySettings key={JSON.stringify(settings)} bid={bid} s={settings} onSaved={() => load(sel?.id)} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- keyword-to-content plan
export function ContentPlanView({ bid }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setD(null); api(`/businesses/${bid}/growth/content-plan`).then(setD).catch(e => setError(e.message || 'Could not load the content plan.')); }, [bid]);
  if (error) return <Card className="p-6 text-13 text-red-700">{error}</Card>;
  if (!d) return <div className="space-y-4"><Skeleton h="h-16" /><Skeleton h="h-48" /></div>;
  const surfaces = Object.entries(d.surfaces || {});
  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <h3 className="text-15 font-semibold text-slate-900">Keyword-to-content plan</h3>
        <p className="mt-0.5 text-12.5 text-slate-500">Each keyword topic against every place it should appear. A tick means every keyword of the topic is already used there (read from your real pages, profile, posts and articles). A number is how many keywords are still missing; its fix task, with an AI draft, is in the Issues tab. {d.tracked} keywords tracked, {d.grouped} grouped; Start plan groups the rest.</p>
      </Card>
      {arr(d.topics).length === 0 ? <Card className="p-8 text-center text-13 text-slate-500">No keywords to plan yet. Track keywords in Keyword Management, then press Start plan.</Card> : (
        <Card className="overflow-hidden"><div className="overflow-x-auto">
          <table className="w-full text-14 min-w-[860px]">
            <thead><tr className="text-12 text-slate-500 bg-slate-50 border-b border-slate-200"><th className="px-4 py-3 text-left font-medium">Topic and keywords</th><th className="px-3 py-3 text-right font-medium">Searches / mo</th>
              {surfaces.map(([k, v]) => <th key={k} className="px-3 py-3 text-center font-medium whitespace-nowrap capitalize">{v.label.replace("the ", "")}</th>)}</tr></thead>
            <tbody>{d.topics.map(t => (
              <tr key={t.topic} className="border-b border-slate-100 align-top">
                <td className="px-4 py-3.5"><div className="font-medium text-slate-900">{t.topic}</div><ul className="mt-1 space-y-0.5">{t.keywords.map(k => <li key={k.keyword} className="text-12.5 text-slate-600">{k.keyword}{k.rank ? <span className="text-slate-400"> · rank {k.rank}</span> : null}{k.target_url ? <span className="block text-11 text-slate-400 break-all">page: {k.target_url}</span> : <span className="block text-11 text-amber-600">no target page</span>}</li>)}</ul></td>
                <td className="px-3 py-3.5 text-right tabular-nums text-slate-700">{t.volume || '—'}</td>
                {surfaces.map(([k, v]) => { const c = t.coverage[k]; return (
                  <td key={k} className="px-3 py-3.5 text-center">{c.done ? <CheckCircle2 size={18} className="inline text-emerald-600" aria-label="Covered" />
                    : <Link to={v.link} title={`Missing: ${c.missing.join(', ')}`}><Chip cls="bg-amber-50 text-amber-700">{c.missing.length} missing</Chip></Link>}</td>); })}
              </tr>))}</tbody>
          </table>
        </div></Card>
      )}
    </div>
  );
}
