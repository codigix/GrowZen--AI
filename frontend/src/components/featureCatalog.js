/**
 * Pages the layout lists that need something this app does not have yet (a market-data provider, ad accounts, social accounts, a media
 * database). Each shows what it will do and what it needs, and points to the closest page that works now: no number on them is invented.
 * [slug, title, what it does, what it needs, label of the page to use meanwhile, its address]
 */
const MARKET = 'A market-data provider (estimated traffic for any website). Your own traffic is on Traffic Analytics.';
const SOCIAL = 'Connected social accounts (Meta, LinkedIn, X) with their API permissions.';
const ADS = 'A Google Ads account connection or an advertising-intelligence data source.';
const PR = 'A media contact database and a verified email-sending domain.';
const AIDATA = 'Saved AI answers: add prompts and run them in AI Search Visibility first.';

export const FEATURE_ROWS = [
  // AI visibility
  ['ai-competitors', 'Competitor Research', 'Which brands the AI assistants recommend instead of you, prompt by prompt.', AIDATA, 'AI Search Visibility', '/geo-optimization'],
  ['ai-brand', 'Brand Performance', 'How often and how well AI assistants mention your brand over time.', AIDATA, 'AI Search Visibility', '/geo-optimization'],
  ['ai-perception', 'Perception', 'The words and sentiment AI assistants use about your brand.', AIDATA, 'AI Search Visibility', '/geo-optimization'],
  ['ai-narrative', 'Narrative Drivers', 'The sources and topics that shape what AI says about you.', AIDATA, 'Cited Sources', '/geo-optimization?tab=sources'],
  // SEO
  ['referring-domains', 'Referring Domains', 'Every site linking to you, with its quality and what it links to.', 'A backlink index. Our own discovery bot lists the links it finds in Backlink Intelligence.', 'Backlinks', '/backlinks/domains'],
  ['backlink-audit', 'Backlink Audit', 'Finds risky or toxic links to review and disavow.', 'A backlink index with link-quality data.', 'Backlinks', '/backlinks/domains'],
  // Traffic & market
  ['tm-ai-traffic', 'AI Traffic', 'Visits that come from AI assistants.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-referral', 'Referral', 'Visits from links on other websites.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-organic-search', 'Organic Search', 'Visits from unpaid Google results, for any site.', MARKET, 'Organic Rankings', '/organic-rankings'],
  ['tm-paid-search', 'Paid Search', 'Visits from search ads.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-organic-social', 'Organic Social', 'Visits from unpaid social posts.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-paid-social', 'Paid Social', 'Visits from social ads.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-email', 'Email', 'Visits from email campaigns.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-display', 'Display Ads', 'Visits from banner and display advertising.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-sources', 'Sources & Destinations', 'Where visitors come from and where they go next.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-page-groups', 'Page Groups', 'Traffic grouped by sections of a site.', MARKET, 'Top Pages', '/top-pages'],
  ['tm-usa', 'USA', 'A market view of the United States.', MARKET, 'Domain Overview', '/domain-overview'],
  ['tm-business-regions', 'Business Regions', 'Traffic by business region.', MARKET, 'Domain Overview', '/domain-overview'],
  ['tm-geo-regions', 'Geographical Regions', 'Traffic by geographical region.', MARKET, 'Domain Overview', '/domain-overview'],
  ['tm-demographics', 'Demographics', 'Age, gender and other traits of a site\'s audience.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-overlap', 'Audience Overlap', 'Which sites share your audience.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-socio', 'Socioeconomics', 'Income and education of a site\'s audience.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-behavior', 'Behavior', 'What the audience does on and between sites.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-daily', 'Daily Trends', 'Day-by-day traffic for any site.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-industry', 'Industry & Bulk Analysis', 'Compare many sites or a whole industry at once.', MARKET, 'Compare Domains', '/compare-domains'],
  ['tm-api', 'Trends API', 'Traffic and market figures delivered by API.', MARKET, 'Traffic Analytics', '/traffic'],
  ['tm-trending', 'Trending Websites', 'Sites that are growing fastest.', MARKET, 'Traffic Analytics', '/traffic'],
  // Advertising
  ['ads-start', 'Get Started', 'Connect your ad account and pick a first campaign.', ADS, 'Ads Launch Assistant', '/ads-assistant'],
  ['ads-agent', 'Ads AI Agent', 'An agent that watches and adjusts your campaigns.', ADS, 'Ads Launch Assistant', '/ads-assistant'],
  ['ads-research', 'Advertising Research', 'The ads and keywords competitors run.', ADS, 'Competitor Research', '/competitor-finder'],
  ['ads-pla', 'PLA Research', 'Product listing ads competitors run.', ADS, 'Ads Launch Assistant', '/ads-assistant'],
  ['ads-adclarity', 'AdClarity', 'Display and video ad intelligence.', ADS, 'Ads Launch Assistant', '/ads-assistant'],
  // AI PR
  ['pr-dashboard', 'Dashboard', 'Your outreach, replies and coverage at a glance.', PR, 'AI-Cited Media', '/geo-optimization?tab=sources'],
  ['pr-contacts', 'Contact Search', 'Find journalists and editors by topic and outlet.', PR, 'Outreach', '/off-page-seo?tab=outreach'],
  ['pr-lists', 'Media Lists', 'Save contacts into lists for a campaign.', PR, 'Outreach', '/off-page-seo?tab=outreach'],
  ['pr-emails', 'Your Emails', 'Write, send and track pitches.', PR, 'Outreach', '/off-page-seo?tab=outreach'],
  ['pr-senders', 'Senders and Domains', 'Set up and verify the domains pitches go out from.', PR, 'Outreach', '/off-page-seo?tab=outreach'],
  ['pr-monitoring', 'Media Monitoring', 'Mentions of your brand in the news.', PR, 'AI-Cited Media', '/geo-optimization?tab=sources'],
  ['pr-alerts', 'Alerts and Digests', 'Email alerts when you are mentioned.', PR, 'AI-Cited Media', '/geo-optimization?tab=sources'],
  // Social
  ['social-dashboard', 'Dashboard', 'Your posts, reach and growth across networks.', SOCIAL, 'Social Poster', '/social-poster'],
  ['social-tracker', 'Social Tracker', 'Follow your profiles and competitors\' profiles.', SOCIAL, 'Social Poster', '/social-poster'],
  ['social-insights', 'Social Content Insights', 'Which posts and topics work best.', SOCIAL, 'Social Poster', '/social-poster'],
  ['social-analytics', 'Social Analytics', 'Followers, reach and engagement over time.', SOCIAL, 'Social Poster', '/social-poster'],
  ['social-influencers', 'Influencer Analytics', 'Find and vet influencers.', SOCIAL, 'Social Poster', '/social-poster'],
  ['social-monitoring', 'Media Monitoring', 'Mentions of your brand on social networks.', SOCIAL, 'Social Poster', '/social-poster'],
  // Reports and apps
  ['report-create', 'Create report', 'Build a report from the sections you choose.', 'A report builder (sections, branding, scheduling).', 'My Reports', '/reports'],
  ['report-templates', 'Templates', 'Reusable report layouts.', 'A report builder (sections, branding, scheduling).', 'My Reports', '/reports'],
  ['report-themes', 'Themes', 'Colours and logo for your reports.', 'A report builder (sections, branding, scheduling).', 'My Reports', '/reports'],
  ['apps-store', 'Store', 'Extra tools you can add.', 'An app marketplace.', 'Integrations & APIs', '/google-integrations'],
  ['apps-mine', 'My Apps', 'The extra tools you have added.', 'An app marketplace.', 'Integrations & APIs', '/google-integrations']
];

export const FEATURES = Object.fromEntries(FEATURE_ROWS.map(([slug, title, does, needs, altLabel, altTo]) => [slug, { slug, title, does, needs, alt: { label: altLabel, to: altTo } }]));
export const soon = (slug) => ({ to: `/feature/${slug}`, label: FEATURES[slug].title, badge: 'Soon' });
