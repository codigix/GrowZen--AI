/**
 * The plans, described by what actually runs for each one (see the default plan schedules in the backend playbook).
 * No prices are listed here: they are agreed per client.
 */
export const PLANS = [
  { name: 'Starter', who: 'A single location', price: 'Ask for a quote', includes: ['Monthly full audit', 'Daily review check, replies drafted for approval', 'Weekly Google post drafts', 'Monthly report'] },
  { name: 'Growth', who: 'A business with a website', price: 'Ask for a quote', includes: ['Everything in Starter', 'Weekly rank tracking', 'Weekly technical checks'] },
  { name: 'Pro', who: 'Competitive local markets', price: 'Ask for a quote', includes: ['Everything in Growth', 'Weekly AI search visibility check'] },
  { name: 'Agency', who: 'Agencies and freelancers', price: 'Ask for a quote', includes: ['The Pro schedule for every client', 'Many client businesses in one account', 'Monthly PDF report per client', 'Team members'] }
];
