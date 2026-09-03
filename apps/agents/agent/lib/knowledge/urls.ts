// Links back into the staff dashboard (the integrations app) for every
// knowledge hit, so an answer can cite the page it came from. The base is
// the dashboard's origin; the path shapes mirror the dashboard's routes.

const DEFAULT_SITE_URL = 'https://integrations.pyresauna.com';

export function siteUrl(path: string): string {
  const base = (process.env.KNOWLEDGE_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');
  return `${base}${path}`;
}

/** /admin/sops/<slug>, with an optional #section anchor. */
export function sopUrl(slug: string, anchor?: string | null): string {
  return siteUrl(`/admin/sops/${slug}${anchor ? `#${anchor}` : ''}`);
}

export const WATER_LOG_URL_PATH = '/admin/water';
export const SCHEDULE_URL_PATH = '/admin/schedule';

/** The schedule board, opened on the week holding `date` (YYYY-MM-DD) when one is given. */
export function scheduleUrl(date?: string | null): string {
  return siteUrl(date ? `${SCHEDULE_URL_PATH}?view=week&date=${date}` : SCHEDULE_URL_PATH);
}
export const SHIFT_NOTES_URL_PATH = '/admin/shift-notes';

export function incidentUrl(id: string): string {
  return siteUrl(`/admin/incidents/${id}`);
}
