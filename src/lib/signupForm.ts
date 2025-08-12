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
  metadata: {
    subscribedParam: 'subscribed',
  },
};

export default signupForm;


