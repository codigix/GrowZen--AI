import React, { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { Button } from './SeoUi';
import { api } from './seoApi';
import Wizard, { Row, fieldCls, boxCls } from './Wizard';

const STEPS = [
  { id: 'general', label: 'General' },
  { id: 'crawler', label: 'Crawler', hint: 'optional' },
  { id: 'rules', label: 'Allow/disallow rules', hint: 'optional' },
  { id: 'params', label: 'URL parameter rules', hint: 'optional' }
];
const DEFAULTS = { limit: 100, pages_to_crawl: 'website', subdomains: true, user_agent: 'desktop', allow: [], disallow: [], ignore_params: [], schedule: 'off', email: false };
const WHICH = { website: 'Internally linked pages, starting from the homepage.', sitemap: 'Only the pages listed in the sitemap; links on them are not followed.', subfolder: 'Only the pages inside the folder in the address, starting from it.' };
const lines = (t) => t.split('\n').map(x => x.trim()).filter(Boolean);

/**
 * "New audit": asked whenever a website is audited. The scope, how many pages, which pages, how often and whether to email; then optional crawler
 * choices and the rules that decide which addresses are crawled. For the project's own site the choices are saved and used by its scheduled audits.
 */
export default function NewAuditModal({ open, onClose, target, host, business, own, strategy, setStrategy, busy, onStart }) {
  const [step, setStep] = useState('general');
  const [cfg, setCfg] = useState(DEFAULTS);
  const [text, setText] = useState({ allow: '', disallow: '', ignore_params: '' });
  const [visited, setVisited] = useState(() => new Set(['general']));

  useEffect(() => {
    if (!open) return;
    setStep('general');
    setVisited(new Set(['general']));
    const fill = (c) => { setCfg({ ...DEFAULTS, ...c }); setText({ allow: (c.allow || []).join('\n'), disallow: (c.disallow || []).join('\n'), ignore_params: (c.ignore_params || []).join('\n') }); };
    if (own && business?.id) api(`/businesses/${business.id}/audit-config`).then(fill).catch(() => fill(DEFAULTS));
    else fill(DEFAULTS);
  }, [open, own, business?.id]);

  const go = (id) => { setStep(id); setVisited(v => new Set(v).add(id)); };
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const start = () => onStart({ ...cfg, allow: lines(text.allow), disallow: lines(text.disallow), ignore_params: lines(text.ignore_params) });
  const idx = STEPS.findIndex(s => s.id === step);

  return (
    <Wizard open={open} onClose={onClose} title="New audit" steps={STEPS} step={step} onStep={go} done={STEPS.slice(1).map(s => s.id).filter(id => visited.has(id) && id !== step)}
      heading={{ general: 'General settings', crawler: 'Crawler settings', rules: 'Allow/disallow rules', params: 'URL parameter rules' }[step]}
      footer={<div className="flex items-center gap-3">
        {idx > 0 && <Button onClick={() => go(STEPS[idx - 1].id)}>Back</Button>}
        {idx < STEPS.length - 1 && <Button onClick={() => go(STEPS[idx + 1].id)}>Next</Button>}
        <button type="button" onClick={start} disabled={busy} className="h-12 px-8 rounded-lg text-16 font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer">{busy ? 'Starting…' : 'Start audit'}</button>
      </div>}>
      {step === 'general' && (
        <div className="divide-y divide-transparent">
          <Row label="Scope">
            <div className="rounded-lg bg-slate-50 px-4 py-3 flex flex-wrap items-center gap-2 text-15"><Globe size={15} className="text-slate-400" /><b className="text-slate-900">{host}</b><span className="text-slate-400">•</span>
              <label className="inline-flex items-center gap-2 text-slate-600 cursor-pointer"><input type="checkbox" checked={cfg.subdomains} onChange={e => set('subdomains', e.target.checked)} />including all subdomains</label></div>
          </Row>
          <Row label="Limit per audit"><span className="inline-flex items-center gap-3"><input type="number" min={10} max={300} value={cfg.limit} onChange={e => set('limit', Math.max(10, Math.min(300, Number(e.target.value) || 10)))} className={`${fieldCls} w-28`} aria-label="Pages per audit" /><span className="text-15 text-slate-700">pages</span></span></Row>
          <Row label="Pages to crawl" hint={WHICH[cfg.pages_to_crawl]}>
            <select className={`${fieldCls} w-48`} value={cfg.pages_to_crawl} onChange={e => set('pages_to_crawl', e.target.value)} aria-label="Pages to crawl"><option value="website">Website</option><option value="sitemap">Sitemap</option><option value="subfolder">Subfolder</option></select>
          </Row>
          <Row label="Schedule" hint={own ? null : "Repeating audits are for this project's own website."}>
            <select className={`${fieldCls} w-64`} value={own ? cfg.schedule : 'off'} disabled={!own} onChange={e => set('schedule', e.target.value)} aria-label="Schedule"><option value="off">Do not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
            <label className={`mt-3 flex items-center gap-2.5 text-15 ${own ? 'text-slate-800 cursor-pointer' : 'text-slate-400'}`}><input type="checkbox" disabled={!own} checked={own && cfg.email} onChange={e => set('email', e.target.checked)} />Send an email once an audit is complete</label>
          </Row>
        </div>
      )}
      {step === 'crawler' && (
        <div>
          <Row label="Crawl as" hint="The crawler identifies itself as a phone or a computer, which can show different pages on sites that adapt to the device.">
            <div className="inline-flex rounded border border-slate-300 overflow-hidden">{[['desktop', 'Desktop'], ['mobile', 'Mobile']].map(([id, l]) => <button key={id} type="button" onClick={() => set('user_agent', id)} className={`h-10 px-5 text-14 border-r last:border-r-0 border-slate-300 cursor-pointer ${cfg.user_agent === id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>
          </Row>
          <Row label="Speed test device" hint="The device Google Lighthouse measures the homepage on.">
            <div className="inline-flex rounded border border-slate-300 overflow-hidden">{[['mobile', 'Mobile'], ['desktop', 'Desktop']].map(([id, l]) => <button key={id} type="button" onClick={() => setStrategy(id)} className={`h-10 px-5 text-14 border-r last:border-r-0 border-slate-300 cursor-pointer ${strategy === id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>)}</div>
          </Row>
          <p className="text-14 text-slate-500 mt-3">The crawler always follows robots.txt. Pages behind a login can't be audited.</p>
        </div>
      )}
      {step === 'rules' && (
        <div>
          <p className="text-14 text-slate-600">One rule per line. Text matches anywhere in the address; <code className="bg-slate-100 px-1 rounded">*</code> stands for any characters. The homepage is always crawled.</p>
          <Row label="Crawl only these" hint="Leave empty to crawl everything that is not disallowed. Example: /blog/*"><textarea className={boxCls} rows={5} value={text.allow} onChange={e => setText(t => ({ ...t, allow: e.target.value }))} placeholder={'/blog/*\n/services/'} aria-label="Allowed addresses" /></Row>
          <Row label="Never crawl these" hint="Example: /wp-admin or ?add-to-cart"><textarea className={boxCls} rows={5} value={text.disallow} onChange={e => setText(t => ({ ...t, disallow: e.target.value }))} placeholder={'/wp-admin\n/cart'} aria-label="Disallowed addresses" /></Row>
        </div>
      )}
      {step === 'params' && (
        <div>
          <p className="text-14 text-slate-600">Query parameters that do not change what a page shows (tracking tags, session ids). They are removed from addresses, so <code className="bg-slate-100 px-1 rounded">/page?utm_source=x</code> and <code className="bg-slate-100 px-1 rounded">/page</code> count as one page.</p>
          <Row label="Ignore these parameters" hint="One parameter name per line."><textarea className={boxCls} rows={7} value={text.ignore_params} onChange={e => setText(t => ({ ...t, ignore_params: e.target.value }))} placeholder={'utm_source\nutm_medium\ngclid\nfbclid'} aria-label="Ignored parameters" /></Row>
          <Button size="sm" onClick={() => setText(t => ({ ...t, ignore_params: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'sessionid'].join('\n') }))}>Use the common tracking parameters</Button>
        </div>
      )}
    </Wizard>
  );
}
