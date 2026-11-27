import type { SignupFormContent } from './types';

const signupForm: SignupFormContent = {
  elements: {
    title: 'SIGN UP',
    subtitle: 'JOIN OUR MAILING LIST TO HEAR ABOUT EVENTS, NEWS AND SPECIALS',
    emailLabel: 'EMAIL',
    submitLabel: 'Join the mailing list',
    successMessage: 'Thanks for subscribing!',
    errorMessage: 'Please enter a valid email.',
  },
  antiSpam: {
    honeypotFields: {
      website: 'website_url',
      phone: 'phone_number',
      confirmEmail: 'email_confirm',
    },
    timestampField: 'form_timestamp',
    minSubmissionTime: 3, // seconds
    trackInteractions: true,
  },
  turnstile: {
    siteKey: import.meta.env.PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY || '',
    theme: 'auto',
    size: 'normal',
  },
  metadata: {
    subscribedParam: 'subscribed',
  },
};

export default signupForm;
