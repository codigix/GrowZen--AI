import React, { useState } from 'react';
import { UserPlus, Shield, UserCheck, Key, UserX, Users as UsersIcon, Mail, Calendar, FolderOpen, Search, Eye, EyeOff, Trash2 } from 'lucide-react';
import { api, useApi, fmtDateTime } from '../platform/seoApi';
import Breadcrumbs from '../platform/Breadcrumbs';
import { Card, Badge, Button, Modal, Field, inputCls, ErrorNote, Empty, useToast } from '../platform/SeoUi';
import Select from '../components/Select';

const ROLES = ['admin', 'manager']; // the two roles offered; accounts made earlier as editor or viewer keep working (an editor shows as Manager)
const LABEL = { admin: 'Admin', manager: 'Manager', viewer: 'Viewer (read-only)' };
const shownRole = (r) => (r === 'admin' ? 'admin' : r === 'viewer' ? 'viewer' : 'manager');
const blank = { name: '', email: '', password: '', role: 'manager' };

export default function UsersPage({ me }) {
  const { data: users, error, reload } = useApi('/users');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [toast, toastNode] = useToast();
  const overview = useApi('/projects-access');
  const [access, setAccess] = useState(null); // { user, projects, picked: Set of project ids, q } while the "Projects" window is open
  const [accessError, setAccessError] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);

  const openAccess = async (u) => {
    setAccessError('');
    setAccess({ user: u, projects: null, picked: new Set(), q: '' });
    try {
      const d = await api(`/users/${u.id}/projects`);
      setAccess({ user: d.user, projects: d.projects, picked: new Set(d.projects.filter(x => x.access === 'shared').map(x => x.id)), q: '' });
    } catch (e) {
      setAccessError(e.message);
    }
  };
  const saveAccess = async () => {
    setAccessBusy(true);
    setAccessError('');
    try {
      await api(`/users/${access.user.id}/projects`, { method: 'PUT', body: { business_ids: [...access.picked] } });
      toast(`${access.user.name} can now open ${access.picked.size} shared project${access.picked.size === 1 ? '' : 's'}`);
      setAccess(null);
      overview.reload(true);
    } catch (e) {
      setAccessError(e.message);
    } finally {
      setAccessBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setFormError('');
    try {
      const made = await api('/users', { method: 'POST', body: form });
      setForm(null);
      reload(true);
      if (made?.role !== 'admin') {
        toast(`Added ${form.name}. Now choose the projects they can open.`);
        openAccess(made); // a new person sees no project until one is ticked here
      } else {
        toast(`Added ${form.name}`);
      }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (u, body, done) => {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      toast(done);
      reload(true);
    } catch (e) {
      toast(e.message);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.name} (${u.email})?

They can no longer sign in and lose access to every shared project. Projects they added stay, and admins can still open them.`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast(`${u.name} was deleted`);
      reload(true);
      overview.reload(true);
    } catch (e) {
      toast(e.message);
    }
  };

  const resetPassword = (u) => {
    const password = window.prompt(`New password for ${u.name} (at least 8 characters)`);
    if (password) patch(u, { password }, `Password changed for ${u.name}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Top Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
              <UsersIcon size={20} />
            </div>
            <div>
              <Breadcrumbs title="Team & Access Control" />
              <h1 className="text-xl font-bold text-slate-900 tracking-tight font-display">Team & Access Control</h1>
              <p className="text-13 text-slate-500 mt-0.5">Manage teammates, administrative roles, and platform permissions</p>
            </div>
          </div>
          <Button variant="primary" icon={UserPlus} onClick={() => { setForm(blank); setFormError(''); setShowPassword(false); }}>
            Add Member
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-5 lg:p-8 animate-in fade-in duration-200">
        <Card pad={false}>
          <ErrorNote>{error?.message}</ErrorNote>
          {users?.length === 0 && <Empty>No registered team members yet.</Empty>}
          {users?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-13 text-left">
                <thead>
                  <tr className="text-11 font-bold   text-slate-500  border-b border-slate-100 bg-slate-50/70">
                    <th className="px-5 py-3.5">User</th>
                    <th className="px-5 py-3.5">Role</th>
                    <th className="px-5 py-3.5">Last Active</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => {
                    const self = String(u.id) === String(me.id);
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded bg-gradient-to-tr from-indigo-500 to-cyan-500 text-white font-bold flex items-center justify-center text-xs shadow-sm">
                              {u.name ? u.name.slice(0, 1).toUpperCase() : 'U'}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                <span>{u.name}</span>
                                {self && (
                                  <span className="text-10 font-bold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">
                                    Current Session
                                  </span>
                                )}
                              </div>
                              <div className="text-12 text-slate-500 flex items-center gap-1 mt-0.5">
                                <Mail size={12} className="text-slate-500" />
                                <span>{u.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <Select
                            value={shownRole(u.role)}
                            disabled={self}
                            onChange={e => patch(u, { role: e.target.value }, `${u.name} is now ${LABEL[e.target.value]}`)}
                            className={`${inputCls} w-44 font-medium disabled:bg-slate-50 disabled:text-slate-500`}
                          >
                            {(u.role === 'viewer' ? [...ROLES, 'viewer'] : ROLES).map(r => (
                              <option key={r} value={r}>{LABEL[r]}</option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          <div className="flex items-center gap-1.5 text-12">
                            <Calendar size={13} className="text-slate-500" />
                            <span>{fmtDateTime(u.last_login_at)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {u.active ? (
                            <Badge tone="green">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" /> Active
                            </Badge>
                          ) : (
                            <Badge tone="gray">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1" /> Disabled
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {u.role !== 'admin' && (
                              <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => openAccess(u)}>
                                Projects
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" icon={Key} onClick={() => resetPassword(u)}>
                              Reset Password
                            </Button>
                            {!self && (
                              <Button
                                size="sm"
                                variant={u.active ? 'danger' : 'secondary'}
                                onClick={() => patch(u, { active: !u.active }, `${u.name} ${u.active ? 'disabled' : 'enabled'}`)}
                              >
                                {u.active ? 'Disable' : 'Enable'}
                              </Button>
                            )}
                            {!self && (
                              <Button size="sm" variant="danger" icon={Trash2} onClick={() => remove(u)}>
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="mt-5" title="Projects and who can open them" subtitle="Every project with the person who added it and the people it was shared with. An admin opens all of them. Use “Projects” on a person to change what they can open.">
          <ErrorNote>{overview.error?.message}</ErrorNote>
          {overview.data?.length === 0 && <Empty>No projects yet.</Empty>}
          {overview.data?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-13 text-left">
                <thead>
                  <tr className="text-11 font-bold text-slate-500 border-b border-slate-100 bg-slate-50/70">
                    <th className="px-4 py-2.5">Project</th>
                    <th className="px-4 py-2.5">Added by</th>
                    <th className="px-4 py-2.5">Shared with</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.data.map(p => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{p.name}</div><div className="text-12 text-slate-500">{p.website || '—'}</div></td>
                      <td className="px-4 py-2.5 text-slate-700">{p.owner}</td>
                      <td className="px-4 py-2.5">{p.shared_with.length ? <div className="flex flex-wrap gap-1">{p.shared_with.map(e => <Badge key={e} tone="blue">{e}</Badge>)}</div> : <span className="text-slate-400">Only the person who added it, and admins</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={Boolean(access)}
        title={access ? `Projects ${access.user.name} can open` : 'Projects'}
        onClose={() => setAccess(null)}
        footer={
          <>
            <Button onClick={() => setAccess(null)}>Cancel</Button>
            <Button variant="primary" busy={accessBusy} disabled={!access?.projects} onClick={saveAccess}>Save access</Button>
          </>
        }
      >
        {access && (
          <div className="space-y-3">
            <p className="text-13 text-slate-600">Tick the projects this person may open, change and delete (a viewer can only look). Projects they added themselves are always theirs. An admin opens every project.</p>
            {!access.projects && !accessError && <div className="text-13 text-slate-500">Loading projects…</div>}
            {access.projects && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]"><Search size={13} className="absolute left-2.5 top-3 text-slate-400" /><input className={`${inputCls} !pl-8`} placeholder="Search projects" value={access.q} onChange={e => setAccess({ ...access, q: e.target.value })} /></div>
                  <Button size="sm" onClick={() => setAccess({ ...access, picked: new Set([...access.picked, ...access.projects.filter(x => !x.locked && `${x.name} ${x.website || ''}`.toLowerCase().includes(access.q.toLowerCase())).map(x => x.id)]) })}>Tick all shown</Button>
                  <Button size="sm" onClick={() => setAccess({ ...access, picked: new Set() })}>Clear</Button>
                </div>
                <div className="text-12 text-slate-500">{access.picked.size} shared project{access.picked.size === 1 ? '' : 's'} ticked</div>
                <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded">
                  {access.projects.filter(x => `${x.name} ${x.website || ''}`.toLowerCase().includes(access.q.toLowerCase())).map(x => {
                    const on = x.locked || access.picked.has(x.id);
                    return (
                      <label key={x.id} className={`flex items-start gap-3 px-3 py-2.5 ${x.locked ? 'bg-slate-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                        <input type="checkbox" className="mt-1" checked={on} disabled={x.locked}
                          onChange={() => { const n = new Set(access.picked); n.has(x.id) ? n.delete(x.id) : n.add(x.id); setAccess({ ...access, picked: n }); }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-13 font-semibold text-slate-900 truncate">{x.name}</span>
                          <span className="block text-12 text-slate-500 truncate">{x.website || 'No website'} · added by {x.owner}</span>
                        </span>
                        {x.access === 'owner' && <Badge tone="green">Added by them</Badge>}
                        {x.access === 'email' && <Badge tone="gray">By email on the project</Badge>}
                      </label>
                    );
                  })}
                  {!access.projects.length && <div className="p-4 text-13 text-slate-500">There are no projects yet.</div>}
                </div>
              </>
            )}
            <ErrorNote>{accessError}</ErrorNote>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(form)}
        title="Add Member"
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={save}>Create Member</Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Full Name">
              <input className={inputCls} placeholder="Jane Doe" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email Address">
              <input type="email" className={inputCls} placeholder="jane@agency.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Temporary Password" hint="At least 8 characters. Not a common or simple one such as 12345678 or password.">
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} className={`${inputCls} !pr-10`} placeholder="Choose a password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field label="Platform Role">
              <Select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                {ROLES.map(r => (
                  <option key={r} value={r}>
                    {LABEL[r]} — {r === 'admin' ? 'Opens every project and manages the team' : 'Opens only the projects given to them and the ones they add'}
                  </option>
                ))}
              </Select>
            </Field>
            <ErrorNote>{formError}</ErrorNote>
          </div>
        )}
      </Modal>
      {toastNode}
    </div>
  );
}
