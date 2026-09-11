const UPDATED_AT = '2026-09-11';

export interface LegalSection {
  heading: string;
  body: string;
}

export interface LegalDocument {
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
}

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Privacy Policy',
  updatedAt: UPDATED_AT,
  intro:
    'Internal Operations Hub ("the App") is a workplace service-desk tool run by your employer ("the Company"). ' +
    'This policy explains what personal data the App processes, why, and what rights you have. ' +
    'Questions: operationshub031@gmail.com.',
  sections: [
    {
      heading: 'Data we collect',
      body:
        'Account data: your name, work email address, and company. ' +
        'Credentials: passwords are stored only as bcrypt hashes and can never be read back; ' +
        'Google sign-in uses an opaque subject identifier, never your Google password. ' +
        'Two-factor secrets, if you enable MFA, including encrypted backup codes. ' +
        'Work content you submit: request titles, descriptions, priorities, and attached documents (PDF/PNG/JPEG, max 5MB). ' +
        'Operational data: sign-in tokens, IP address and device identifiers in server logs, and an append-only audit trail of actions you take (who did what, when).',
    },
    {
      heading: 'How we use it',
      body:
        'To operate the service: authentication, routing your requests to the right department, ' +
        'showing your request history and notifications, and enforcing company permissions. ' +
        'To keep the service safe: rate limiting, abuse detection, and security logging. ' +
        'To contact you about access: invitation emails containing a one-time signup code. ' +
        'We do not sell personal data and we do not use it for advertising.',
    },
    {
      heading: 'Who else processes it',
      body:
        'Hosting provider (application server and database). ' +
        'Google, only to verify Google sign-in tokens when your company uses SSO. ' +
        'Brevo, only to deliver invitation emails your administrator triggers. ' +
        'Cloudflare R2 object storage, only if your company configured it for document payloads. ' +
        'Expo/EAS build service for distributing the mobile app. ' +
        'Each processes data solely to provide the service; document downloads are always brokered through our API and never via public links.',
    },
    {
      heading: 'Retention',
      body:
        'Request history and audit records are kept while your account is active and per company policy afterwards. ' +
        'Attached documents are permanently deleted 30 days after request completion, or immediately when removed. ' +
        'Sign-in tokens expire automatically (access tokens in minutes, refresh tokens in days). ' +
        'Server logs rotate regularly.',
    },
    {
      heading: 'Your rights',
      body:
        'You may ask your company administrator to review, correct, or deactivate your account at any time. ' +
        'For access, correction, or full erasure requests, contact your administrator or operationshub031@gmail.com and we will respond within 30 days. ' +
        'Deactivation blocks sign-in immediately; erasure removes your profile, credentials, and documents while preserving anonymized audit integrity where the law requires it.',
    },
    {
      heading: 'Security',
      body:
        'Passwords are hashed with bcrypt; sessions use short-lived signed tokens with rotation and theft detection; ' +
        'company data is strictly isolated per tenant; traffic is encrypted in transit. ' +
        'No system is perfect — report suspected issues to operationshub031@gmail.com.',
    },
    {
      heading: 'Changes',
      body:
        'If this policy changes materially, the updated date above will change and administrators will be notified in-app. Continued use after changes take effect constitutes acceptance.',
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDocument = {
  title: 'Terms of Service',
  updatedAt: UPDATED_AT,
  intro:
    'These terms govern use of Internal Operations Hub ("the App") by employees and administrators of customer companies. ' +
    'By signing in you agree to these terms. Contact: operationshub031@gmail.com.',
  sections: [
    {
      heading: 'The service',
      body:
        'The App provides internal request intake, department routing, status tracking, document exchange, and audit history for workplaces. ' +
        'It is currently rolling out: features may change, and availability is provided as-is without a guaranteed uptime SLA while on introductory infrastructure.',
    },
    {
      heading: 'Accounts',
      body:
        'Accounts are issued by company invitation only — knowing a company name is not enough to join. ' +
        'Company administrators are responsible for inviting the right people, assigning correct roles, and deactivating accounts of people who leave. ' +
        'You are responsible for keeping your password and authenticator device secret and for activity under your account.',
    },
    {
      heading: 'Acceptable use',
      body:
        'Use the App only for legitimate workplace requests. Do not upload unlawful, malicious, or unrelated content; ' +
        'do not attempt to access other companies’ data, other users’ accounts, or the underlying infrastructure; ' +
        'do not probe rate limits, extract bulk data, or interfere with the service. Violations may lead to suspension.',
    },
    {
      heading: 'Content and liability',
      body:
        'Request text and attachments belong to your employer and its authors; we claim no ownership and use them only to operate the service. ' +
        'To the maximum extent permitted by law, the service is provided without warranties and liability is limited to the fees paid for the affected period. ' +
        'Nothing here limits liability that cannot legally be limited.',
    },
    {
      heading: 'Suspension and termination',
      body:
        'Administrators may deactivate accounts at any time. We may suspend companies or accounts that abuse the service, breach these terms, or threaten security, with notice where practical. ' +
        'On termination, access ends; documents follow the 30-day purge rule and personal data per the Privacy Policy.',
    },
    {
      heading: 'Changes and contact',
      body:
        'We may update these terms as the service matures; material changes will be announced in-app with at least 14 days’ notice. ' +
        'Questions or disputes: contact operationshub031@gmail.com first so we can resolve them directly.',
    },
  ],
};
