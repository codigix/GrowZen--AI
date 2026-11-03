import React, { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, ChevronLeft, ChevronRight, Plus, RefreshCw, Download, Check, Play, SkipForward, RotateCcw, ShieldCheck, Cpu, Globe } from 'lucide-react';
import { SeoShell, Card, Tabs, Badge, Button, Meter, Modal, Field, inputCls, areaCls, ErrorNote, useAction, useToast, useUrlTab, SkPage, Stat } from './SeoUi';
import { api, useApi, usePoll, fmtDate } from './seoApi';

const AREA = { gmb: 'Google Business', seo: 'On-page & content SEO', technical: 'Technical', metadata: 'Metadata', content: 'Content', backlinks: 'Backlinks, listings & off-site', rankings: 'Rankings', reviews: 'Reviews', other: 'Other' };
const AREA_ORDER = Object.keys(AREA);
const SOURCE = { audit: ['Audit', 'blue'], research: ['Site R&D', 'violet'], operation: ['Weekly routine', 'gray'], checklist: ['Ranking checklist', 'violet'], manual: ['Added by hand', 'amber'], agent: ['AI agent', 'blue'] };
const IMPACT_TONE = { High: 'red', Medium: 'amber', Low: 'gray' };
const PRIORITY_TONE = { 1: 'red', 2: 'orange', 3: 'amber', 4: 'gray' };
const STATUS_TONE = { todo: 'gray', doing: 'blue', done: 'green', skipped: 'gray', backlog: 'amber', carried: 'orange' };

const monday = (d = new Date()) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (isoDate, days) => { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const pct = (v) => (v == null ? '—' : `${v}%`);
const delta = (v) => (v == null ? '' : v > 0 ? `▲ ${v}` : v < 0 ? `▼ ${Math.abs(v)}` : '–');

// ---------------------------------------------------------------- This week
function ExampleBlock({ code }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
  return (
    <div className="relative">
      <button type="button" onClick={copy} aria-label={done ? 'Copied' : 'Copy example'} title={done ? 'Copied' : 'Copy example'}
        className="absolute top-2 right-2 w-7 h-7 rounded flex items-center justify-center bg-white/10 hover:bg-white/20 text-slate-200 cursor-pointer">{done ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}</button>
      <pre className="text-11.5 leading-relaxed text-slate-100 bg-slate-900 rounded p-3 pr-11 overflow-auto max-h-64 whitespace-pre-wrap">{code}</pre>
    </div>
  );
}

function TaskRow({ it, onChange, editable }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(it.note || '');
  const [src, tone] = SOURCE[it.source] || SOURCE.manual;
  const set = (patch) => onChange(it.id, patch);
  return (
    <li className={`border border-slate-100 rounded px-4 py-3 ${it.status === 'done' ? 'bg-emerald-50/40' : 'bg-white'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" aria-label={it.status === 'done' ? 'Mark as to do' : 'Mark done'} disabled={!editable} onClick={() => set({ status: it.status === 'done' ? 'todo' : 'done' })}
          className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 ${it.status === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-indigo-400'} disabled:opacity-40`}>
          {it.status === 'done' && <Check size={13} />}
        </button>
        <button type="button" className="flex-1 min-w-[220px] text-left cursor-pointer" onClick={() => setOpen(o => !o)}>
          <span className={`text-13 font-semibold ${it.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{it.title}</span>
          <span className="flex flex-wrap gap-1.5 mt-1.5">
            <Badge tone={PRIORITY_TONE[it.priority]}>{it.detail?.priority_label || `P${it.priority}`}</Badge>
            <Badge tone={tone}>{src}</Badge>
            {it.impact && it.source !== 'operation' && <Badge tone={IMPACT_TONE[it.impact]}>{it.impact} impact</Badge>}
            {it.carry_count > 0 && <Badge tone="orange" title="Not finished in an earlier week">carried over ×{it.carry_count}</Badge>}
            {it.verified && <Badge tone="green" title="The latest check no longer reports this problem"><ShieldCheck size={11} /> confirmed by audit</Badge>}
            {it.detail?.reopened && <Badge tone="red" title="Marked done earlier, but the check still reports it">re-opened</Badge>}
            <Badge tone={STATUS_TONE[it.status]}>{it.status === 'todo' ? 'to do' : it.status}</Badge>
            {it.assignee && <Badge>{it.assignee}</Badge>}
            {it.due_date && <Badge tone={new Date(`${it.due_date}T23:59:59`) < new Date() && it.status !== 'done' ? 'red' : 'gray'}>due {fmtDate(it.due_date)}</Badge>}
          </span>
        </button>
        {editable && it.status !== 'done' && (
          <div className="flex gap-1.5">
            {it.status !== 'doing' && <Button size="sm" icon={Play} onClick={() => set({ status: 'doing' })}>Start</Button>}
            <Button size="sm" variant="primary" icon={Check} onClick={() => set({ status: 'done', note })}>Done</Button>
            <Button size="sm" variant="ghost" icon={SkipForward} title="Won't do: it will not be planned again" onClick={() => set({ status: 'skipped', note })}>Skip</Button>
          </div>
        )}
        {editable && it.status === 'skipped' && <Button size="sm" icon={RotateCcw} onClick={() => set({ status: 'todo' })}>Restore</Button>}
      </div>
      {open && (
        <div className="mt-3 pl-8 grid gap-3 text-12 text-slate-600">
          {it.detail?.description
            ? <p className="whitespace-pre-line leading-relaxed">{it.detail.description}</p>
            : <>
              {it.detail?.why && <p><b className="text-slate-700">Why: </b>{it.detail.why}</p>}
              {it.detail?.how && <p><b className="text-slate-700">How: </b>{it.detail.how}</p>}
            </>}
          {it.detail?.fix_help?.where?.length > 0 && (
            <div>
              <b className="text-slate-700">Where to do it{it.detail.fix_help.platform && !['n/a', 'unknown'].includes(it.detail.fix_help.platform) ? ` (${it.detail.fix_help.platform})` : ''}: </b>
              <span className="inline-flex flex-wrap items-center gap-1 align-middle">{it.detail.fix_help.where.map((s, i) => <React.Fragment key={i}>{i > 0 && <span className="text-slate-300">›</span>}<span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{s}</span></React.Fragment>)}</span>
            </div>
          )}
          {it.detail?.fix_help?.example?.code && (
            <div><b className="text-slate-700 block mb-1">Example (dummy, with this client's details):</b><ExampleBlock code={it.detail.fix_help.example.code} /></div>
          )}
          {it.detail?.test_links?.length > 0 && (
            <div><b className="text-slate-700">Test it: </b>
              <span className="inline-flex flex-wrap gap-x-4 gap-y-1 align-top">{it.detail.test_links.map(l => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 font-semibold hover:underline">{l.label} <ExternalLink size={11} /></a>)}</span>
            </div>
          )}
          {editable && (
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="What was done / why skipped"><textarea className={areaCls} rows={2} value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (it.note || '') && set({ note })} /></Field>
              <Field label="Assigned to"><input className={inputCls} defaultValue={it.assignee || ''} onBlur={e => e.target.value !== (it.assignee || '') && set({ assignee: e.target.value || null })} /></Field>
              <Field label="Due date"><input type="date" className={inputCls} defaultValue={it.due_date || ''} onBlur={e => e.target.value !== (it.due_date || '') && set({ due_date: e.target.value || null })} /></Field>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ThisWeek({ b }) {
  const [week, setWeek] = useState(iso(monday()));
  const plan = useApi(`/businesses/${b.id}/workplan?week=${week}`);
  const [busy, error, run] = useAction();
  const [toast, toastNode] = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', area: 'other', how: '' });
  const d = plan.data;
  const current = d && d.week_start === d.current_week;
  const groups = useMemo(() => {
    const g = {};
    (d?.items || []).filter(i => i.status !== 'carried' && i.status !== 'backlog').forEach(i => { (g[i.area] = g[i.area] || []).push(i); });
    return AREA_ORDER.filter(a => g[a]).map(a => [a, g[a]]);
  }, [d]);
  const waiting = (d?.items || []).filter(i => i.status === 'backlog').concat(d?.backlog_elsewhere || []);
  const carriedOut = (d?.items || []).filter(i => i.status === 'carried');

  const change = (id, patch) => run('save', async () => { await api(`/businesses/${b.id}/workplan/items/${id}`, { method: 'PATCH', body: patch, repeat: true }); plan.reload(true); });
  const generate = () => run('plan', async () => { const r = await api(`/businesses/${b.id}/workplan/generate?week=${week}`, { method: 'POST' }); toast(`Planned: ${r.added} new, ${r.carried} carried over, ${r.verified} confirmed fixed`); plan.reload(); });
  const add = () => run('add', async () => { await api(`/businesses/${b.id}/workplan/items`, { method: 'POST', body: { ...draft, week } }); setAdding(false); setDraft({ title: '', area: 'other', how: '' }); plan.reload(); });

  if (!d) return plan.error ? <ErrorNote>{plan.error.message}</ErrorNote> : <SkPage header={false} />;
  const p = d.progress;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Planned this week" value={p.planned} />
        <Stat label="Done" value={p.done} hint={pct(p.completion_pct)} />
        <Stat label="In progress" value={p.doing} />
        <Stat label="Waiting in backlog" value={waiting.length} hint="future scope" />
      </div>
      <Card title={`Week of ${fmtDate(d.week_start)}${current ? ' (current)' : ''}`} subtitle="Everything planned for this project this week, from audits, website R&D and weekly routines. Unfinished work carries into next week."
        action={(
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={ChevronLeft} aria-label="Previous week" onClick={() => setWeek(shift(week, -7))} />
            <Button size="sm" icon={ChevronRight} aria-label="Next week" onClick={() => setWeek(shift(week, 7))} />
            <Button size="sm" icon={RefreshCw} busy={busy === 'plan'} onClick={generate}>Plan week</Button>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add task</Button>
          </div>
        )}>
        <Meter value={p.completion_pct || 0} color="#1abc9c" height={8} />
        <p className="text-12 text-slate-500 mt-2">{p.done} of {p.planned} done{p.carried_out ? ` · ${p.carried_out} unfinished moved to next week` : ''}{p.skipped ? ` · ${p.skipped} skipped` : ''}</p>
        <ErrorNote>{error}</ErrorNote>
        {!groups.length && <p className="text-13 text-slate-500 mt-4">Nothing is planned for this week yet. Press “Plan week” to build it from the latest audit and website research.</p>}
        <div className="grid gap-5 mt-5">
          {groups.map(([area, items]) => (
            <section key={area}>
              <h3 className="text-12 font-semibold text-slate-500 uppercase tracking-wide mb-2">{AREA[area]} · {items.filter(i => i.status === 'done').length}/{items.length}</h3>
              <ul className="grid gap-2">{items.map(i => <TaskRow key={i.id} it={i} onChange={change} editable />)}</ul>
            </section>
          ))}
        </div>
        {carriedOut.length > 0 && <p className="text-12 text-slate-500 mt-5">Moved to the following week: {carriedOut.map(i => i.title).join(' · ')}</p>}
      </Card>
      {waiting.length > 0 && (
        <Card title="Future scope (backlog)" subtitle="Found by the audits and website R&D but beyond this week's capacity for the plan. They move up as the week's work is finished.">
          <ul className="grid gap-1.5">
            {waiting.slice(0, 40).map(i => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-13 text-slate-700">
                <Badge tone={IMPACT_TONE[i.impact]}>{i.impact}</Badge><span>{i.title}</span><span className="text-11 text-slate-400">{AREA[i.area]}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal open={adding} title="Add a task" onClose={() => setAdding(false)} footer={<Button variant="primary" busy={busy === 'add'} disabled={draft.title.trim().length < 3} onClick={add}>Add to this week</Button>}>
        <div className="grid gap-3">
          <Field label="Task"><input className={inputCls} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Area"><select className={inputCls} value={draft.area} onChange={e => setDraft({ ...draft, area: e.target.value })}>{AREA_ORDER.map(a => <option key={a} value={a}>{AREA[a]}</option>)}</select></Field>
          <Field label="How (optional)"><textarea className={areaCls} rows={3} value={draft.how} onChange={e => setDraft({ ...draft, how: e.target.value })} /></Field>
        </div>
      </Modal>
      {toastNode}
    </div>
  );
}

// ---------------------------------------------------------------- Reports
const ItemList = ({ items, empty }) => (items?.length ? <ul className="grid gap-1 text-13 text-slate-700">{items.map(i => <li key={i.id} className="flex gap-2"><span className="text-slate-300">•</span><span>{i.title}{i.verified && <span className="text-emerald-600"> ✓ confirmed by audit</span>}{i.note ? <span className="text-slate-400"> — {i.note}</span> : ''}</span></li>)}</ul> : <p className="text-13 text-slate-400">{empty}</p>);

function Reports({ b }) {
  const [period, setPeriod] = useState('week');
  const history = useApi(`/businesses/${b.id}/reports/history?period=${period}`);
  const [start, setStart] = useState('');
  const rep = useApi(`/businesses/${b.id}/reports/${period}${start ? `?start=${start}` : ''}`);
  const [busy, error, run] = useAction();
  useEffect(() => { setStart(''); }, [period, b.id]);
  const d = rep.data;
  const pdf = () => run('pdf', async () => {
    const r = await api(`/businesses/${b.id}/reports/${period}/pdf${start ? `?start=${start}` : ''}`, { raw: true });
    const blob = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${b.name}-${period}-${d.start}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  });
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]} value={period} onChange={setPeriod} />
        <select aria-label="Report period" className={`${inputCls} !w-auto mb-5`} value={start} onChange={e => setStart(e.target.value)}>
          <option value="">Current {period}</option>
          {(history.data || []).map(h => <option key={h.id} value={h.start}>{period === 'week' ? `Week of ${fmtDate(h.start)}` : new Date(h.start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}{h.final ? '' : ' (running)'}</option>)}
        </select>
        <Button className="mb-5" icon={Download} busy={busy === 'pdf'} disabled={!d} onClick={pdf}>PDF</Button>
      </div>
      <ErrorNote>{error || rep.error?.message}</ErrorNote>
      {!d ? <SkPage header={false} /> : (
        <>
          <Card title={`${d.label}${d.final ? '' : ' · in progress'}`} subtitle="Plain-words summary built only from stored figures.">
            <p className="text-14 text-slate-700 leading-relaxed">{d.narrative}</p>
            {d.highlights.length > 0 && <ul className="flex flex-wrap gap-2 mt-4">{d.highlights.map((h, i) => <li key={i}><Badge tone="blue">{h}</Badge></li>)}</ul>}
          </Card>
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title={`Previous ${period}: ${d.previous.label}`} subtitle={`${d.previous.done} of ${d.previous.planned} done (${pct(d.previous.completion_pct)})`}>
              <h4 className="text-12 font-semibold text-slate-500 mb-1.5">Finished</h4><ItemList items={d.previous.completed} empty="Nothing was finished." />
              <h4 className="text-12 font-semibold text-slate-500 mt-4 mb-1.5">Not finished</h4><ItemList items={d.previous.not_finished} empty="Everything planned was finished." />
            </Card>
            <Card title={`This ${period}: ${d.label}`} subtitle={`${d.this_period.done} of ${d.this_period.planned} done (${pct(d.this_period.completion_pct)})${d.this_period.carried_in ? ` · ${d.this_period.carried_in} carried in` : ''}`}>
              <h4 className="text-12 font-semibold text-slate-500 mb-1.5">Done</h4><ItemList items={d.this_period.completed} empty="Nothing finished yet." />
              <h4 className="text-12 font-semibold text-slate-500 mt-4 mb-1.5">Still open</h4><ItemList items={d.this_period.in_progress} empty="Nothing open." />
            </Card>
          </div>
          <Card title="What changed" subtitle="Compared with the start of the period.">
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 text-13">
              <div><h4 className="text-12 font-semibold text-slate-500 mb-2">Audit scores</h4>
                {Object.entries(d.changes.scores.by_area).map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="capitalize text-slate-600">{k}</span><span>{v.before ?? '—'} → <b>{v.now ?? '—'}</b> <span className={v.delta > 0 ? 'text-emerald-600' : v.delta < 0 ? 'text-rose-600' : 'text-slate-400'}>{delta(v.delta)}</span></span></div>)}
                {!Object.keys(d.changes.scores.by_area).length && <p className="text-slate-400">No audits yet.</p>}
              </div>
              <div><h4 className="text-12 font-semibold text-slate-500 mb-2">Keyword positions</h4>
                {d.changes.rankings.slice(0, 8).map(r => <div key={r.keyword} className="flex justify-between py-0.5 gap-2"><span className="truncate text-slate-600">{r.keyword}</span><span>{r.before ?? '>20'} → <b>{r.now ?? '>20'}</b> <span className={r.delta > 0 ? 'text-emerald-600' : r.delta < 0 ? 'text-rose-600' : 'text-slate-400'}>{delta(r.delta)}</span></span></div>)}
                {!d.changes.rankings.length && <p className="text-slate-400">No rank checks yet.</p>}
              </div>
              <div><h4 className="text-12 font-semibold text-slate-500 mb-2">Work delivered</h4>
                {Object.entries(d.changes.operations).map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="capitalize text-slate-600">{k.replace(/_/g, ' ')}</span><b>{v}</b></div>)}
                {d.changes.backlinks && <div className="flex justify-between py-0.5"><span className="text-slate-600">Links gained / lost</span><b>{d.changes.backlinks.gained} / {d.changes.backlinks.lost}</b></div>}
              </div>
              <div><h4 className="text-12 font-semibold text-slate-500 mb-2">Metadata coverage</h4>
                {d.changes.metadata.coverage ? Object.entries(d.changes.metadata.coverage).map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="capitalize text-slate-600">{k.replace(/_/g, ' ')}</span><b>{pct(v)}</b></div>) : <p className="text-slate-400">Website research has not run yet.</p>}
              </div>
            </div>
            {d.weeks?.length > 0 && <div className="mt-5 text-12 text-slate-500">Weeks: {d.weeks.map(w => `${fmtDate(w.start)} ${w.done}/${w.planned}`).join(' · ')}</div>}
          </Card>
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title={d.next.label} subtitle="What is lined up next."><ItemList items={d.next.planned} empty="Nothing lined up: plan the next week." /></Card>
            <Card title="Future scope" subtitle="Found but not yet scheduled, soonest first.">
              {d.future_scope.length ? d.future_scope.map(g => <div key={g.horizon} className="mb-4"><h4 className="text-12 font-semibold text-slate-500 mb-1.5">{g.horizon} ({g.count})</h4><ItemList items={g.items} empty="" /></div>) : <p className="text-13 text-slate-400">The backlog is empty.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Website R&D
const COVER_LABEL = { title: 'Titles (25-60 chars, unique)', description: 'Meta descriptions (70-160, unique)', canonical: 'Canonical tags', open_graph: 'Open Graph (title, text, image)', twitter_card: 'Twitter/X card', schema: 'Structured data', language: 'Page language', single_h1: 'Exactly one H1' };
const tone = (v) => (v >= 80 ? '#1abc9c' : v >= 50 ? '#f7b84b' : '#f1556c');

function Research({ b }) {
  const r = useApi(`/businesses/${b.id}/research`);
  const [busy, error, run] = useAction();
  const running = r.data && ['queued', 'running'].includes(r.data.status);
  usePoll(() => r.reload(true), running, 3000);
  const start = () => run('go', async () => { await api(`/businesses/${b.id}/research`, { method: 'POST' }); r.reload(true); });
  const d = r.data;
  if (!d) return r.error ? <ErrorNote>{r.error.message}</ErrorNote> : <SkPage header={false} />;
  if (d.status === 'none') return <Card title="Website R&D"><p className="text-13 text-slate-600 mb-4">No research yet. It reads the tech stack, every page's metadata and the site-wide checks, then lists what to improve.</p><Button variant="primary" icon={Cpu} busy={busy === 'go'} onClick={start}>Research this website</Button><ErrorNote>{error}</ErrorNote></Card>;
  const stack = d.stack || {}, meta = d.metadata_audit || {}, checks = d.site_checks || {};
  const yes = (v) => (v === true ? <Badge tone="green">yes</Badge> : v === false ? <Badge tone="red">missing</Badge> : <Badge>unknown</Badge>);
  return (
    <div className="grid gap-5">
      <Card title="Website R&D" subtitle={d.summary || (running ? 'Researching the website…' : d.error)}
        action={<Button size="sm" icon={RefreshCw} busy={running || busy === 'go'} onClick={start}>Re-run research</Button>}>
        <ErrorNote>{error || (d.status === 'failed' ? d.error : '')}</ErrorNote>
        <p className="text-12 text-slate-400">{d.scanned_at ? `Last researched ${fmtDate(d.scanned_at)}` : ''}</p>
      </Card>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Technology stack" subtitle={stack.confidence ? `Detection confidence: ${stack.confidence}` : undefined}>
          <div className="flex flex-wrap gap-2">{(stack.stack || []).map(s => <Badge key={s} tone="blue"><Globe size={11} /> {s}</Badge>)}{!stack.stack?.length && <p className="text-13 text-slate-400">Nothing could be read from the site.</p>}</div>
          {stack.details && Object.entries(stack.details).map(([k, v]) => <p key={k} className="text-12 text-slate-600 mt-3"><b className="capitalize text-slate-700">{k}: </b>{v.join(', ')}</p>)}
          {stack.evidence?.length > 0 && <details className="mt-3 text-12 text-slate-500"><summary className="cursor-pointer">How we know ({stack.evidence.length} signs)</summary><ul className="mt-1.5 list-disc pl-5">{stack.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
          {stack.publishing?.note && <p className="text-12 text-slate-500 mt-3">{stack.publishing.note}</p>}
        </Card>
        <Card title="Site-wide checks">
          <div className="grid grid-cols-2 gap-y-2 text-13 text-slate-600">
            <span>HTTPS</span>{yes(checks.https)}<span>robots.txt</span>{yes(checks.robots_txt)}<span>XML sitemap</span>{yes(checks.sitemap)}<span>llms.txt (AI assistants)</span>{yes(checks.llms_txt)}
            <span>Compression</span>{yes(checks.compression ? true : checks.reachable ? false : null)}
            {Object.entries(checks.security_headers || {}).map(([k, v]) => <React.Fragment key={k}><span>{k}</span>{yes(v)}</React.Fragment>)}
          </div>
        </Card>
      </div>
      <Card title="Metadata across the site" subtitle={`${meta.pages_checked || 0} pages checked · score ${meta.score ?? '—'}/100`}>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
          {Object.entries(meta.coverage || {}).map(([k, v]) => <div key={k}><div className="flex justify-between text-12 text-slate-600 mb-1"><span>{COVER_LABEL[k] || k}</span><b>{pct(v)}</b></div><Meter value={v || 0} color={tone(v || 0)} /></div>)}
        </div>
        {meta.pages?.length > 0 && (
          <div className="overflow-x-auto mt-5"><table className="w-full text-12 text-left"><thead className="text-slate-400"><tr><th className="py-1.5 pr-3">Page</th><th className="pr-3">Title</th><th className="pr-3">Description</th><th className="pr-3">Problems</th></tr></thead>
            <tbody>{meta.pages.map(p => <tr key={p.url} className="border-t border-slate-100 align-top"><td className="py-2 pr-3 max-w-[220px] truncate" title={p.url}>{new URL(p.url).pathname}</td><td className="pr-3">{p.title_length}</td><td className="pr-3">{p.meta_description_length}</td>
              <td className="flex flex-wrap gap-1 py-2">{p.flags.length ? p.flags.map(f => <Badge key={f} tone="amber">{f.replace(/_/g, ' ')}</Badge>) : <Badge tone="green">ok</Badge>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      {d.suggested_metadata?.length > 0 && (
        <Card title="Suggested titles & descriptions" subtitle="Drafted from the client profile and each page's own heading. Review before publishing.">
          <div className="grid gap-4">{d.suggested_metadata.map(s => (
            <div key={s.url} className="border border-slate-100 rounded p-4 text-13">
              <p className="text-12 text-slate-400 truncate">{s.url} {s.wording === 'ai' && <Badge tone="violet">AI wording</Badge>}</p>
              <p className="mt-1 text-slate-400 line-through">{s.current_title || '(no title)'}</p><p className="font-semibold text-slate-800">{s.title} <span className="text-11 text-slate-400">{s.title.length}</span></p>
              <p className="mt-2 text-slate-400 line-through">{s.current_description || '(no description)'}</p><p className="text-slate-700">{s.description} <span className="text-11 text-slate-400">{s.description.length}</span></p>
            </div>))}</div>
        </Card>
      )}
      <Card title={`Improvements (${d.recommendations?.length || 0})`} subtitle="From the stack, the page metadata and the client's own profile. They feed the weekly plan automatically.">
        <ul className="grid gap-3">{(d.recommendations || []).map(x => (
          <li key={x.key} className="border border-slate-100 rounded p-4">
            <div className="flex flex-wrap items-center gap-2"><b className="text-13 text-slate-800">{x.title}</b><Badge tone={IMPACT_TONE[x.impact]}>{x.impact}</Badge><Badge>{x.effort}</Badge><Badge tone={x.source === 'ai' ? 'violet' : 'blue'}>{x.source}</Badge></div>
            <p className="text-12 text-slate-600 mt-1.5"><b>Why: </b>{x.why}</p><p className="text-12 text-slate-600 mt-1"><b>How: </b>{x.how}</p>
          </li>))}</ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- All projects
function AllProjects({ onOpen }) {
  const o = useApi('/workplan/overview');
  if (!o.data) return o.error ? <ErrorNote>{o.error.message}</ErrorNote> : <SkPage header={false} />;
  return (
    <Card title={`All projects · week of ${fmtDate(o.data.week_start)}`} subtitle="Where every project stands this week.">
      <div className="overflow-x-auto"><table className="w-full text-13 text-left"><thead className="text-12 text-slate-400"><tr><th className="py-2 pr-4">Project</th><th className="pr-4">Plan</th><th className="pr-4">Done</th><th className="pr-4 w-48">Progress</th><th className="pr-4">In progress</th><th className="pr-4">Overdue</th><th>Carried in</th></tr></thead>
        <tbody>{o.data.projects.map(p => (
          <tr key={p.business_id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onOpen(p.business_id)}>
            <td className="py-2.5 pr-4 font-semibold text-slate-800">{p.name}</td><td className="pr-4">{p.plan || '—'}</td><td className="pr-4">{p.done}/{p.planned}</td>
            <td className="pr-4"><Meter value={p.completion_pct || 0} color="#1abc9c" /></td><td className="pr-4">{p.doing}</td><td className={`pr-4 ${p.overdue ? 'text-rose-600 font-semibold' : ''}`}>{p.overdue}</td><td>{p.carried_in}</td>
          </tr>))}</tbody></table></div>
    </Card>
  );
}

const TABS = [{ id: 'week', label: 'This week' }, { id: 'reports', label: 'Weekly & monthly reports' }, { id: 'research', label: 'Website R&D' }, { id: 'all', label: 'All projects' }];

export default function WorkPlanPage() {
  const [tab, setTab] = useUrlTab('week', TABS.map(t => t.id));
  return (
    <SeoShell title="Work Plan & Reports" subtitle="Website research at onboarding, a weekly task plan for every project, and weekly and monthly reports: last period, this period, and what comes next.">
      {(business) => (
        <>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {tab === 'week' && <ThisWeek key={business.id} b={business} />}
          {tab === 'reports' && <Reports key={business.id} b={business} />}
          {tab === 'research' && <Research key={business.id} b={business} />}
          {tab === 'all' && <AllProjects onOpen={(id) => { try { localStorage.setItem('seoBusinessId', String(id)); } catch (e) { /* private window */ } window.dispatchEvent(new Event('seo-business')); setTab('week'); }} />}
        </>
      )}
    </SeoShell>
  );
}
