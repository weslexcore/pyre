import { postIntroOffer } from './definitions/post-intro-offer';
import { reviewRequest } from './definitions/review-request';
import type { Journey } from './types';

// The journey catalog. Journeys are ENROLLMENT-based (one row per member,
// unique forever — suits once-per-lifetime flows). Repeatable per-pack sends
// (credit expiry, unused credits) are direct sweep jobs instead — see
// lib/email/triggers/credit-reminders.ts.
export const JOURNEYS: Journey[] = [postIntroOffer, reviewRequest];
