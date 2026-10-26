import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
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
    <div className="min-h-screen bg-[#F7F8F9]">
      <div className="bg-white border-b border-gray-200 px-5 py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Users</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">Who can sign in to the SEO platform</p>
        </div>
        <Button variant="primary" icon={UserPlus} onClick={() => { setForm(blank); setFormError(''); }}>Add user</Button>
      </div>
      <div className="p-5">
        <Card pad={false}>
          <ErrorNote>{error?.message}</ErrorNote>
          {users?.length === 0 && <Empty>No users yet.</Empty>}
          {users?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-gray-500 border-b border-gray-200">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Last sign-in</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const self = String(u.id) === String(me.id);
                    return (
                      <tr key={u.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="text-gray-900">{u.name}{self && <span className="text-gray-400"> (you)</span>}</div>
                          <div className="text-[12px] text-gray-500">{u.email}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <select value={u.role} disabled={self} onChange={e => patch(u, { role: e.target.value }, `${u.name} is now ${e.target.value}`)} className={`${inputCls} w-28`}>
                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtDateTime(u.last_login_at)}</td>
                        <td className="px-4 py-2.5">{u.active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>Reset password</Button>
                          {!self && <Button size="sm" variant="ghost" onClick={() => patch(u, { active: !u.active }, `${u.name} ${u.active ? 'disabled' : 'enabled'}`)}>{u.active ? 'Disable' : 'Enable'}</Button>}
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

      <Modal open={Boolean(form)} title="Add user" onClose={() => setForm(null)}
        footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Add user</Button></>}>
        {form && (
          <div className="space-y-3">
            <Field label="Name"><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Password" hint="At least 8 characters"><input type="password" className={inputCls} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role">
              <select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
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
