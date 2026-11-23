import React, { useMemo, useState } from 'react';
import { ExternalLink, Plus, Trash2, PenLine, EyeOff, Search as SearchIcon } from 'lucide-react';
import { Card, Badge, Button, Modal, Field, ErrorNote, inputCls, useAction, useDoubleConfirm, SkList } from './SeoUi';
import { Act } from './TableBits';
import DataTable from './DataTable';
import { api, useApi, fmtDateTime } from './seoApi';

const urlOf = (a) => a.wp_url || a.react_url || '';
const where = (a) => ({ wordpress: 'WordPress', react: 'React website', existing: 'Added by you', ghost: 'Ghost', shopify: 'Shopify', github: 'GitHub', webhook: 'Webhook' }[a.publish_method] || (a.react_status === 'publish' ? 'React website' : 'Website'));

/** Every blog that is posted on the website: open it, add one that is already live, take one down from the website, or remove it from the list. */
export default function PostedBlogs({ b, toast, onWrite }) {
  const list = useApi(`/businesses/${b.id}/articles`);
  const [busy, error, run] = useAction();
  const [ask, confirmNode] = useDoubleConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', keyword: '' });
  const [only, setOnly] = useState('live');
  const site = useApi(only === 'site' ? `/businesses/${b.id}/articles/site-blogs` : null); // read only when that list is opened: it reads the website's sitemap
  const [picked, setPicked] = useState([]);
  const all = list.data?.articles || [];
  const live = useMemo(() => all.filter(a => a.wp_status === 'publish' || a.react_status === 'publish'), [all]);
  const removed = useMemo(() => all.filter(a => a.wp_status === 'deleted' || a.react_status === 'deleted'), [all]);
  const drafts = useMemo(() => all.filter(a => a.status === 'completed' && a.wp_status !== 'publish' && a.react_status !== 'publish' && a.wp_status !== 'deleted' && a.react_status !== 'deleted'), [all]);
  const found = site.data?.blogs || [];
  const rows = only === 'live' ? live : only === 'drafts' ? drafts : only === 'removed' ? removed : found;
  const say = toast || (() => {});

  const add = () => run('add', async () => {
    await api(`/businesses/${b.id}/articles/existing`, { method: 'POST', body: { title: form.title.trim(), url: form.url.trim(), keyword: form.keyword.trim() || null } });
    setAdding(false); setForm({ title: '', url: '', keyword: '' }); say('Blog added to the list'); list.reload(true);
  });
  const addPicked = (urls) => run('bulk', async () => {
    const r = await api(`/businesses/${b.id}/articles/existing/bulk`, { method: 'POST', body: { urls }, timeout: 120000 });
    setPicked([]); say(`${r.added} blog${r.added === 1 ? '' : 's'} added to the list`); await list.reload(true); site.reload(true);
  });
  const takeDown = (a) => ask({ what: 'this blog from your website', effect: 'It is deleted from your website, so visitors can no longer read it. The text stays in bevisibe and you can post it again.', onConfirm: () => run(`d${a.id}`, async () => {
    await api(`/businesses/${b.id}/articles/${a.id}/${a.react_status === 'publish' && a.wp_status !== 'publish' ? 'react-post' : 'website-post'}`, { method: 'DELETE' });
    say('Taken down from the website'); list.reload(true);
  }) });
  const remove = (a) => ask({ what: 'this blog from the list', effect: a.wp_status === 'publish' || a.react_status === 'publish' ? 'It is removed from bevisibe only. The post stays live on your website until you take it down.' : 'The saved text and its history are removed from bevisibe.', onConfirm: () => run(`r${a.id}`, async () => {
    await api(`/businesses/${b.id}/articles/${a.id}`, { method: 'DELETE' }); say('Removed from the list'); list.reload(true);
  }) });
  const canTakeDown = (a) => (a.publish_method || 'wordpress') === 'wordpress' && a.wp_status === 'publish' ? true : a.react_status === 'publish';

  return (
    <div className="space-y-3">
      {confirmNode}
      <ErrorNote>{error || list.error?.message}</ErrorNote>
      <Card pad={false} title={`Posted blogs (${live.length})`} subtitle="Every blog that is live on your website. Add one that is already there, or delete one."
        action={<div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="tablist" aria-label="Show">{[['live', `Live ${live.length}`], ['drafts', `Not posted yet ${drafts.length}`], ['site', `Found on my website${site.data ? ` ${found.length}` : ''}`], ['removed', `Removed ${removed.length}`]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={only === k} onClick={() => setOnly(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${only === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>))}</div>
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add a blog already on my site</Button>
          <Button size="sm" variant="primary" icon={PenLine} onClick={onWrite}>Write a new blog</Button>
        </div>}>
        {only === 'site' && (
          <div className="px-5 pb-3">
            {site.error ? <ErrorNote>{site.error.message}</ErrorNote> : !site.data ? <p className="text-13 text-slate-500 flex items-center gap-2"><SearchIcon size={14} />Reading your website's sitemap for blogs…</p> : (
              <div className="flex flex-wrap items-center gap-2"><span className="text-13 text-slate-600">{found.length ? `${found.length} blog${found.length === 1 ? '' : 's'} on your website are not in the list yet. Tick the ones to add.` : 'Every blog the sitemap lists is already in the list.'}</span>
                {found.length > 0 && <><Button size="sm" variant="primary" busy={busy === 'bulk'} disabled={!picked.length} onClick={() => addPicked(picked)}>Add {picked.length || ''} ticked</Button><Button size="sm" busy={busy === 'bulk'} onClick={() => addPicked(found.slice(0, 40).map(x => x.url))}>Add all (up to 40)</Button></>}</div>)}
          </div>)}
        {!list.data ? <div className="px-5 pb-4"><SkList rows={4} avatar={false} /></div> : only === 'site' ? (
          <DataTable bare rows={found} rowKey={x => x.url} pageSize={10} sizes={[10, 25, 50]} exportName="blogs-on-website" label="blogs" searchPlaceholder="Search blogs" minWidth={700} columnsMenu={false} headClass="bg-slate-100 text-slate-700" empty={site.data ? 'Nothing new was found in the sitemap.' : 'Reading the sitemap…'}
            columns={[
              { id: 'pick', header: <span className="sr-only">Select</span>, csv: false, className: 'pl-4 pr-1 py-2 w-8', thClass: 'pl-4 pr-1 py-2.5 w-8', cell: x => <input type="checkbox" checked={picked.includes(x.url)} onChange={e => setPicked(p => (e.target.checked ? [...p, x.url] : p.filter(u => u !== x.url)))} aria-label={`Select ${x.title}`} /> },
              { id: 'title', header: 'Blog (from its address)', value: x => x.title, className: 'px-3 py-2.5 min-w-[260px]', cell: x => <div><div className="text-13 font-semibold text-slate-900">{x.title}</div><a href={x.url} target="_blank" rel="noreferrer noopener" className="block text-11.5 text-indigo-600 hover:underline truncate max-w-[420px]">{x.url.replace(/^https?:\/\/(www\.)?/, '')}</a></div> },
              { id: 'lastmod', header: 'Changed', first: 'desc', value: x => Date.parse(x.lastmod) || null, className: 'px-3 py-2.5 whitespace-nowrap text-12 text-slate-500', cell: x => (x.lastmod ? String(x.lastmod).slice(0, 10) : '—') },
              { id: 'add', header: 'Action', csv: false, right: true, className: 'px-3 py-2.5 text-right', thClass: 'px-3 py-2.5', cell: x => <Act icon={Plus} tone="indigo" busy={busy === 'bulk'} tip="Add this blog to the list." onClick={() => addPicked([x.url])}>Add</Act> },
            ]} />
        ) : (
          <DataTable bare rows={rows} rowKey={a => a.id} pageSize={10} sizes={[10, 25, 50]} exportName="posted-blogs" label="blogs" searchPlaceholder="Search blogs" minWidth={900} columnsMenu={false} headClass="bg-slate-100 text-slate-700"
            empty={only === 'live' ? 'No blog is posted yet. Write one, or press Found on my website to add the ones already there.' : only === 'drafts' ? 'No written blog is waiting to be posted.' : 'Nothing was taken down.'}
            columns={[
              { id: 'title', header: 'Blog', value: a => a.title || a.keyword, className: 'px-3 py-2.5 min-w-[260px] max-w-[420px]', cell: a => (
                <div className="min-w-0"><div className="text-13 font-semibold text-slate-900 truncate" title={a.title || a.keyword}>{a.title || a.keyword}</div>
                  {urlOf(a) && <a href={urlOf(a)} target="_blank" rel="noreferrer noopener" className="block text-11.5 text-indigo-600 hover:underline truncate" title={urlOf(a)}>{urlOf(a).replace(/^https?:\/\/(www\.)?/, '')}</a>}</div>) },
              { id: 'keyword', header: 'Keyword', value: a => a.keyword || '', className: 'px-3 py-2.5 text-12.5 text-slate-700', cell: a => a.keyword || '—' },
              { id: 'where', header: only === 'drafts' ? 'Status' : 'Posted on', value: a => (only === 'drafts' ? (a.publishing_status || 'draft') : where(a)), className: 'px-3 py-2.5 whitespace-nowrap', cell: a => (only === 'drafts' ? <Badge tone="amber">{a.publishing_status === 'scheduled' ? 'Scheduled' : a.publishing_status === 'failed' ? 'Failed' : 'Written, not posted'}</Badge> : <Badge tone={a.publish_method === 'existing' ? 'gray' : 'blue'}>{where(a)}</Badge>) },
              { id: 'words', header: 'Words', right: true, first: 'desc', value: a => (a.body ? a.body.split(/\s+/).length : (a.stats?.words ?? null)), className: 'px-3 py-2.5 text-right tabular-nums text-12.5', cell: a => a.stats?.words ?? '—' },
              { id: 'added', header: 'Added', first: 'desc', value: a => Date.parse(a.created_at) || null, className: 'px-3 py-2.5 whitespace-nowrap text-12 text-slate-500', cell: a => fmtDateTime(a.created_at) },
              { id: 'actions', header: 'Actions', csv: false, right: true, className: 'px-3 py-2.5 text-right whitespace-nowrap', thClass: 'px-3 py-2.5', cell: a => (
                <span className="inline-flex gap-1.5">
                  {urlOf(a) && <a href={urlOf(a)} target="_blank" rel="noreferrer noopener"><Act icon={ExternalLink} tone="sky" tip="Open the blog on your website." /></a>}
                  {only === 'live' && canTakeDown(a) && <Act icon={EyeOff} tone="amber" busy={busy === `d${a.id}`} tip="Take down: delete it from your website. The text stays here." onClick={() => takeDown(a)}>Take down</Act>}
                  <Act icon={Trash2} tone="rose" busy={busy === `r${a.id}`} tip="Delete from the list." onClick={() => remove(a)}>Delete</Act>
                </span>) },
            ]} />
        )}
      </Card>
      <Modal open={adding} title="Add a blog that is already on my site" onClose={() => setAdding(false)} width="max-w-lg"
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" busy={busy === 'add'} disabled={form.title.trim().length < 3 || !/^https?:\/\//i.test(form.url.trim())} onClick={add}>Add to the list</Button></>}>
        <div className="space-y-3">
          <p className="text-13 text-slate-600">Use this for a blog that was posted outside bevisibe. Nothing is changed on your website: it is only listed here.</p>
          <Field label="Blog title"><input className={inputCls} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="How to choose a clinic marketing agency" autoFocus /></Field>
          <Field label="Address of the blog"><input className={inputCls} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://yoursite.com/blog/..." /></Field>
          <Field label="Main keyword (optional)"><input className={inputCls} value={form.keyword} onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))} /></Field>
          <ErrorNote>{error}</ErrorNote>
        </div>
      </Modal>
    </div>
  );
}
