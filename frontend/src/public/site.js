/**
 * Public details shown on the landing page, Privacy Policy and Terms. Google's OAuth verification checks
 * that these match the consent screen (app name, support email, homepage and policy links on your domain).
 * Set them with Vite env vars in frontend/.env (VITE_SUPPORT_EMAIL is required before submitting).
 */
export const SITE = {
  name: 'bevisibe AI',
  short: 'bevisibe',
  company: import.meta.env.VITE_COMPANY_NAME || 'Codigix Infotech',
  email: import.meta.env.VITE_SUPPORT_EMAIL || '',
  address: import.meta.env.VITE_COMPANY_ADDRESS || '',
  updated: '28 October 2026'
};

/** The support email, or a visible reminder to set it (never a made-up address). */
export const CONTACT = SITE.email || '[set VITE_SUPPORT_EMAIL]';

/** The Google data the app asks for, with the exact scope and why. Shown on the landing page and in the Privacy Policy. */
export const GOOGLE_ACCESS = [
  {
    product: 'Sign in with Google', scope: 'openid · email · profile',
    use: 'Create your account and sign you in. We store your name, email address and profile picture.',
    never: 'We never see your Google password.'
  },
  {
    product: 'Google Business Profile', scope: 'https://www.googleapis.com/auth/business.manage',
    use: 'List the Business Profiles you own or manage and read their details, reviews, photos and performance insights. When you press Save, edits you make in the app (such as name, hours, phone, website, description, categories, address, services and photos) are sent to your profile, and review replies and posts you approve are published.',
    never: 'AI-written drafts always wait for your approval, and nothing is changed on Google except what you save or approve.'
  },
  {
    product: 'Google Search Console', scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    use: 'Read your website\'s search clicks, impressions, queries and pages for the sites you manage, to show real Google traffic in reports.',
    never: 'Read-only: we cannot change anything in your Search Console.'
  }
];
