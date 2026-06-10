import type { ComponentType } from 'react';
import { FirstTimerWelcome } from './templates/FirstTimerWelcome';
import { GeneralConfirmation } from './templates/GeneralConfirmation';
import { GuidedConfirmation } from './templates/GuidedConfirmation';
import { SocialConfirmation } from './templates/SocialConfirmation';
import type { EmailPropsByTemplate, EmailTemplateKey } from './types';

interface TemplateEntry<K extends EmailTemplateKey> {
  subject: (props: EmailPropsByTemplate[K]) => string;
  Component: ComponentType<EmailPropsByTemplate[K]>;
}

type Registry = { [K in EmailTemplateKey]: TemplateEntry<K> };

// Single source of truth: template key -> subject builder + component.
// Add a template here and to EmailPropsByTemplate (types.ts) to register a new email.
export const EMAIL_TEMPLATES: Registry = {
  'guided-confirmation': {
    subject: (p) => `You're booked: ${p.sessionTitle}`,
    Component: GuidedConfirmation,
  },
  'social-confirmation': {
    subject: (p) => `You're booked: ${p.sessionTitle}`,
    Component: SocialConfirmation,
  },
  'general-confirmation': {
    subject: (p) => `You're booked: ${p.sessionTitle}`,
    Component: GeneralConfirmation,
  },
  'first-timer-welcome': {
    subject: () => 'Welcome to Pyre — what to expect',
    Component: FirstTimerWelcome,
  },
};

export type { EmailTemplateKey };
