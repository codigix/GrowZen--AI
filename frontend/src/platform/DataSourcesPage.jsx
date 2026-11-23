import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleOff, Database, Layers } from 'lucide-react';
import { SeoShell, Card, Badge, ErrorNote, Tabs, SkList } from './SeoUi';
import { useApi } from './seoApi';
import DataTable from './DataTable';

const KIND_TONE = { Google: 'blue', AI: 'violet', 'Our own tools': 'green', 'Open data': 'amber', System: 'gray', Software: 'gray' };

/** Chips for the pages that show a source: each opens that page. */
const PageChips = ({ pages, max = 99 }) => (
  <div className="flex flex-wrap gap-1">
    {pages.slice(0, max).map(p => <Link key={p.path + p.label} to={p.path} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-11.5 hover:bg-indigo-50 hover:text-indigo-700">{p.label}</Link>)}
    {pages.length > max && <span className="text-11.5 text-slate-500 self-center">+ {pages.length - max} more</span>}
  </div>
);

const Status = ({ on }) => (on
  ? <span className="inline-flex items-center gap-1 text-12.5 font-semibold text-emerald-700"><CheckCircle2 size={13} />On</span>
  : <span className="inline-flex items-center gap-1 text-12.5 font-semibold text-slate-500"><CircleOff size={13} />Not set up</span>);

function Page() {
  const data = useApi('/system/data-sources');
  const [view, setView] = useState('source');
  const list = data.data?.sources || [];
  const byPage = useMemo(() => {
    const m = new Map();
    for (const s of list) for (const p of s.pages) { const e = m.get(p.label) || { path: p.path, label: p.label, sources: [] }; e.sources.push(s); m.set(p.label, e); }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [list]);
  const kinds = [...new Set(list.map(s => s.kind))];
  const on = list.filter(s => s.on).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 mr-auto"><h2 className="text-18 font-semibold text-slate-900 flex items-center gap-2"><Database size={18} className="text-indigo-500" />Data sources</h2>
          <p className="text-12 text-slate-500">Where every value in the software comes from, what each source provides, and which pages show it. The "Data source" badges on pages open this list.</p></div>
        {data.data && <div className="flex gap-2">
          <div className="rounded-lg bg-white ring-1 ring-slate-200 px-3.5 py-1.5"><span className="block text-20 leading-tight font-bold tabular-nums text-slate-900">{list.length}</span><span className="block text-11.5 text-slate-500">sources</span></div>
          <div className="rounded-lg bg-white ring-1 ring-slate-200 px-3.5 py-1.5"><span className="block text-20 leading-tight font-bold tabular-nums text-emerald-600">{on}</span><span className="block text-11.5 text-slate-500">switched on</span></div>
          <div className="rounded-lg bg-white ring-1 ring-slate-200 px-3.5 py-1.5"><span className="block text-20 leading-tight font-bold tabular-nums text-slate-900">{byPage.length}</span><span className="block text-11.5 text-slate-500">pages using them</span></div>
        </div>}
      </div>
      <ErrorNote>{data.error?.message}</ErrorNote>
      <Tabs value={view} onChange={setView} tabs={[{ id: 'source', label: 'By source' }, { id: 'page', label: 'By page' }]} />
      {!data.data ? <Card><SkList rows={6} avatar={false} /></Card> : view === 'source' ? (
        <Card pad={false} title={`Sources (${list.length})`} subtitle="Add a new source to the list in the server's data_sources service, so this page stays the one answer.">
          <DataTable bare rows={list} rowKey={s => s.key} pageSize={25} sizes={[10, 25, 50]} exportName="data-sources" label="sources" searchPlaceholder="Search sources, pages or values" minWidth={980} columnsMenu={false} headClass="bg-slate-100 text-slate-700"
            filters={[{ id: 'kind', label: 'Type', options: kinds.map(k => [k, k]), test: (s, v) => s.kind === v }, { id: 'on', label: 'Status', options: [['on', 'On'], ['off', 'Not set up']], test: (s, v) => (v === 'on') === s.on }]}
            columns={[
              { id: 'name', header: 'Source', value: s => s.name, className: 'px-3 py-2.5 min-w-[200px]', cell: s => <div><div className="text-13 font-semibold text-slate-900">{s.name}</div><Badge tone={KIND_TONE[s.kind] || 'gray'}>{s.kind}</Badge></div> },
              { id: 'provides', header: 'What it provides', value: s => s.provides, className: 'px-3 py-2.5 min-w-[280px] max-w-[380px] text-12.5 text-slate-700', cell: s => s.provides },
              { id: 'pages', header: 'Shown on these pages', value: s => s.pages.map(p => p.label).join(', '), className: 'px-3 py-2.5 min-w-[260px] max-w-[420px]', cell: s => <PageChips pages={s.pages} /> },
              { id: 'on', header: 'Status', value: s => (s.on ? 'On' : 'Not set up'), className: 'px-3 py-2.5 whitespace-nowrap', cell: s => <div><Status on={s.on} />{s.note && <div className="text-11.5 text-slate-500">{s.note}</div>}</div> },
              { id: 'how', header: 'How it is connected', value: s => s.how, className: 'px-3 py-2.5 min-w-[200px] max-w-[280px] text-12 text-slate-600', cell: s => s.how },
            ]} />
        </Card>
      ) : (
        <Card pad={false} title={`Pages (${byPage.length})`} subtitle="Each page and the sources its values come from.">
          <DataTable bare rows={byPage} rowKey={p => p.label} pageSize={25} sizes={[10, 25, 50]} exportName="data-sources-by-page" label="pages" searchPlaceholder="Search pages or sources" minWidth={760} columnsMenu={false} headClass="bg-slate-100 text-slate-700"
            columns={[
              { id: 'page', header: 'Page', value: p => p.label, className: 'px-3 py-2.5 min-w-[220px]', cell: p => <Link to={p.path} className="text-13 font-semibold text-indigo-700 hover:underline">{p.label}</Link> },
              { id: 'sources', header: 'Takes its values from', value: p => p.sources.map(s => s.name).join(', '), className: 'px-3 py-2.5', cell: p => <div className="flex flex-wrap gap-1">{p.sources.map(s => <Badge key={s.key} tone={s.on ? (KIND_TONE[s.kind] || 'gray') : 'gray'} title={s.on ? s.provides : 'Not set up'}>{s.name}{s.on ? '' : ' (not set up)'}</Badge>)}</div> },
              { id: 'n', header: 'Sources', right: true, value: p => p.sources.length, className: 'px-3 py-2.5 text-right tabular-nums', cell: p => p.sources.length },
            ]} />
        </Card>
      )}
      <p className="text-11.5 text-slate-500 flex items-center gap-1.5"><Layers size={12} />A key or token is never shown here: only whether the source is switched on.</p>
    </div>
  );
}

export default function DataSourcesPage() {
  return <SeoShell title="Data sources" subtitle="Where every value comes from and which pages show it" needsBusiness={false} hideSwitcher>{() => <Page />}</SeoShell>;
}
