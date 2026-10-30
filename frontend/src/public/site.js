/**
 * Public details shown on the landing page, Privacy Policy and Terms. Google's OAuth verification checks
 * that these match the consent screen (app name, support email, homepage and policy links on your domain).
 * Set them with Vite env vars in frontend/.env (VITE_SUPPORT_EMAIL is required before submitting).
 */
export const SITE = {
  name: 'Bevisiby AI',
  short: 'Bevisiby',
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
    use: 'List the Business Profiles you own or manage, read their details, reviews, photos and performance insights, and publish the review replies and posts you approve.',
    never: 'Nothing is published or changed on Google without your approval.'
  },
  {
    product: 'Google Ads: Keyword Planner', scope: 'https://www.googleapis.com/auth/adwords',
    use: 'Read keyword ideas, monthly search volumes and trends from Keyword Planner to plan SEO for the businesses you manage.',
    never: 'We never create, edit or pause campaigns, and never spend from your ad account.'
  },
  {
    product: 'Gmail', scope: 'https://www.googleapis.com/auth/gmail.readonly',
    use: 'Read client onboarding emails in the inbox you connect, so a new client\'s details are extracted and their onboarding starts automatically.',
    never: 'We never send, delete or change email, and never use email content for advertising or AI model training.'
  }
];
