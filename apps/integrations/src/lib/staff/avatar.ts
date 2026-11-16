// How a staff member looks wherever the dashboard names them: their photo,
// or their first initial on a colour picked at random for their row
// (staff.avatar_color, set by the database). Shared by the server, which
// builds the directory every admin page carries (AdminLayout), and the
// islands that draw the badge (components/admin/StaffAvatar).

/** Palette for the initials badge, keyed by staff.avatar_color. */
export const AVATAR_COLORS = {
  ember: '#b4532a',
  gold: '#a8812f',
  sage: '#5b7a57',
  sky: '#3d6f9e',
  plum: '#76508a',
  rose: '#a8485f',
  teal: '#2f7a72',
  sand: '#85704f',
} as const;

export type AvatarColor = keyof typeof AVATAR_COLORS;

export const AVATAR_COLOR_KEYS = Object.keys(AVATAR_COLORS) as AvatarColor[];

export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AVATAR_COLORS, value);
}

/**
 * The badge colour for a person. Their row's own pick when it is a known
 * key; otherwise (no row, e.g. an env-allowlisted admin, or a key this code
 * no longer knows) a stable pick from their email, so they keep one colour
 * everywhere.
 */
export function avatarColorFor(color: string | null | undefined, email: string): string {
  if (isAvatarColor(color)) return AVATAR_COLORS[color];
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[AVATAR_COLOR_KEYS[hash % AVATAR_COLOR_KEYS.length]];
}

/** "Maya Lin" → "M"; "jo@x.com" → "J"; "" → "?". */
export function initialOf(name: string): string {
  const first = name.trim().match(/\p{L}|\p{N}/u)?.[0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** Content types an avatar upload may be. The browser sends a JPEG. */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Matches the bucket's file_size_limit. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Where an avatar photo is served from. The object key rides along as `v`:
 * a new upload is a new key, so the response can be cached forever.
 */
export function avatarSrc(row: { id: string; avatar_path: string | null }): string | null {
  if (!row.avatar_path) return null;
  const version = row.avatar_path.split('/').pop()?.split('.')[0] ?? '';
  return `/api/admin/staff-avatar?id=${row.id}&v=${encodeURIComponent(version)}`;
}

/** One person in the directory every admin page carries. */
export interface StaffDirectoryEntry {
  /** Lowercased login email: the key every page names people by. */
  email: string;
  name: string;
  /** Badge colour, already resolved to a hex value. */
  color: string;
  /** Photo URL, or null for the initials badge. */
  src: string | null;
}

/** The id of the inert JSON <script> AdminLayout writes the directory into. */
export const STAFF_DIRECTORY_ELEMENT_ID = 'staff-directory';

export function directoryEntryOf(row: {
  id: string;
  email: string | null;
  display_name: string;
  avatar_path: string | null;
  avatar_color: string | null;
}): StaffDirectoryEntry | null {
  const email = row.email?.trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    name: row.display_name.trim() || email.split('@')[0],
    color: avatarColorFor(row.avatar_color, email),
    src: avatarSrc(row),
  };
}
