// Browser check of the page addresses (old and new): each opens the right page, shows the right content, highlights the right sidebar entry
// and does not overflow the screen, on a desktop and a phone width. Needs a running app and Google Chrome.
//
//   node scripts/check-addresses.mjs http://127.0.0.1:8010 [businessId]
//
// The app must accept the session (for example the test wrapper that signs in as the admin). Exit code 1 when any address fails.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8010').replace(/\/$/, '');
const BID = process.argv[3] || '3';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env.SHOTS || ''; // a folder: also save a screenshot of every page

// [address, final path (+ query), text the page must show, sidebar entry that must be active (or null)]
const CASES = [
  ['/keyword-management', '/keyword-management/ai', 'AI suggestions', 'Find Keywords'],
  ['/keyword-management/ai', '/keyword-management/ai', 'Suggest keywords', 'Find Keywords'],
  ['/keyword-management/use', '/keyword-management/use', 'Where to use them', 'My Keywords'],
  ['/keyword-management?tab=discover', '/keyword-management/discover', 'Ideas for my business', 'Find Keywords'],
  ['/keyword-management?tab=topics', '/keyword-management/topics', 'Group tracked keywords into topics', 'My Keywords'],
  ['/keyword-management/discover', '/keyword-management/discover', 'Ideas for my business', 'Find Keywords'],
  ['/keyword-management/planner', '/keyword-management/planner', 'Google numbers', 'Find Keywords'],
  ['/keyword-management/explorer', '/keyword-management/explorer', 'Other platforms', 'Find Keywords'],
  ['/keyword-management/tracked', '/keyword-management/tracked', 'Tracked keywords and their pages', 'My Keywords'],
  ['/keyword-management/topics', '/keyword-management/topics', 'Group tracked keywords into topics', 'My Keywords'],
  ['/keyword-overview', '/keyword-overview', 'Google Keyword Planner', 'Check One Keyword'],
  ['/serp-xray', '/keyword-overview', 'Google Keyword Planner', 'Check One Keyword'],
  ['/compare-domains', '/competitor-finder?tab=compare', 'Side by side', 'Competitors'],
  ['/keyword-gap', '/competitor-finder?tab=gap', 'Keyword gap', 'Competitors'],
  ['/page-xray', '/website-audit?tab=xray', 'Page X-Ray report', 'Website Audit & X-Ray'],
  ['/gmb-profile/reviews', '/reviews?tab=google', 'Replies on Google', 'Reviews & Reputation'],
  ['/organic-rankings', '/organic-rankings/overview', 'My search performance', 'My Search Performance'],
  ['/top-pages', '/top-pages', 'My search performance', 'My Search Performance']
];
const VIEWPORTS = [['desktop', 1440, 1000, false], ['phone', 390, 900, true]];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = path.join(os.tmpdir(), `check-addresses-${port}`);
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ws; let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const failures = [];

try {
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(300); } }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let errs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 200));
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('seoBusinessId','${BID}');localStorage.setItem('seo:user',JSON.stringify({id:'1',name:'Admin',email:'a@example.com',role:'admin',is_admin:true}));` });

  const probe = `(() => {
    const w = innerWidth, bad = [];
    document.querySelectorAll('body *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > w + 1 && !e.closest('[role=tablist],.overflow-x-auto,.overflow-auto,nav')) bad.push(e.tagName + '.' + String(e.className).slice(0, 40)); });
    const active = [...document.querySelectorAll('a[aria-current=page]')].filter(a => !a.closest('nav[aria-label="My search performance"],nav[aria-label="Keyword steps"]')).map(a => a.textContent.trim());
    return JSON.stringify({ path: location.pathname + location.search, text: document.body.innerText, active, docW: document.documentElement.scrollWidth, vw: w, bad: bad.slice(0, 5) });
  })()`;

  for (const [vname, width, height, mobile] of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    for (const [addr, wantPath, wantText, wantActive] of CASES) {
      errs = [];
      await send('Page.navigate', { url: BASE + addr });
      let got = null;
      for (let i = 0; i < 40; i++) { // wait until the page shows its text (or give up after ~16 s)
        await sleep(400);
        got = JSON.parse((await send('Runtime.evaluate', { returnByValue: true, expression: probe })).result.value);
        if (got.path === wantPath && got.text.toLowerCase().includes(wantText.toLowerCase())) break;
      }
      await sleep(800); // let the sidebar settle on the new address before reading which entry is active
      got = JSON.parse((await send('Runtime.evaluate', { returnByValue: true, expression: probe })).result.value);
      const why = [];
      if (got.path !== wantPath) why.push(`opened ${got.path}, expected ${wantPath}`);
      if (!got.text.toLowerCase().includes(wantText.toLowerCase())) why.push(`text "${wantText}" not shown`);
      if (vname === 'desktop' && wantActive && !got.active.includes(wantActive)) why.push(`sidebar active is [${got.active.join(', ')}], expected "${wantActive}"`);
      if (got.docW > got.vw + 1) why.push(`page is ${got.docW}px wide on a ${got.vw}px screen`);
      if (errs.length) why.push(`script error: ${errs[0]}`);
      if (SHOTS) { const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `${vname}-${addr.replace(/[^a-z0-9]+/gi, '_')}.png`), Buffer.from(shot.data, 'base64')); }
      console.log(`${why.length ? 'FAIL' : 'ok  '} [${vname}] ${addr}${why.length ? '  ->  ' + why.join('; ') : ''}`);
      if (why.length) failures.push(`${vname} ${addr}`);
    }
  }
} finally { try { ws?.close(); } catch { /* done */ } proc.kill(); }
console.log(failures.length ? `\n${failures.length} failed` : '\nAll addresses behave.');
process.exit(failures.length ? 1 : 0);
