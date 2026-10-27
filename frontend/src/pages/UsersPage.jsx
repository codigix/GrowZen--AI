import React, { useState } from 'react';
import { UserPlus, Shield, UserCheck, Key, UserX, Users as UsersIcon, Mail, Calendar } from 'lucide-react';
import { api, useApi, fmtDateTime } from '../platform/seoApi';
import { Card, Badge, Button, Modal, Field, inputCls, ErrorNote, Empty, useToast } from '../platform/SeoUi';

const ROLES = ['admin', 'editor', 'viewer'];
const blank = { name: '', email: '', password: '', role: 'editor' };

export default function UsersPage({ me }) {
  const { data: users, error, reload } = useApi('/users');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, toastNode] = useToast();

  const save = async () => {
    setBusy(true);
    setFormError('');
    try {
      await api('/users', { method: 'POST', body: form });
      setForm(null);
      toast(`Added ${form.name}`);
      reload(true);
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

  const resetPassword = (u) => {
    const password = window.prompt(`New password for ${u.name} (at least 8 characters)`);
    if (password) patch(u, { password }, `Password changed for ${u.name}`);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800">
      {/* Top Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
              <UsersIcon size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight font-display">Team & Access Control</h1>
              <p className="text-[13px] text-slate-500 mt-0.5">Manage teammates, administrative roles, and platform permissions</p>
            </div>
          </div>
          <Button variant="primary" icon={UserPlus} onClick={() => { setForm(blank); setFormError(''); }}>
            Invite Team Member
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
              <table className="w-full text-[13px] text-left">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono border-b border-slate-100 bg-slate-50/70">
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
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 text-white font-bold flex items-center justify-center text-xs shadow-sm">
                              {u.name ? u.name.slice(0, 1).toUpperCase() : 'U'}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                <span>{u.name}</span>
                                {self && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">
                                    Current Session
                                  </span>
                                )}
                              </div>
                              <div className="text-[12px] text-slate-500 flex items-center gap-1 mt-0.5">
                                <Mail size={12} className="text-slate-400" />
                                <span>{u.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <select
                            value={u.role}
                            disabled={self}
                            onChange={e => patch(u, { role: e.target.value }, `${u.name} is now ${e.target.value}`)}
                            className={`${inputCls} w-32 font-medium capitalize disabled:bg-slate-50 disabled:text-slate-500`}
                          >
                            {ROLES.map(r => (
                              <option key={r} value={r}>
                                {r.charAt(0).toUpperCase() + r.slice(1)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          <div className="flex items-center gap-1.5 text-[12px]">
                            <Calendar size={13} className="text-slate-400" />
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
      </div>

      <Modal
        open={Boolean(form)}
        title="Invite Team Member"
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
            <Field label="Temporary Password" hint="Must be at least 8 characters long">
              <input type="password" className={inputCls} placeholder="••••••••••••" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Platform Role">
              <select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                {ROLES.map(r => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)} — {r === 'admin' ? 'Full administrative access' : r === 'editor' ? 'Manage audits, campaigns, posts' : 'Read-only reporting'}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorNote>{formError}</ErrorNote>
          </div>
        )}
      </Modal>
      {toastNode}
    </div>
  );
}
