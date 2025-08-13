import type { SignupFormContent } from './types';

const signupForm: SignupFormContent = {
  images: {
    background: { src: '/images/orbs.jpeg', alt: '' },
    panel: { src: '/images/heads_with_flowers.jpeg', alt: 'A hand holding red flowers' },
    symbol: { src: '/symbols/connection-symbol.png', alt: 'Connection symbol' },
  },
  elements: {
    title: 'SIGN UP',
    subtitle: 'JOIN OUR MAILING LIST TO HEAR ABOUT PRE-OPENING EVENTS, NEWS AND SPECIALS',
    emailLabel: 'EMAIL',
    submitLabel: 'Join the mailing list',
    successMessage: 'Thanks for subscribing!',
    errorMessage: 'Please enter a valid email.',
  },
  mailchimp: {
    action: 'https://pyresauna.us18.list-manage.com/subscribe/post?u=daa865d22ae34a68a2959418a&id=2c14391071&f_id=0031b3e6f0',
    audienceU: 'daa865d22ae34a68a2959418a',
    audienceId: '2c14391071',
    fId: '0031b3e6f0',
    tagId: '3034577',
    honeypotFieldName: 'b_daa865d22ae34a68a2959418a_2c14391071',
  },
  metadata: {
    subscribedParam: 'subscribed',
  },
};

export default signupForm;


