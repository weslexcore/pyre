import type { ComponentType } from 'react';
import { ConfirmationEmail } from './components/ConfirmationEmail';
import { FirstTimerWelcome } from './templates/FirstTimerWelcome';
import type { EmailPropsByTemplate, EmailTemplateKey } from './types';

interface TemplateEntry<K extends EmailTemplateKey> {
  subject: (props: EmailPropsByTemplate[K]) => string;
  Component: ComponentType<EmailPropsByTemplate[K]>;
}

type Registry = { [K in EmailTemplateKey]: TemplateEntry<K> };

// Single source of truth: template key -> subject builder + component.
// Add a template here and to EmailPropsByTemplate (types.ts) to register a new email.
export const EMAIL_TEMPLATES: Registry = {
  confirmation: {
    subject: (p) => `You're booked: ${p.sessionTitle}`,
    Component: ConfirmationEmail,
  },
  'first-timer-welcome': {
    subject: () => 'Welcome to Pyre — what to expect',
    Component: FirstTimerWelcome,
  },
};

export type { EmailTemplateKey };
