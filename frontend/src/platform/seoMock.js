/**
 * Demo data for the SEO platform screens (frontend only, no backend). Three Pune businesses,
 * with every number generated from a fixed seed so the screens look the same on every load.
 * Swap these functions for API calls when the real services exist.
 */

export const BUSINESSES = [
  {
    id: 'physio',
    name: 'Shree Physio & Rehab Clinic',
    primaryCategory: 'Physiotherapist',
    secondaryCategories: ['Sports medicine clinic', 'Rehabilitation center'],
    area: 'Kothrud', city: 'Pune',
    address: 'Shop 4, Karve Road, Kothrud, Pune 411038',
    phone: '+91 98220 41234', website: 'https://shreephysio.in',
    lat: 18.5074, lng: 73.8077,
    description: 'Physiotherapy clinic in Kothrud, Pune for back pain, neck pain, sports injuries and post-surgery rehab. Our physiotherapists build a treatment plan for each patient with manual therapy, exercise and electrotherapy.',
    services: [
      { name: 'Back pain treatment', price: '₹600 / session', description: 'Assessment, manual therapy and a home exercise plan.' },
      { name: 'Sports injury rehab', price: '₹800 / session', description: 'Ligament, muscle and joint injuries.' },
      { name: 'Post-surgery rehab', price: '₹700 / session', description: 'Knee and hip replacement, ACL reconstruction.' },
      { name: 'Neck & shoulder pain', price: '₹600 / session', description: '' },
      { name: 'Home visit physiotherapy', price: '₹1,200 / visit', description: '' }
    ],
    attributes: ['Wheelchair accessible', 'Online appointments', 'Women-led'],
    tone: 'Warm, reassuring, professional',
    rating: 4.6, reviewCount: 142, verification: 'verified', duplicate: false,
    competitors: ['Kothrud Physio Centre', 'ActiveLife Physiotherapy', 'Rehab Plus Clinic', 'PhysioFirst Karve Nagar', 'Motion Physio Studio'],
    seeds: ['physiotherapist', 'back pain treatment', 'sports injury', 'physiotherapy clinic']
  },
  {
    id: 'salon',
    name: 'Glow Studio Unisex Salon',
    primaryCategory: 'Beauty salon',
    secondaryCategories: ['Hair salon', 'Bridal makeup artist'],
    area: 'Baner', city: 'Pune',
    address: '2nd floor, Balewadi High Street, Baner, Pune 411045',
    phone: '+91 97300 88120', website: 'https://glowstudiopune.com',
    lat: 18.5590, lng: 73.7868,
    description: 'Unisex salon in Baner offering haircuts, colour, keratin, facials and bridal makeup.',
    services: [
      { name: 'Haircut & styling', price: 'from ₹499', description: '' },
      { name: 'Hair colour', price: 'from ₹1,800', description: 'Global, highlights and balayage.' },
      { name: 'Keratin treatment', price: 'from ₹3,500', description: '' },
      { name: 'Bridal makeup', price: 'from ₹15,000', description: 'HD and airbrush makeup with trial.' }
    ],
    attributes: ['Online appointments'],
    tone: 'Friendly, upbeat',
    rating: 4.3, reviewCount: 61, verification: 'verified', duplicate: true,
    competitors: ['Looks Salon Baner', 'Enrich Salon Balewadi', 'Bblunt Baner', 'Jean-Claude Biguine', 'Naturals Baner'],
    seeds: ['salon in baner', 'bridal makeup', 'hair colour', 'keratin treatment']
  },
  {
    id: 'gym',
    name: 'IronCore Fitness',
    primaryCategory: 'Gym',
    secondaryCategories: [],
    area: 'Wakad', city: 'Pune',
    address: '',
    phone: '+91 90110 55667', website: '',
    lat: null, lng: null,
    description: 'Best gym Wakad',
    services: [{ name: 'Personal training', price: '', description: '' }, { name: 'CrossFit classes', price: '', description: '' }],
    attributes: [],
    tone: 'Energetic, motivating',
    rating: 4.1, reviewCount: 18, verification: 'unverified', duplicate: false,
    competitors: ['Gold\'s Gym Wakad', 'Anytime Fitness Wakad', 'Cult Wakad', 'Fitness Planet Hinjewadi', 'Talwalkars Wakad'],
    seeds: ['gym in wakad', 'personal trainer', 'crossfit', 'gym near me']
  }
];

export const getBusiness = (id) => BUSINESSES.find(b => b.id === id) || BUSINESSES[0];

// Small seeded random generator so demo numbers are stable.
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rng = (seed) => {
  let a = hash(seed) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, a, b) => Math.floor(a + r() * (b - a + 1));

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const daysBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
export const shortDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

// ── GBP profile score (relevance, distance, prominence) ──────────────────────
// Computed from the profile so editing it on the GBP page moves the score live.
export const profileAudit = (b, extra = {}) => {
  const reviews = extra.reviewCount ?? b.reviewCount;
  const rating = extra.rating ?? b.rating;
  const replyRate = extra.replyRate ?? (b.id === 'physio' ? 0.82 : b.id === 'salon' ? 0.55 : 0.2);
  const photos = extra.photos ?? (b.id === 'physio' ? 24 : b.id === 'salon' ? 9 : 3);
  const posts30 = extra.posts30 ?? (b.id === 'physio' ? 5 : b.id === 'salon' ? 2 : 0);
  const desc = String(b.description || '');
  const services = (b.services || []).filter(s => s.name);
  const stuffed = /[|]|\s-\s|best|cheap|no\.?\s?1|top\s/i.test(b.name) || b.name.length > 60;
  const items = [
    { key: 'primary', factor: 'relevance', weight: 12, score: b.primaryCategory ? 1 : 0, label: 'Primary category set', fix: 'Pick the primary category the top competitors for your main keyword use. It is the strongest single lever.' },
    { key: 'secondary', factor: 'relevance', weight: 3, score: b.secondaryCategories.length ? 1 : 0, label: 'Secondary categories added', fix: 'Add 2-4 secondary categories that match services you offer.' },
    { key: 'description', factor: 'relevance', weight: 5, score: desc.length >= 250 && !/https?:|www\./.test(desc) ? 1 : desc.length >= 100 ? 0.5 : 0, label: `Description, 250-750 characters (${desc.length} now)`, fix: 'Write 600-750 characters: what you do, for whom, where. No links or promotions.' },
    { key: 'services', factor: 'relevance', weight: 5, score: Math.min(1, services.length / 5), label: `Services listed (${services.length} of 5+)`, fix: 'List every service with a one-line description.' },
    { key: 'prices', factor: 'relevance', weight: 2, score: services.some(s => s.price) ? 1 : 0, label: 'Service prices shown', fix: 'Add a price or "from" price to the main services.' },
    { key: 'attributes', factor: 'relevance', weight: 2, score: b.attributes.length >= 3 ? 1 : b.attributes.length / 3, label: `Attributes (${b.attributes.length} of 3+)`, fix: 'Set attributes like wheelchair access or online appointments.' },
    { key: 'website', factor: 'relevance', weight: 5, score: b.website ? 1 : 0, label: 'Website / landing page linked', fix: 'Link the page that matches the primary category, not only the home page.' },
    { key: 'name', factor: 'relevance', weight: 3, score: stuffed ? 0 : 1, label: 'Real business name (no keywords)', fix: 'Use the signage name only. Keyword-stuffed names are a common cause of suspension.' },
    { key: 'address', factor: 'distance', weight: 5, score: b.address ? 1 : 0, label: 'Address or service area set', fix: 'Add the exact address, or a service area if customers are served at their place.' },
    { key: 'pin', factor: 'distance', weight: 4, score: b.lat != null ? 1 : 0, label: 'Map pin placed', fix: 'Set the exact map pin. The rank grid needs it too.' },
    { key: 'phone', factor: 'distance', weight: 3, score: b.phone ? 1 : 0, label: 'Local phone number', fix: 'Use a local number that matches the website and directories.' },
    { key: 'reviews', factor: 'prominence', weight: 10, score: Math.min(1, reviews / 50), label: `Reviews (${reviews} of 50+)`, fix: 'Ask every customer for a review by WhatsApp or QR. Never only the happy ones.' },
    { key: 'rating', factor: 'prominence', weight: 8, score: Math.max(0, Math.min(1, (rating - 3.5) / 1)), label: `Average rating (${rating.toFixed(1)} of 4.5+)`, fix: 'Reply to unhappy reviews quickly and fix the cause.' },
    { key: 'replies', factor: 'prominence', weight: 7, score: Math.min(1, replyRate / 0.9), label: `Reply rate (${Math.round(replyRate * 100)}% of 90%+)`, fix: 'Reply to every review within 24 hours. Approve the AI drafts.' },
    { key: 'photos', factor: 'prominence', weight: 5, score: Math.min(1, photos / 10), label: `Photos (${photos} of 10+)`, fix: 'Upload real photos weekly: outside, inside, team, work.' },
    { key: 'posts', factor: 'prominence', weight: 5, score: Math.min(1, posts30 / 4), label: `Posts in the last 30 days (${posts30} of 4+)`, fix: 'Publish one or two Updates or Offers every week.' }
  ].map(i => ({ ...i, ok: i.score >= 0.999 }));
  const factor = (f) => {
    const l = items.filter(i => i.factor === f);
    const max = l.reduce((s, i) => s + i.weight, 0);
    return Math.round((l.reduce((s, i) => s + i.weight * i.score, 0) / max) * 100);
  };
  const total = items.reduce((s, i) => s + i.weight, 0);
  const score = Math.round((items.reduce((s, i) => s + i.weight * i.score, 0) / total) * 100);
  const alerts = [];
  if (b.verification === 'unverified') alerts.push({ level: 'critical', text: 'Profile not verified: it will not show in the Map Pack until verified.' });
  if (b.verification === 'suspended') alerts.push({ level: 'critical', text: 'Profile suspended. Request reinstatement before anything else.' });
  if (b.duplicate) alerts.push({ level: 'warning', text: 'Duplicate listing found ("Glow Studio Salon Baner"). Duplicates split reviews and ranking; request a merge.' });
  if (stuffed) alerts.push({ level: 'warning', text: 'The business name looks keyword-stuffed, a common cause of suspension.' });
  return {
    score, items, alerts,
    factors: { relevance: factor('relevance'), distance: factor('distance'), prominence: factor('prominence') },
    topFixes: items.filter(i => !i.ok).sort((a, c) => (c.weight * (1 - c.score)) - (a.weight * (1 - a.score))).slice(0, 3)
  };
};

// Categories the top 10 competitors use, for the category recommender.
export const competitorCategories = (b) => {
  const r = rng(`${b.id}-cats`);
  const options = {
    physio: ['Physiotherapist', 'Physiotherapy center', 'Sports medicine clinic', 'Rehabilitation center', 'Medical clinic'],
    salon: ['Beauty salon', 'Hair salon', 'Unisex salon', 'Bridal makeup artist', 'Day spa'],
    gym: ['Gym', 'Fitness center', 'Personal trainer', 'CrossFit gym', 'Health club']
  }[b.id];
  const names = [...b.competitors, ...['Prime', 'City', 'Elite', 'Care', 'One'].map(x => `${x} ${b.primaryCategory}`)].slice(0, 10);
  return names.map((n, i) => ({
    rank: i + 1, name: n,
    primary: i < 6 ? options[0] : pick(r, options.slice(0, 3)),
    secondary: options.slice(1).filter(() => r() > 0.45).slice(0, 3),
    reviews: int(r, 40, 900), rating: Math.round((3.9 + r() * 1) * 10) / 10
  }));
};

// ── reviews ──────────────────────────────────────────────────────────────────
const REVIEW_TEXT = {
  physio: [
    [5, 'Dr. Meera explained my back problem clearly and the exercises really helped. Pain gone in 3 weeks.', ['staff', 'results']],
    [5, 'Very good clinic for sports injury. My knee is much better after ACL rehab here.', ['results']],
    [4, 'Good treatment but waiting time on Saturday was around 30 minutes.', ['waiting time', 'results']],
    [2, 'Appointment was rescheduled twice without informing me. Treatment itself was okay.', ['appointments']],
    [5, 'Clean clinic, friendly staff and reasonable charges.', ['cleanliness', 'staff', 'price']],
    [1, 'Felt rushed during the session, only 15 minutes of actual therapy.', ['session time']],
    [5, 'Home visit service for my mother after knee replacement was excellent.', ['home visit', 'staff']],
    [4, 'Helpful physiotherapists. Parking is difficult on Karve Road.', ['parking', 'staff']]
  ],
  salon: [
    [5, 'Loved my balayage! Priya understood exactly what I wanted.', ['staff', 'results']],
    [3, 'Haircut was fine but they were running 40 minutes late.', ['waiting time']],
    [5, 'Bridal makeup was flawless and lasted all day. Highly recommend.', ['results', 'bridal']],
    [2, 'Keratin treatment was costly and hair went frizzy in 2 weeks.', ['price', 'results']],
    [4, 'Good ambience and hygiene. Slightly expensive.', ['cleanliness', 'price']],
    [5, 'Best salon in Baner for men\'s haircut. Quick and neat.', ['staff']]
  ],
  gym: [
    [5, 'Great trainers and good equipment. Crowded in the evenings.', ['trainers', 'crowd']],
    [3, 'Decent gym but AC does not work properly.', ['facilities']],
    [1, 'Membership cancellation was a nightmare, they kept the money.', ['billing']],
    [4, 'CrossFit classes are fun and the coach is motivating.', ['trainers']]
  ]
};
const NAMES = ['Rohan Kulkarni', 'Sneha Patil', 'Amit Deshpande', 'Priyanka Joshi', 'Vikram Shinde', 'Neha Gokhale', 'Sagar More', 'Anjali Bhosale', 'Kiran Jadhav', 'Pooja Pawar', 'Rahul Kale', 'Shruti Apte'];

export const getReviews = (b) => {
  const r = rng(`${b.id}-reviews`);
  const base = REVIEW_TEXT[b.id];
  return Array.from({ length: Math.min(18, Math.max(base.length, 10)) }, (_, i) => {
    const [rating, body, topics] = base[i % base.length];
    const replied = r() < (b.id === 'physio' ? 0.75 : b.id === 'salon' ? 0.45 : 0.15) && i > 2;
    return {
      id: `${b.id}-r${i}`,
      author: NAMES[(i + int(r, 0, 5)) % NAMES.length],
      rating, body, topics,
      date: ymd(daysBack(i * int(r, 1, 4))),
      sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
      replyStatus: replied ? 'posted' : 'none',
      reply: replied ? 'Thank you for your kind words! We are glad we could help. — Team' : ''
    };
  });
};

// Simulated AI reply (what the real LLM call would return).
export const draftReply = (b, review, language = 'English') => {
  const first = (review.author || 'there').split(' ')[0];
  const topic = review.topics?.[0] || 'your visit';
  if (language === 'Hindi') {
    return review.rating >= 4
      ? `${first} जी, आपके सुंदर रिव्यू के लिए धन्यवाद! ${topic === 'staff' ? 'हमारी टीम' : 'हमें'} यह जानकर बहुत खुशी हुई। जल्द ही फिर मिलेंगे। – ${b.name}`
      : `${first} जी, आपके अनुभव के लिए हमें खेद है। कृपया ${b.phone} पर हमसे संपर्क करें ताकि हम इसे ठीक कर सकें। – ${b.name}`;
  }
  if (language === 'Marathi') {
    return review.rating >= 4
      ? `${first}, तुमच्या छान अभिप्रायाबद्दल मनःपूर्वक धन्यवाद! तुम्हाला आमची सेवा आवडली याचा आनंद आहे. पुन्हा भेटूया. – ${b.name}`
      : `${first}, तुम्हाला आलेल्या अनुभवाबद्दल आम्ही दिलगीर आहोत. कृपया ${b.phone} वर संपर्क साधा, आम्ही नक्की मदत करू. – ${b.name}`;
  }
  return review.rating >= 4
    ? `Thank you so much, ${first}! We're really happy to hear about ${topic === 'results' ? 'your progress' : `the ${topic}`}. It means a lot to the whole team at ${b.name}. See you again soon!`
    : review.rating === 3
      ? `Thanks for the honest feedback, ${first}. We're sorry about the ${topic}, and we're working on it. We'd love to make your next visit better. — ${b.name}`
      : `Hi ${first}, we're sorry your experience fell short, especially around the ${topic}. That's not the standard we aim for. Please call us on ${b.phone} so we can put it right. — ${b.name}`;
};

// ── keywords ─────────────────────────────────────────────────────────────────
const MODS = ['near me', 'in {area}', 'in {city}', '{area} {city}', 'best', 'cost', 'clinic', 'price'];
const QUESTIONS = ['how much does {s} cost in {city}', 'what is the best {s} near me', 'is {s} covered by insurance', 'how long does {s} take', 'which {s} is best in {area}'];
const intentOf = (k) => (/near me| in |nearby/.test(k) ? 'Local' : /cost|price|book|hire/.test(k) ? 'Transactional' : /best|top|vs|review/.test(k) ? 'Commercial' : /how|what|why|is |which/.test(k) ? 'Informational' : 'Commercial');

export const keywordIdeas = (b, seed) => {
  const s = String(seed || b.seeds[0]).toLowerCase().trim();
  const r = rng(`${b.id}-${s}`);
  const fill = (t) => t.replace('{s}', s).replace('{area}', b.area.toLowerCase()).replace('{city}', b.city.toLowerCase());
  const list = [s, ...MODS.map(m => (m.includes('{') ? `${s} ${fill(m)}` : m === 'best' ? `best ${s}` : `${s} ${m}`)), ...b.seeds.filter(x => x !== s).map(x => `${x} ${b.area.toLowerCase()}`)];
  const ideas = [...new Set(list)].map((k, i) => ({
    keyword: k,
    volume: Math.round((i === 0 ? int(r, 1500, 6000) : int(r, 40, 1900)) / 10) * 10,
    difficulty: int(r, 8, 72),
    cpc: Math.round((5 + r() * 60) * 10) / 10,
    intent: intentOf(k),
    trend: Array.from({ length: 12 }, () => int(r, 30, 100)),
    cluster: k.includes('cost') || k.includes('price') ? 'Pricing' : k.includes('near me') || k.includes(b.area.toLowerCase()) || k.includes(b.city.toLowerCase()) ? 'Local' : 'Core service'
  }));
  const questions = QUESTIONS.map((q, i) => ({ keyword: fill(q), volume: Math.round(int(r, 20, 480) / 10) * 10, difficulty: int(r, 5, 40), cpc: Math.round(r() * 30 * 10) / 10, intent: 'Informational', trend: Array.from({ length: 12 }, () => int(r, 30, 100)), cluster: 'Questions' }));
  return { ideas, questions };
};

export const trackedKeywords = (b) => {
  const r = rng(`${b.id}-tracked`);
  const { ideas, questions } = keywordIdeas(b, b.seeds[0]);
  const pages = ['/', '/services', ...b.services.map(s => `/services/${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), `/${b.area.toLowerCase()}`];
  return [...ideas.slice(0, 9), ...questions.slice(0, 3)].map((k, i) => ({
    ...k, id: `${b.id}-k${i}`,
    rank: r() < 0.15 ? null : int(r, 1, 38),
    prevRank: int(r, 1, 45),
    page: r() < 0.7 ? pick(r, pages) : '',
    priority: pick(r, ['High', 'Medium', 'Medium', 'Low'])
  }));
};

// ── local rank grid ──────────────────────────────────────────────────────────
// Rank at each grid point: best near the pin, worse with distance, plus noise.
export const rankGrid = (b, keyword, size = 7, competitorBias = 0) => {
  const r = rng(`${b.id}-${keyword}-${size}-${competitorBias}`);
  const strength = b.id === 'physio' ? 1 : b.id === 'salon' ? 1.7 : 2.6;
  const mid = (size - 1) / 2;
  return Array.from({ length: size * size }, (_, i) => {
    const x = i % size; const y = Math.floor(i / size);
    const d = Math.hypot(x - mid, y - mid) / (mid || 1);
    const rank = Math.round(1 + d * d * 9 * strength + r() * 3 * strength + competitorBias);
    return { x, y, rank: rank > 20 ? null : Math.max(1, rank) };
  });
};

export const rankHistory = (b) => {
  const r = rng(`${b.id}-rankhist`);
  let v = b.id === 'physio' ? 7.5 : b.id === 'salon' ? 11 : 16;
  return Array.from({ length: 12 }, (_, i) => { v = Math.max(1.5, v - r() * 0.9 + 0.25); return { week: shortDate(daysBack((11 - i) * 7)), avgRank: Math.round(v * 10) / 10 }; });
};

// Google core updates, overlaid on charts.
export const CORE_UPDATES = [
  { date: ymd(daysBack(58)), name: 'August 2026 core update' },
  { date: ymd(daysBack(19)), name: 'October 2026 spam update' }
];

// ── insights and leads ───────────────────────────────────────────────────────
export const insightsSeries = (b, days = 30) => {
  const r = rng(`${b.id}-insights-${days}`);
  const k = b.id === 'physio' ? 1 : b.id === 'salon' ? 0.75 : 0.4;
  return Array.from({ length: days }, (_, i) => {
    const d = daysBack(days - 1 - i);
    const wk = d.getDay() === 0 ? 0.5 : 1;
    return {
      date: shortDate(d),
      calls: Math.round((6 + r() * 7) * k * wk),
      directions: Math.round((9 + r() * 10) * k * wk),
      clicks: Math.round((12 + r() * 12) * k * wk),
      views: Math.round((220 + r() * 140) * k * wk)
    };
  });
};

export const getLeads = (b) => {
  const r = rng(`${b.id}-leads`);
  const types = ['Call', 'Call', 'WhatsApp', 'Form', 'Direction', 'Booking'];
  const msgs = ['Asked about weekend appointment', 'Price enquiry', 'Wants home visit', 'Booked first session', 'Asked for location', 'Insurance question', 'Follow-up call'];
  return Array.from({ length: 24 }, (_, i) => ({
    id: `${b.id}-l${i}`, type: pick(r, types), name: NAMES[int(r, 0, NAMES.length - 1)],
    contact: `+91 9${int(r, 100000000, 999999999)}`, message: pick(r, msgs),
    date: ymd(daysBack(int(r, 0, 40))), status: pick(r, ['New', 'New', 'Contacted', 'Won', 'Won', 'Lost']),
    source: pick(r, ['Google Business Profile', 'Website', 'Google Ads', 'WhatsApp'])
  })).sort((a, c) => c.date.localeCompare(a.date));
};

// ── site audit ───────────────────────────────────────────────────────────────
export const getAudit = (b) => {
  const r = rng(`${b.id}-audit`);
  const domain = (b.website || `https://${b.id}.example.in`).replace(/^https?:\/\//, '');
  const issues = [
    { id: 1, area: 'Crawlability', severity: 'critical', title: 'Broken internal links (4xx)', count: int(r, 2, 9), how: 'Update or redirect the links. Suggested 301 targets are listed per URL.' },
    { id: 2, area: 'Indexing', severity: 'critical', title: 'Pages with noindex that should rank', count: int(r, 1, 3), how: 'Remove the noindex tag from service pages and re-submit in Search Console.' },
    { id: 3, area: 'Speed & Core Web Vitals', severity: 'serious', title: 'LCP above 2.5 s on mobile', count: int(r, 3, 12), how: 'Compress the hero image (WebP), preload it and defer non-critical scripts.' },
    { id: 4, area: 'Structured data', severity: 'serious', title: 'Missing LocalBusiness schema', count: 1, how: 'Add the generated JSON-LD (Schema tab) to the home and contact pages.' },
    { id: 5, area: 'On-page', severity: 'warning', title: 'Title tags too long (> 60 characters)', count: int(r, 4, 14), how: 'Shorten titles; keep the keyword near the start.' },
    { id: 6, area: 'On-page', severity: 'warning', title: 'Missing meta descriptions', count: int(r, 2, 10), how: 'Write 150-160 character descriptions that earn the click.' },
    { id: 7, area: 'Architecture', severity: 'warning', title: 'Orphan pages (no internal links)', count: int(r, 1, 6), how: 'Link to them from related service pages.' },
    { id: 8, area: 'Mobile', severity: 'warning', title: 'Tap targets too close together', count: int(r, 1, 5), how: 'Increase button spacing to at least 8 px.' },
    { id: 9, area: 'Security', severity: 'serious', title: 'Mixed content (HTTP images on HTTPS)', count: int(r, 0, 4), how: 'Serve every image over HTTPS.' },
    { id: 10, area: 'Local', severity: 'warning', title: 'NAP on contact page differs from GBP', count: 1, how: 'Match name, address and phone exactly to the Business Profile.' },
    { id: 11, area: 'Images', severity: 'info', title: 'Images without alt text', count: int(r, 6, 30), how: 'Add descriptive alt text and geo-relevant filenames.' }
  ].filter(i => i.count > 0);
  const pages = ['/', '/about', '/services', ...b.services.slice(0, 4).map(s => `/services/${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`), '/contact', '/blog'].map(p => ({
    url: p, title: int(r, 30, 78), meta: r() < 0.3 ? 0 : int(r, 90, 175), h1: r() < 0.15 ? 0 : r() < 0.1 ? 2 : 1,
    words: int(r, 120, 1600), status: r() < 0.08 ? 404 : 200, lcp: Math.round((1.4 + r() * 2.6) * 10) / 10
  }));
  return {
    domain, crawled: pages.length + int(r, 20, 60),
    score: b.id === 'physio' ? 78 : b.id === 'salon' ? 64 : 41,
    cwv: { lcp: Math.round((1.8 + r() * 2) * 10) / 10, inp: int(r, 120, 380), cls: Math.round(r() * 0.25 * 100) / 100 },
    issues, pages
  };
};

// ── backlinks & citations ────────────────────────────────────────────────────
export const DIRECTORIES = ['Google Business Profile', 'Justdial', 'Sulekha', 'IndiaMART', 'Practo', 'Zomato', 'Yellow Pages India', 'Bing Places', 'Apple Business Connect', 'Facebook', 'Instagram', 'LinkedIn'];
export const getCitations = (b) => {
  const r = rng(`${b.id}-cit`);
  return DIRECTORIES.filter(d => !(d === 'Practo' && b.id !== 'physio') && !(d === 'Zomato')).map(d => {
    const roll = d === 'Google Business Profile' ? 1 : r();
    const status = roll > 0.55 ? 'listed' : roll > 0.3 ? 'inconsistent' : 'missing';
    return {
      name: d, status,
      found: status === 'missing' ? null : {
        name: status === 'inconsistent' && r() < 0.5 ? `${b.name.split(' ')[0]} ${b.primaryCategory}` : b.name,
        phone: status === 'inconsistent' && r() < 0.6 ? '+91 20 2543 1100' : b.phone,
        address: status === 'inconsistent' ? (b.address || '').replace(/\d{6}/, '411004') : b.address
      }
    };
  });
};

export const getBacklinks = (b) => {
  const r = rng(`${b.id}-bl`);
  const domains = ['punemirror.in', 'justdial.com', 'practo.com', 'healthline-india.org', 'medium.com', 'quora.com', 'punebloggers.in', 'lbb.in/pune', 'whatshot.in', 'reddit.com', 'cheap-links-seo.xyz', 'top10dir.biz'];
  const links = domains.map((d, i) => ({
    domain: d, authority: d.endsWith('.xyz') || d.endsWith('.biz') ? int(r, 2, 9) : int(r, 18, 78),
    anchor: pick(r, [b.name, b.primaryCategory.toLowerCase(), `${b.primaryCategory.toLowerCase()} in ${b.area.toLowerCase()}`, 'click here', b.website || 'website']),
    firstSeen: ymd(daysBack(int(r, 1, 200))), status: i < 2 ? 'new' : i === 5 ? 'lost' : 'live',
    toxic: d.endsWith('.xyz') || d.endsWith('.biz')
  }));
  const growth = Array.from({ length: 12 }, (_, i) => ({ month: new Date(new Date().getFullYear(), new Date().getMonth() - 11 + i, 1).toLocaleDateString('en-GB', { month: 'short' }), domains: 18 + i * int(r, 1, 3) + int(r, 0, 2) }));
  const gap = ['punetimesonline.com', 'healthsite.in', 'indiatoday.in/lifestyle', 'magicpin.in', 'nearbuy.com', 'yourstory.com'].map(d => ({ domain: d, authority: int(r, 25, 85), competitors: int(r, 2, 4), type: pick(r, ['Directory', 'News', 'Blog', 'Listicle']) }));
  return { links, growth, gap };
};

// ── GEO / AEO ────────────────────────────────────────────────────────────────
export const ENGINES = ['ChatGPT', 'Gemini', 'Perplexity', 'Claude', 'AI Overviews'];
export const getGeo = (b) => {
  const r = rng(`${b.id}-geo`);
  const strength = b.id === 'physio' ? 0.42 : b.id === 'salon' ? 0.28 : 0.1;
  const svc = b.services.map(s => s.name.toLowerCase());
  const prompts = [
    `best ${b.primaryCategory.toLowerCase()} in ${b.area}`,
    `${b.primaryCategory.toLowerCase()} near ${b.area} ${b.city}`,
    `is ${b.name} good`,
    `${svc[0]} in ${b.city} cost`,
    `top rated ${b.primaryCategory.toLowerCase()} ${b.city}`,
    `where to get ${svc[1] || svc[0]} in ${b.area}`,
    `${b.primaryCategory.toLowerCase()} open on sunday ${b.area}`,
    `affordable ${svc[0]} ${b.city}`
  ].map((p, i) => ({
    id: i, prompt: p,
    results: Object.fromEntries(ENGINES.map(e => {
      const mentioned = r() < strength + (p.includes(b.name) ? 0.5 : 0);
      return [e, { mentioned, position: mentioned ? int(r, 1, 5) : null, sentiment: mentioned ? pick(r, ['positive', 'positive', 'neutral']) : null }];
    })),
    competitors: b.competitors.filter(() => r() < 0.4).slice(0, 3)
  }));
  const trend = Array.from({ length: 10 }, (_, w) => ({
    week: shortDate(daysBack((9 - w) * 7)),
    ...Object.fromEntries(ENGINES.map((e, ei) => [e, Math.round(Math.min(95, (strength * 100) * (0.7 + w * 0.05) + (ei - 2) * 4 + r() * 6))]))
  }));
  const sources = [
    { url: 'practo.com/pune/...', engines: 4, yours: b.id === 'physio' },
    { url: 'justdial.com/Pune/...', engines: 3, yours: true },
    { url: 'reddit.com/r/pune', engines: 3, yours: false },
    { url: `lbb.in/pune/best-${b.primaryCategory.toLowerCase().replace(/\s/g, '-')}`, engines: 2, yours: false },
    { url: b.website || 'your website', engines: 2, yours: Boolean(b.website) },
    { url: 'google.com/maps (reviews)', engines: 5, yours: true }
  ];
  return { prompts, trend, sources };
};

// ── posts, photos, FAQs ──────────────────────────────────────────────────────
export const getPosts = (b) => [
  { id: 1, type: 'Offer', title: 'Free posture check this week', body: `Book a free 10-minute posture check at ${b.name} in ${b.area} this week. Ideal if you work long hours at a desk.`, cta: 'BOOK', date: ymd(daysBack(-3)), status: 'scheduled' },
  { id: 2, type: 'Update', title: '', body: `New evening slots from 7 to 9 pm on weekdays at our ${b.area} ${b.primaryCategory.toLowerCase()}.`, cta: 'LEARN_MORE', date: ymd(daysBack(4)), status: 'published' },
  { id: 3, type: 'Update', title: '', body: `${b.services[0]?.name || 'Our services'}: what to expect in your first session.`, cta: 'LEARN_MORE', date: ymd(daysBack(11)), status: 'published' },
  { id: 4, type: 'Event', title: 'Diwali hours', body: 'We are closed on Laxmi Pujan and open regular hours the rest of the week.', cta: 'CALL', date: ymd(daysBack(-9)), status: 'draft' }
];

export const draftPost = (b, type, topic) => {
  const svc = topic || b.services[0]?.name || b.primaryCategory;
  if (type === 'Offer') return { title: `${svc}: first visit offer`, body: `Trying ${svc.toLowerCase()} for the first time? Book this week at ${b.name}, ${b.area}, and get a free assessment with your first session. Limited slots each day.`, cta: 'BOOK' };
  if (type === 'Event') return { title: `${svc} awareness week`, body: `Join us at ${b.name} in ${b.area} for a free ${svc.toLowerCase()} awareness session. Ask our team anything and get practical tips you can use at home.`, cta: 'SIGN_UP' };
  return { title: '', body: `${svc} at ${b.name}, ${b.area}: our team works out a plan for you after a proper assessment, so you know what to expect from day one. ${b.attributes.includes('Online appointments') ? 'Book online in under a minute.' : 'Call or drop in to book.'}`, cta: 'LEARN_MORE' };
};

export const getFaqs = (b) => [
  { q: `Do I need a doctor's referral to visit ${b.name}?`, a: 'No, you can book directly. Bring any reports you already have.' },
  { q: 'What are your opening hours?', a: 'Monday to Saturday, 9 am to 9 pm. Sunday by appointment.' },
  { q: `How much does ${b.services[0]?.name.toLowerCase() || 'a session'} cost?`, a: b.services[0]?.price ? `It is ${b.services[0].price}.` : '[add price]' },
  { q: 'Is parking available?', a: 'Street parking is available on the lane behind the clinic.' }
];

export const DEFAULT_HOURS = [
  ['Monday', '09:00', '21:00', true], ['Tuesday', '09:00', '21:00', true], ['Wednesday', '09:00', '21:00', true],
  ['Thursday', '09:00', '21:00', true], ['Friday', '09:00', '21:00', true], ['Saturday', '09:00', '18:00', true], ['Sunday', '10:00', '13:00', false]
];
export const SPECIAL_DAYS = [
  { date: ymd(daysBack(-12)), name: 'Diwali (Laxmi Pujan)', closed: true },
  { date: ymd(daysBack(-13)), name: 'Diwali Padwa', closed: false, open: '11:00', close: '16:00' },
  { date: ymd(daysBack(-60)), name: 'Christmas', closed: false, open: '10:00', close: '14:00' }
];

// ── AI agent (autopilot) ─────────────────────────────────────────────────────
export const getAgentQueue = (b) => [
  { id: 'a1', agent: 'GBP agent', kind: 'GBP post', impact: 'High', title: 'Weekly offer post', detail: draftPost(b, 'Offer').body, before: null, status: 'pending' },
  { id: 'a2', agent: 'Review agent', kind: 'Review reply', impact: 'High', title: 'Reply to 2★ review about rescheduling', detail: draftReply(b, { author: 'Amit Deshpande', rating: 2, topics: ['appointments'] }), before: null, status: 'pending' },
  { id: 'a3', agent: 'GBP agent', kind: 'Profile change', impact: 'Medium', title: 'Add 2 missing services', detail: 'Add "Dry needling" and "Kinesio taping" to services with descriptions.', before: `${b.services.length} services`, status: 'pending' },
  { id: 'a4', agent: 'Audit agent', kind: 'Website fix', impact: 'High', title: 'Add LocalBusiness schema to home page', detail: 'JSON-LD generated from the Business Profile (name, address, phone, hours, geo).', before: 'No schema', status: 'pending' },
  { id: 'a5', agent: 'Content agent', kind: 'Blog draft', impact: 'Medium', title: `Blog: ${b.services[0]?.name || 'Our services'} in ${b.city} - cost and what to expect`, detail: '1,450 words, on-page score 86, 6 FAQs, 3 internal links.', before: null, status: 'pending' },
  { id: 'a6', agent: 'Outreach agent', kind: 'Outreach email', impact: 'Low', title: 'Ask lbb.in to add you to "Best in Pune" list', detail: 'Polite pitch with 3 reasons and a photo set. You send it.', before: null, status: 'pending' }
];

export const AGENTS = [
  { name: 'Planner', job: 'Prioritises the week\'s tasks by expected impact', tools: 'All read APIs' },
  { name: 'GBP agent', job: 'Posts, photos, attribute and service updates', tools: 'Business Profile API (write, after approval)' },
  { name: 'Review agent', job: 'Drafts replies, flags issues, sends review requests', tools: 'Reviews API, WhatsApp API' },
  { name: 'Content agent', job: 'Briefs, drafts, refreshes', tools: 'SERP API, LLM, CMS API' },
  { name: 'Audit agent', job: 'Finds and explains site issues; generates schema', tools: 'Crawler, PageSpeed, Search Console' },
  { name: 'Outreach agent', job: 'Finds link and citation targets; drafts emails', tools: 'Backlink APIs, email drafts' },
  { name: 'Reporter', job: 'Monthly summary in plain language and the owner\'s language', tools: 'Analytics APIs' }
];

export const PLANS = [
  { name: 'Starter', who: 'Single shop, clinic, salon', price: '₹999 – 1,999', includes: ['GBP manager', 'Review replies', '4 posts / month', 'Monthly report'] },
  { name: 'Growth', who: 'Business with a website', price: '₹2,999 – 4,999', includes: ['Everything in Starter', 'Local rank grid', '4 AI blogs / month', 'Site audit', 'WhatsApp bot'], popular: true },
  { name: 'Pro', who: 'Competitive local markets', price: '₹7,999 – 14,999', includes: ['Everything in Growth', 'Backlinks & citations', 'GEO / AEO tracker', 'AI autopilot'] },
  { name: 'Agency', who: 'Agencies and freelancers', price: 'Per location', includes: ['White-label reports', 'Client logins', 'Bulk tools', 'Volume discounts'] }
];

// ── Google accounts (demo) ───────────────────────────────────────────────────
// What "Connect Google account" finds for each sign-in: the Business Profiles that account
// owns or manages. In live mode this is the Business Profile API (accounts, then locations).
export const GOOGLE_ACCOUNTS = [
  { email: 'owner.shreephysio@gmail.com', name: 'Dr. Meera Kulkarni', role: 'Owner', locations: ['physio'] },
  { email: 'glowstudio.baner@gmail.com', name: 'Glow Studio', role: 'Owner', locations: ['salon'], duplicates: [{ name: 'Glow Studio Salon Baner', address: 'Balewadi High Street, Baner, Pune', note: 'Unverified duplicate of Glow Studio Unisex Salon' }] },
  { email: 'ironcore.wakad@gmail.com', name: 'IronCore Fitness', role: 'Manager', locations: ['gym'] }
];
export const findGoogleAccount = (email) => GOOGLE_ACCOUNTS.find(a => a.email.toLowerCase() === String(email || '').trim().toLowerCase()) || null;
