import React, { useState } from 'react';
import { Plug, CheckCircle2, ShieldCheck, Loader2, Mail } from 'lucide-react';
import { SeoShell, Card, Tabs, StatusPill, Badge, useToast } from './SeoUi';
import { useApi, fmtDateTime, SEO_API } from './seoApi';
import { PLANS } from './seoMock';

// What each backend setting switches on (names match seo-platform/backend/.env).
const SOURCES = [
  ['ai', 'AI (extraction, replies, posts, reports)', 'DEEPSEEK_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY + AI_PROVIDER', s => s.ai.configured, s => s.ai.provider],
  ['google_oauth', 'Google sign-in for Business Profiles', 'GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Business Profile API approved)', s => s.google_oauth],
  ['pagespeed', 'PageSpeed Insights (technical SEO)', 'PAGESPEED_API_KEY', s => s.pagespeed_key],
  ['dataforseo', 'DataForSEO (live rank grids, keyword volume, backlinks)', 'DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD', s => s.dataforseo],
  ['imap', 'Onboarding mailbox (IMAP)', 'INTAKE_IMAP_HOST / USER / PASSWORD', s => s.intake_imap],
  ['webhook', 'Onboarding webhook (mail-forwarding services)', 'INTAKE_WEBHOOK_TOKEN', s => s.intake_webhook],
  ['smtp', 'Email out (reports, “missing details” replies)', 'SMTP_HOST + SMTP_FROM', s => s.smtp],
  ['geo', 'AI engines for the GEO tracker', 'OPENAI / GEMINI / PERPLEXITY / ANTHROPIC / DEEPSEEK keys', s => s.geo_engines.length > 0, s => s.geo_engines.join(', ')],
  ['scheduler', 'Background scheduler (automatic jobs)', 'SCHEDULER_ENABLED=true (one instance only)', s => s.scheduler]
];

function Connections() {
  const [tab, setTab] = useState('connections');
  const status = useApi('/status');
  const conns = useApi('/connections');
  const [, toastNode] = useToast();
  const s = status.data;
  return (
    <>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'connections', label: 'Data sources' }, { id: 'google', label: 'Google accounts' }, { id: 'plans', label: 'Plans' }, { id: 'rules', label: 'Safety rules' }]} />

      {tab === 'connections' && (
        <Card title="What the SEO backend is connected to" subtitle={`Set in seo-platform/backend/.env · API ${SEO_API}`}>
          {!s ? (status.error ? <div className="text-[13px] text-red-700">{status.error.message}</div> : <Loader2 size={16} className="animate-spin text-gray-400" />) : (
            <div className="divide-y divide-gray-100">
              {SOURCES.map(([id, name, env, on, extra]) => (
                <div key={id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-8 h-8 rounded bg-gray-100 text-gray-600 flex items-center justify-center"><Plug size={14} /></span>
                  <div className="flex-1 min-w-[260px]"><div className="text-[13px] font-medium text-gray-900">{name}</div><div className="text-[11px] text-gray-500 font-mono">{env}</div></div>
                  {extra && on(s) && <Badge tone="gray">{extra(s)}</Badge>}
                  {on(s) ? <StatusPill level="good">Connected</StatusPill> : <StatusPill level="warning">Not set up</StatusPill>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[12px] text-gray-500 mt-3">Anything not set up runs on sample data (labelled “sample data”) or stays off, so the pipeline still works end to end.</p>
        </Card>
      )}

      {tab === 'google' && (
        <Card title="Connected Google accounts" subtitle="Add or sync them from GBP Manager">
          {!conns.data ? <Loader2 size={16} className="animate-spin text-gray-400" /> : conns.data.length === 0 ? <div className="py-6 text-[13px] text-gray-500">None yet.</div> : (
            <div className="divide-y divide-gray-100">
              {conns.data.map(c => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
                  <Mail size={14} className="text-gray-400" />
                  <span className="flex-1 text-gray-900">{c.email} <span className="text-gray-500 text-[12px]">· {c.businesses} businesses · synced {c.last_sync_at ? fmtDateTime(c.last_sync_at) : 'never'}</span></span>
                  {c.status === 'active' ? <StatusPill level="good">Active</StatusPill> : <Badge>{c.status}</Badge>}
                  {c.last_error && <span className="text-[12px] text-red-600 max-w-[320px] truncate" title={c.last_error}>{c.last_error}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PLANS.map(p => (
            <div key={p.name} className={`bg-white rounded border p-4 ${p.popular ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'}`}>
              <div className="text-[15px] font-semibold text-gray-900">{p.name}</div>
              <div className="text-[12px] text-gray-500 mt-0.5">{p.who}</div>
              <div className="text-xl font-semibold text-gray-900 mt-3">{p.price}<span className="text-[12px] font-normal text-gray-500">{p.name === 'Agency' ? '' : ' / month'}</span></div>
              <ul className="mt-3 space-y-1.5">{p.includes.map(i => <li key={i} className="flex gap-1.5 text-[12px] text-gray-700"><CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-px" />{i}</li>)}</ul>
            </div>
          ))}
          <p className="md:col-span-2 xl:col-span-4 text-[12px] text-gray-500">Each client's plan (set on onboarding) decides which automatic jobs run; edit the job table in Automation Pipeline → AI playbook.</p>
        </div>
      )}

      {tab === 'rules' && (
        <Card title="Safety rules built into the product" subtitle="Enforced by the backend, not just written down">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['Approval before anything goes live', 'Posts, replies and profile changes are agent tasks; only approved tasks reach Google, unless autopilot is on for that kind.'],
              ['Profile edits always ask', 'Name, category and address changes need a person, whatever the autopilot settings.'],
              ['No invented facts', 'AI prompts use only the saved profile; the email extractor keeps only values found in the email.'],
              ['No fake or incentivised reviews', 'AI only drafts replies; review requests go to every customer.'],
              ['Outreach drafts only', 'A person sends every outreach email. No paid links or link exchanges.'],
              ['Licensed data only', 'Rankings come from a licensed provider (DataForSEO), never scraping Google.'],
              ['Encrypted tokens', 'Google refresh tokens are stored encrypted; disconnecting deletes them.'],
              ['Allowed senders only', 'The onboarding mailbox processes emails from the team’s addresses only.']
            ].map(([t, d]) => <div key={t} className="p-3 rounded border border-gray-200"><div className="flex items-center gap-1.5 text-[13px] font-medium text-gray-900"><ShieldCheck size={14} className="text-emerald-600" />{t}</div><p className="text-[12px] text-gray-600 mt-1">{d}</p></div>)}
          </div>
        </Card>
      )}
      {toastNode}
    </>
  );
}

export default function ConnectionsPage() {
  return (
    <SeoShell title="Connections & plans" subtitle="What the SEO backend is connected to, Google accounts, plans and safety rules" hideSwitcher needsBusiness={false}>
      <Connections />
    </SeoShell>
  );
}
