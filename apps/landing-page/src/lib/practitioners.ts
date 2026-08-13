// Guest practitioners for special events.
//
// The bio and headshot come from the Momence teacher profile attached to the
// event (Momence `/Teachers` — `bio` + `profileImage`), so adding a guest is
// just filling in their Momence profile. The overrides below are for anything
// Momence can't express: a role line, links, a better headshot, or replacement
// copy.
//
// Everything degrades gracefully:
//   - no bio anywhere -> name + avatar render, but nothing is clickable
//   - no headshot     -> a monogram avatar stands in
//   - house account   -> no practitioner credit at all

import { eventHasTag } from './booking-model';
import { SPECIAL_EVENT_TAG } from './events-config';
import type { MomenceTeacher } from './momence-types';
import type { EventItem, Practitioner } from './types';

// Momence teacher names that are the studio itself rather than a person. These
// never render a practitioner credit.
const HOUSE_TEACHER_NAMES = ['pyre sauna', 'pyre', 'sauna rental'];

// Normalize a name for matching: lowercase, strip punctuation, collapse spaces.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Local overrides, keyed by the practitioner's Momence name. Every field is
// optional and wins over the Momence profile when set — leave a field out to
// keep what Momence provides.
//
// Example:
//   'Ashley Coleman': {
//     role: 'Shamanic Energy Medicine Practitioner',
//     photo: { src: '/practitioners/ashley-coleman.webp', alt: 'Ashley Coleman' },
//     links: [{ label: 'Winged Alchemy', href: 'https://example.com' }],
//   },
//
// Headshots live in `public/practitioners/` and are referenced by path; a
// remote URL works too.
const PRACTITIONER_OVERRIDES: Record<string, Omit<Practitioner, 'name'>> = {};

const OVERRIDES_BY_NAME = new Map(
  Object.entries(PRACTITIONER_OVERRIDES).map(([name, override]) => [normalizeName(name), override])
);

// True when a teacher name is the studio account rather than a real person.
export function isHouseTeacher(name: string): boolean {
  return HOUSE_TEACHER_NAMES.includes(normalizeName(name));
}

// Momence stores a bio as one blob of text; blank lines separate paragraphs.
function splitBio(bio: string | null | undefined): string[] | undefined {
  const trimmed = (bio ?? '').trim();
  if (!trimmed) return undefined;

  return trimmed
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Build the practitioner shown on an event: the Momence name, enriched with
 * that teacher's Momence profile when we have it, then with any local
 * override. Returns undefined for blank names and house accounts.
 */
export function toPractitioner(
  name: string | null | undefined,
  profile?: MomenceTeacher
): Practitioner | undefined {
  const trimmed = (name ?? '').trim();
  if (!trimmed || isHouseTeacher(trimmed)) return undefined;

  const fromMomence: Practitioner = {
    name: trimmed,
    bio: splitBio(profile?.bio),
    photo: profile?.profileImage ? { src: profile.profileImage, alt: trimmed } : undefined,
  };

  const override = OVERRIDES_BY_NAME.get(normalizeName(trimmed));
  if (!override) return fromMomence;

  return {
    ...fromMomence,
    ...override,
    // An override with no bio/photo of its own keeps the Momence one.
    bio: override.bio ?? fromMomence.bio,
    photo: override.photo ?? fromMomence.photo,
    name: trimmed,
  };
}

/**
 * Practitioners to credit on an event. Only special events carry a guest
 * practitioner — regular sessions are run by the Pyre team under the house
 * account, so they credit no one.
 */
export function specialEventPractitioners(event: EventItem): Practitioner[] {
  if (!eventHasTag(event, SPECIAL_EVENT_TAG)) return [];
  return Array.isArray(event.practitioners) ? event.practitioners : [];
}

// A bio modal is only worth opening when there's a bio to read.
export function hasBio(practitioner: Practitioner): boolean {
  return Array.isArray(practitioner.bio) && practitioner.bio.some((p) => p.trim().length > 0);
}

// Initials for the fallback monogram avatar, e.g. "Ashley Coleman" -> "AC".
export function practitionerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

// Copy for the practitioner credit and bio modal.
export const practitionerCopy = {
  bylineLabel: 'Hosted by',
  viewBioLabel: 'View bio',
  closeLabel: 'Close bio',
};
