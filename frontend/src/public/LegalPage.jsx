import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SITE, CONTACT, GOOGLE_ACCESS } from './site';
import { Logo } from './LandingPage';

/** Privacy Policy and Terms of Service: public pages linked from the landing page and Google's consent screen. */

const H = ({ children }) => <h2 className="mt-10 text-20 font-bold text-slate-900">{children}</h2>;
const P = ({ children }) => <p className="mt-3 text-15 leading-relaxed text-slate-700">{children}</p>;
const L = ({ items }) => <ul className="mt-3 space-y-2 list-disc pl-5 text-15 leading-relaxed text-slate-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
const Mail = () => (SITE.email ? <a className="text-blue-700 underline" href={`mailto:${SITE.email}`}>{SITE.email}</a> : <b>{CONTACT}</b>);

function Privacy() {
  return (
    <>
      <P>This Privacy Policy explains how {SITE.company} ("we", "us") collects, uses, shares and protects information when you use {SITE.name} (the "Service"). By using the Service you agree to this policy.</P>

      <H>1. Information we collect</H>
      <L items={[
        <><b>Account information:</b> your name, email address and profile picture when you sign up or sign in with Google, and your role in your team.</>,
        <><b>Business information you add:</b> details of the businesses you manage, such as name, address, phone, website, services, opening hours, keywords and notes.</>,
        <><b>Google user data:</b> when you connect a Google account, the data described in section 3, only for the permissions you grant.</>,
        <><b>Public web data:</b> information we fetch from public sources to run audits, such as pages of a website you ask us to audit, public Google Maps listings and Google PageSpeed results.</>,
        <><b>Usage data:</b> actions in the Service (recorded in its activity log), device and browser details, and a session cookie that keeps you signed in. We do not use advertising or tracking cookies.</>
      ]} />

      <H>2. How we use information</H>
      <L items={['To provide the Service: audits, keyword research, rank tracking, profile management, AI drafts, reports and alerts.', 'To publish changes you approve, such as review replies and posts, to the services you connected.', 'To keep the Service secure, prevent abuse and fix problems.', 'To contact you about your account and important changes to the Service.']} />

      <H>3. Google user data</H>
      <P>{SITE.name} requests access to Google data only when you connect a Google account, and only for these purposes:</P>
      <div className="mt-4 overflow-x-auto rounded ring-1 ring-slate-200">
        <table className="w-full text-14">
          <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3 font-semibold">Google product and permission</th><th className="p-3 font-semibold">What we use it for</th></tr></thead>
          <tbody className="divide-y divide-slate-200">{GOOGLE_ACCESS.map(g => <tr key={g.product} className="align-top"><td className="p-3"><b>{g.product}</b><code className="block mt-1 text-12 text-slate-500 break-all">{g.scope}</code></td><td className="p-3 text-slate-700">{g.use} {g.never}</td></tr>)}</tbody>
        </table>
      </div>
      <P><b>Limited Use.</b> {SITE.name}'s use and transfer to any other app of information received from Google APIs will adhere to the <a className="text-blue-700 underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. In particular:</P>
      <L items={[
        'We use Google user data only to provide and improve the user-facing features described above.',
        'We do not sell Google user data, and do not use or transfer it for advertising, including retargeting or personalised ads.',
        'We do not use Google user data to develop, improve or train generalised artificial intelligence or machine learning models.',
        'People at our company do not read your Google data unless you give permission for a specific message or item, it is needed for security purposes (such as investigating abuse), it is required by law, or the data has been aggregated and anonymised for internal operations.',
        'We transfer Google user data to others only to provide the Service (see section 5), for security, to comply with law, or as part of a merger or acquisition with notice to you.'
      ]} />

      <H>4. AI features</H>
      <P>The Service uses AI to draft content such as review replies, posts, descriptions, FAQs, page titles and reports. Drafts are generated from the business information you saved and public facts, are processed only to produce the feature you asked for, and are shown to you for review before anything is published. Google user data is not used to train AI models.</P>

      <H>5. Sharing</H>
      <P>We share information only with service providers who help us run the Service (such as cloud hosting, AI text generation and email delivery), under contracts that limit their use to providing the Service; when required by law; or to protect the rights and safety of our users and the public. We never sell personal information.</P>

      <H>6. Storage and security</H>
      <P>Data is stored on secured servers. Google access tokens are encrypted at rest, all connections use HTTPS, and access inside the Service is limited by user roles. No method of storage or transmission is completely secure, but we work to protect your information and will notify you of any breach as required by law.</P>

      <H>7. Retention and deletion</H>
      <L items={[
        'We keep information while your account is active or as needed to provide the Service.',
        'Disconnect a Google account at any time from the Service; we then stop accessing it and delete its stored access tokens.',
        <>You can also revoke access from your Google account permissions at <a className="text-blue-700 underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</>,
        <>To delete your account and its data, email <Mail />. We delete it within 30 days, except where the law requires us to keep certain records.</>
      ]} />

      <H>8. Your rights</H>
      <P>You can ask to access, correct or delete your personal data, or withdraw consent, by emailing <Mail />. We handle requests in line with applicable law, including India's Digital Personal Data Protection Act, 2023.</P>

      <H>9. Children</H>
      <P>The Service is for businesses and is not directed to children under 18. We do not knowingly collect their personal data.</P>

      <H>10. Changes</H>
      <P>We may update this policy. We will post the new version here with a new "Last updated" date and, for significant changes, notify you in the Service or by email.</P>

      <H>11. Contact</H>
      <P>{SITE.company}{SITE.address ? `, ${SITE.address}` : ''}. Email: <Mail /></P>
    </>
  );
}

function Terms() {
  return (
    <>
      <P>These Terms of Service ("Terms") govern your use of {SITE.name} (the "Service"), provided by {SITE.company} ("we", "us"). By creating an account or using the Service, you agree to these Terms.</P>

      <H>1. The Service</H>
      <P>{SITE.name} helps you manage local SEO for businesses: website and profile audits, keyword research, rank tracking, Google Business Profile management, AI-drafted content and reports.</P>

      <H>2. Accounts</H>
      <L items={['You must provide accurate information and keep your sign-in secure.', 'You are responsible for activity under your account and for the people you invite to your team and the roles you give them.', 'You must be at least 18 and able to form a binding contract.']} />

      <H>3. Your authority over connected accounts</H>
      <P>You may connect only Google accounts, Business Profiles, ad accounts, inboxes and websites that you own or are authorised to manage. You are responsible for having your clients' permission to manage their profiles and data through the Service.</P>

      <H>4. Approvals and AI output</H>
      <P>The Service drafts changes with AI and shows them to you before they are published, unless you choose to let low-risk items run automatically. You are responsible for reviewing and approving content and for what is published under your accounts. AI output can contain errors; review it before use.</P>

      <H>5. Acceptable use</H>
      <L items={['Do not post fake reviews, offer incentives for reviews, or misrepresent a business.', 'Follow the policies of the services you connect, including Google Business Profile, Google Ads and Gmail policies.', 'Do not use the Service to send spam, break the law, infringe others\' rights, or attempt to access data you are not authorised to access.', 'Do not interfere with or reverse-engineer the Service.']} />

      <H>6. Third-party services</H>
      <P>The Service works with third-party services such as Google. Your use of those services is governed by their own terms, and they may change or limit access at any time. {SITE.name} is not affiliated with or endorsed by Google.</P>

      <H>7. Fees</H>
      <P>Paid plans are billed as agreed when you subscribe. Fees are non-refundable except where required by law or stated in your agreement.</P>

      <H>8. Your content</H>
      <P>You keep ownership of the information you add. You give us permission to process it only to provide the Service, as described in our <Link to="/privacy" className="text-blue-700 underline">Privacy Policy</Link>.</P>

      <H>9. No guarantees</H>
      <P>The Service is provided "as is". We work to make it accurate and available, but we do not guarantee rankings, traffic, review outcomes or uninterrupted service. Search engines decide rankings independently.</P>

      <H>10. Limitation of liability</H>
      <P>To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability for any claim is limited to the fees you paid us in the three months before the claim.</P>

      <H>11. Suspension and termination</H>
      <P>You can stop using the Service at any time. We may suspend or end access if you breach these Terms or use the Service in a way that could harm others. On termination, you can request deletion of your data as described in the Privacy Policy.</P>

      <H>12. Changes and law</H>
      <P>We may update these Terms and will post the new version here with a new date. These Terms are governed by the laws of India.</P>

      <H>13. Contact</H>
      <P>{SITE.company}{SITE.address ? `, ${SITE.address}` : ''}. Email: <Mail /></P>
    </>
  );
}

export default function LegalPage({ kind }) {
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  useEffect(() => { document.title = `${title} · ${SITE.name}`; window.scrollTo(0, 0); return () => { document.title = `${SITE.name} — Autonomous SEO & Local Growth Engine`; }; }, [title]);
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" aria-label={`${SITE.name} home`}><Logo /></Link>
          <Link to="/" className="text-14 font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"><ArrowLeft size={15} /> Home</Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-12">
        <h1 className="text-34 font-bold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-2 text-14 text-slate-500">Last updated: {SITE.updated}</p>
        {kind === 'privacy' ? <Privacy /> : <Terms />}
        <div className="mt-12 pt-6 border-t border-slate-200 flex flex-wrap gap-4 text-14">
          <Link to="/" className="text-blue-700 hover:underline">Home</Link>
          <Link to={kind === 'privacy' ? '/terms' : '/privacy'} className="text-blue-700 hover:underline">{kind === 'privacy' ? 'Terms of Service' : 'Privacy Policy'}</Link>
        </div>
      </main>
    </div>
  );
}
