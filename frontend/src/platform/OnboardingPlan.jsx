import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target, Star, MapPin, FileText, CheckCircle2, Circle, Bot, User, Briefcase, Copy, Download, Check, ArrowRight, Flag } from 'lucide-react';
import { profileGaps, decisions, outsideFixes } from './OnboardingAssistant';
import { countryInfo } from './countries';

/**
 * The plan of action for a business being onboarded: 90-day goals and four phases of concrete steps, built
 * from what onboarding knows (the details, what is missing or disagrees, fixes for the website and Google
 * profile, its Google rating / reviews / photos, services, keywords and area) and from what the chosen plan
 * automates. Steps already satisfied are ticked; each step says who does it and links to where it is done.
 */

const JOB_LABELS = { full_audit: 'Full SEO audit', rank_scan: 'Rank tracking', technical: 'Technical SEO check', reviews: 'Review replies', posts: 'Google posts', report: 'Monthly report', geo: 'AI search visibility' };
const EVERY = { daily: 'daily', weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly' };
const OWNER = {
  you: { label: 'You', icon: User, cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  client: { label: 'Client', icon: Briefcase, cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  ai: { label: 'AI agent', icon: Bot, cls: 'bg-violet-50 text-violet-700 ring-violet-200' }
};

/** Listing sites worth being on, by kind of business (Indian market). */
function listingSites(category) {
  const c = String(category || '').toLowerCase();
  if (/doctor|dent|clinic|hospital|derma|physio|health|medical|eye|skin|ortho|pediatr|gyn/.test(c)) return ['Practo', 'Justdial', 'Lybrate', 'Apollo 24|7'];
  if (/restaurant|cafe|bakery|food|bar|hotel|caterer|sweet/.test(c)) return ['Zomato', 'Swiggy', 'Justdial', 'Tripadvisor'];
  if (/salon|spa|beauty|gym|fitness|yoga/.test(c)) return ['Justdial', 'Urban Company', 'Sulekha', 'Magicpin'];
  if (/real estate|property|builder|interior|architect/.test(c)) return ['MagicBricks', '99acres', 'Housing.com', 'Justdial'];
  if (/school|coaching|tuition|academy|institute|college/.test(c)) return ['Justdial', 'Sulekha', 'Shiksha', 'UrbanPro'];
  if (/software|it |agency|marketing|digital|consult/.test(c)) return ['Clutch', 'GoodFirms', 'Justdial', 'LinkedIn'];
  if (/manufactur|supplier|wholesale|exporter|industr/.test(c)) return ['IndiaMART', 'TradeIndia', 'Justdial', 'ExportersIndia'];
  return ['Justdial', 'Sulekha', 'IndiaMART', 'Facebook'];
}

/** The goals and phases (pure, so the plan can also be copied as text). */
export function buildPlan({ form, res, source, planName, jobs }) {
  const has = (j) => Boolean(jobs[j]);
  const where = (form.area || form.city || '').split(',')[0].trim();
  const cat = form.primary_category.trim() || 'business';
  const reviews = Number(source?.review_count) || 0;
  const rating = source?.rating != null ? Number(source.rating) : null;
  // Google returns photos only on some API plans: 0 means "not known", not "none".
  const photos = Number(source?.photo_count ?? source?.photos) || 0;
  const reviewTarget = reviews + Math.max(15, Math.round(reviews * 0.15));
  const gaps = profileGaps(form, res).filter(g => !g.done);
  const choose = decisions(res);
  const outside = outsideFixes(form, res);
  const keywords = form.keywords.length ? form.keywords : [where ? `${cat.toLowerCase()} in ${where.toLowerCase()}` : cat.toLowerCase(), `${cat.toLowerCase()} near me`];
  const services = form.services.slice(0, 6);
  // India's sites depend on the kind of business; elsewhere the country's own listing sites come first.
  const listings = (form.country || 'IN') === 'IN' ? listingSites(cat) : countryInfo(form.country).sites.slice(0, 4);
  const questions = (res?.suggestions?.keywords?.values || []).filter(k => /^(how|what|which|why|is|can|does|best|cost|price)/i.test(k)).slice(0, 3);

  const goals = [
    { icon: CheckCircle2, label: 'Profile', value: '100% complete', sub: `now ${Math.round(((profileGaps(form, res).length - gaps.length) / profileGaps(form, res).length) * 100)}%, matching on Google and the website` },
    { icon: Star, label: 'Reviews', value: `${reviewTarget}+`, sub: reviews ? `from ${reviews}${rating ? ` (${rating.toFixed(1)}★)` : ''}, every one replied to` : 'first 15 reviews, every one replied to' },
    { icon: MapPin, label: 'Google Maps', value: `Top 3 for ${Math.min(keywords.length, 3)} keyword${Math.min(keywords.length, 3) === 1 ? '' : 's'}`, sub: keywords.slice(0, 2).join(', ') },
    { icon: FileText, label: 'Website', value: `${Math.max(services.length, 3)} service pages`, sub: where ? `each naming ${where}` : 'one per service' }
  ];

  const phases = [
    {
      title: 'Week 1: Foundation', why: 'Correct, complete and consistent details everywhere. Google trusts businesses whose name, address and phone match.',
      steps: [
        { text: gaps.length ? `Fill in the missing details: ${gaps.map(g => g.label.replace(/ \(.*\)/, '')).join(', ')}` : 'Profile details complete', owner: 'you', done: !gaps.length },
        ...(choose.length ? [{ text: `Decide the correct ${choose.map(c => c.label.toLowerCase()).join(', ')} (Google and the website disagree), then correct the other place`, owner: 'you', done: false }] : []),
        ...outside.map(o => ({ text: o.title, owner: 'client', detail: o.where === 'google' ? 'On the Google Business Profile' : 'On the website (or ask the web developer)', done: false, to: o.where === 'google' ? '/gmb-profile' : '/website-audit' })),
        { text: res?.maps?.matched ? 'Get owner access to the Google Business Profile and connect it here, so posts, replies and edits can be published' : 'Create or claim the Google Business Profile, then connect it here', owner: 'client', done: false, to: '/gmb-profile' },
        { text: 'Baseline audit of all six areas (profile, rankings, technical, on-page, backlinks, citations)', owner: 'ai', detail: 'Runs automatically at launch', done: false }
      ]
    },
    {
      title: 'Weeks 2-4: Google profile & website', why: 'A full profile and a page for each service give Google something to rank for each search.',
      steps: [
        { text: photos >= 10 ? `Keep adding a few new photos each month (has ${photos}+)` : `Add photos: at least 10 of the outside, inside, team and work${photos ? ` (has ${photos})` : ''}`, owner: 'client', done: false, to: '/media-management' },
        { text: source?.hours?.length ? 'Confirm opening hours, and set holiday hours' : 'Add opening hours on the Google profile', owner: 'client', done: false },
        { text: `Add every service to the Google profile${services.length ? `: ${services.join(', ')}` : ''}`, owner: 'you', done: false, to: '/gmb-profile' },
        { text: has('posts') ? `Google posts ${EVERY[jobs.posts] || jobs.posts} (offers, updates, tips)` : 'Publish a Google post every week (offers, updates, tips)', owner: has('posts') ? 'ai' : 'you', detail: has('posts') ? 'Drafted by the AI agent; you approve' : null, done: false, to: '/google-posts' },
        ...(services.length
          ? services.map(sv => ({ text: `Website page: "${sv}${where ? ` in ${where}` : ''}"`, owner: 'you', detail: 'Service and area in the title, heading and first paragraph; photos, price range, FAQs', done: false, to: '/website-builder' }))
          : [{ text: 'Website: one page per service, each naming the area', owner: 'you', done: false, to: '/website-builder' }]),
        { text: 'Fix the page titles, descriptions and headings found by the audit', owner: 'ai', detail: 'Drafted as low-risk fixes you can approve in bulk', done: false, to: '/automation' }
      ]
    },
    {
      title: 'Month 2: Reviews & listings', why: 'Reviews and consistent listings are the strongest Google Maps signals after relevance.',
      steps: [
        { text: `Ask every happy customer for a review: about ${Math.max(5, Math.ceil((reviewTarget - reviews) / 3))} a month`, owner: 'client', detail: source?.review_url ? 'Share the direct review link by WhatsApp or SMS after each visit' : 'Share the profile\'s review link after each visit', done: false, to: '/reviews' },
        { text: has('reviews') ? `Reply to every review (${EVERY[jobs.reviews] || jobs.reviews})` : 'Reply to every review within 48 hours', owner: has('reviews') ? 'ai' : 'you', detail: has('reviews') ? 'Replies drafted in the owner\'s tone; low ratings wait for your approval' : null, done: false, to: '/reviews' },
        { text: `List the business on ${listings.join(', ')}`, owner: 'you', detail: 'Same name, address and phone as Google, letter for letter', done: false, to: '/off-page-seo' },
        { text: 'Clean up old listings with a wrong phone or address', owner: 'you', done: false, to: '/off-page-seo' }
      ]
    },
    {
      title: 'Month 3 and ongoing: Content & growth', why: 'Answering what people ask and watching competitors keeps rankings growing.',
      steps: [
        { text: `Track rankings for: ${keywords.slice(0, 5).join(', ')}`, owner: has('rank_scan') ? 'ai' : 'you', detail: has('rank_scan') ? `Geo-grid scans ${EVERY[jobs.rank_scan] || jobs.rank_scan}` : null, done: false, to: '/rank-tracking' },
        { text: questions.length ? `Answer what people ask in posts and FAQs: ${questions.join('; ')}` : 'Two helpful articles a month answering customers\' questions', owner: 'ai', detail: 'Written from the business\'s real facts; you approve', done: false, to: '/ai-content-generation' },
        { text: 'Research the competitors that outrank the business and close the gaps', owner: 'you', done: false, to: '/competitor-finder' },
        ...(has('geo') ? [{ text: `Check how AI assistants describe the business (${EVERY[jobs.geo] || jobs.geo})`, owner: 'ai', done: false, to: '/geo-optimization' }] : []),
        { text: has('report') ? `Monthly report emailed to ${form.contact_email || 'the client'}` : 'Send the client a monthly results report', owner: has('report') ? 'ai' : 'you', done: false, to: '/reports' }
      ]
    }
  ];
  return { goals, phases, planName, keywords };
}

/** The plan as plain text, for copying into an email or a document. */
function asText(form, plan) {
  const lines = [`Plan of action: ${form.name || 'New business'}${form.primary_category ? ` (${form.primary_category}${form.city ? `, ${form.city}` : ''})` : ''}`, `Plan: ${plan.planName}`, '', '90-day goals'];
  plan.goals.forEach(g => lines.push(`- ${g.label}: ${g.value} (${g.sub})`));
  plan.phases.forEach(p => {
    lines.push('', p.title, p.why);
    p.steps.forEach(st => lines.push(`[${st.done ? 'x' : ' '}] ${st.text} (${OWNER[st.owner].label})${st.detail ? ` - ${st.detail}` : ''}`));
  });
  return lines.join('\n');
}

export default function ActionPlan({ form, res, source, planName, jobs }) {
  const plan = useMemo(() => buildPlan({ form, res, source, planName, jobs: Object.fromEntries(jobs) }), [form, res, source, planName, jobs]);
  const [copied, setCopied] = useState(false);
  const total = plan.phases.reduce((n, p) => n + p.steps.length, 0);
  const done = plan.phases.reduce((n, p) => n + p.steps.filter(s => s.done).length, 0);
  const auto = plan.phases.reduce((n, p) => n + p.steps.filter(s => s.owner === 'ai').length, 0);
  const copy = async () => {
    const text = asText(form, plan);
    try { await navigator.clipboard.writeText(text); } catch (e) {
      // Clipboard API blocked (http page, browser setting): the older copy command still works.
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([asText(form, plan)], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${(form.name || 'business').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-plan-of-action.txt` });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded ring-1 ring-inset ring-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <Flag size={15} className="text-indigo-600" />
        <div className="min-w-0">
          <div className="text-14 font-bold text-slate-900">Plan of action</div>
          <div className="text-11.5 text-slate-500">{total} steps over 90 days · {auto} run by the AI agents on {planName} · {done} already done</div>
        </div>
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={copy} className="h-8 px-2.5 rounded-lg text-12 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1.5 cursor-pointer">{copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={download} className="h-8 px-2.5 rounded-lg text-12 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1.5 cursor-pointer"><Download size={13} /> Download</button>
        </div>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {plan.goals.map(g => (
          <div key={g.label} className="rounded bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2 min-w-0">
            <div className="flex items-center gap-1.5 text-10.5 font-bold uppercase tracking-wide text-slate-500"><g.icon size={11} /> {g.label}</div>
            <div className="text-14 font-bold text-slate-900 truncate" title={g.value}>{g.value}</div>
            <div className="text-11 text-slate-500 truncate" title={g.sub}>{g.sub}</div>
          </div>
        ))}
      </div>

      <ol className="px-4 pb-4 space-y-4">
        {plan.phases.map((p, i) => {
          const left = p.steps.filter(s => !s.done).length;
          return (
            <li key={p.title} className="relative pl-8">
              <span className={`absolute left-0 top-0 w-6 h-6 rounded-full text-12 font-bold flex items-center justify-center ${left ? 'bg-indigo-600 text-white' : 'bg-emerald-500 text-white'}`}>{left ? i + 1 : <Check size={13} />}</span>
              {i < plan.phases.length - 1 && <span className="absolute left-3 top-7 bottom-[-14px] w-px bg-slate-200" aria-hidden />}
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h4 className="text-13.5 font-bold text-slate-900">{p.title}</h4>
                <span className="text-11.5 text-slate-500">{left ? `${left} to do` : 'done'}</span>
              </div>
              <p className="text-11.5 text-slate-500 leading-snug">{p.why}</p>
              <ul className="mt-2 space-y-1">
                {p.steps.map(st => {
                  const o = OWNER[st.owner];
                  return (
                    <li key={st.text} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                      {st.done ? <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" /> : <Circle size={15} className="text-slate-300 mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className={`text-12.5 leading-snug ${st.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{st.text}</div>
                        {st.detail && <div className="text-11 text-slate-500 leading-snug">{st.detail}</div>}
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1 text-10.5 font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset ${o.cls}`}><o.icon size={10} />{o.label}</span>
                      {st.to && !st.done && <Link to={st.to} title="Open in the app (after launch)" className="shrink-0 text-slate-400 hover:text-indigo-700 mt-0.5"><ArrowRight size={14} /></Link>}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
      <div className="px-4 py-2.5 border-t border-slate-100 text-11 text-slate-500 flex items-center gap-1.5"><Target size={12} /> Built from this business's details, Google listing and website. It updates as you complete the form; the AI agents' steps start after launch.</div>
    </div>
  );
}
