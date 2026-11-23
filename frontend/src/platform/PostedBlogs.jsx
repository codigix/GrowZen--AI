import React, { useMemo, useState } from 'react';
import { ExternalLink, Plus, Trash2, PenLine, EyeOff } from 'lucide-react';
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
  const all = list.data?.articles || [];
  const live = useMemo(() => all.filter(a => a.wp_status === 'publish' || a.react_status === 'publish'), [all]);
  const removed = useMemo(() => all.filter(a => a.wp_status === 'deleted' || a.react_status === 'deleted'), [all]);
  const rows = only === 'live' ? live : removed;
  const say = toast || (() => {});

  const add = () => run('add', async () => {
    await api(`/businesses/${b.id}/articles/existing`, { method: 'POST', body: { title: form.title.trim(), url: form.url.trim(), keyword: form.keyword.trim() || null } });
    setAdding(false); setForm({ title: '', url: '', keyword: '' }); say('Blog added to the list'); list.reload(true);
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
          <div className="flex gap-1" role="tablist" aria-label="Show">{[['live', `Live ${live.length}`], ['removed', `Removed ${removed.length}`]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={only === k} onClick={() => setOnly(k)} className={`h-8 px-3 rounded-full text-12.5 font-semibold cursor-pointer ${only === k ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>))}</div>
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add a blog already on my site</Button>
          <Button size="sm" variant="primary" icon={PenLine} onClick={onWrite}>Write a new blog</Button>
        </div>}>
        {!list.data ? <div className="px-5 pb-4"><SkList rows={4} avatar={false} /></div> : (
          <DataTable bare rows={rows} rowKey={a => a.id} pageSize={10} sizes={[10, 25, 50]} exportName="posted-blogs" label="blogs" searchPlaceholder="Search blogs" minWidth={900} columnsMenu={false} headClass="bg-slate-100 text-slate-700"
            empty={only === 'live' ? 'No blog is posted yet. Write one, or add one that is already on your site.' : 'Nothing was taken down.'}
            columns={[
              { id: 'title', header: 'Blog', value: a => a.title || a.keyword, className: 'px-3 py-2.5 min-w-[260px] max-w-[420px]', cell: a => (
                <div className="min-w-0"><div className="text-13 font-semibold text-slate-900 truncate" title={a.title || a.keyword}>{a.title || a.keyword}</div>
                  {urlOf(a) && <a href={urlOf(a)} target="_blank" rel="noreferrer noopener" className="block text-11.5 text-indigo-600 hover:underline truncate" title={urlOf(a)}>{urlOf(a).replace(/^https?:\/\/(www\.)?/, '')}</a>}</div>) },
              { id: 'keyword', header: 'Keyword', value: a => a.keyword || '', className: 'px-3 py-2.5 text-12.5 text-slate-700', cell: a => a.keyword || '—' },
              { id: 'where', header: 'Posted on', value: where, className: 'px-3 py-2.5 whitespace-nowrap', cell: a => <Badge tone={a.publish_method === 'existing' ? 'gray' : 'blue'}>{where(a)}</Badge> },
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
