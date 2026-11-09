// SOP images and video walkthroughs (see the sop_media migration): the rules
// the upload route, the library picker and the markdown renderer share, so
// they agree on what a reference looks like and what may be uploaded. Safe to
// import from the browser and the server.
//
// A document embeds library media with image syntax pointing at the file's
// route. The path says which kind it is, so the renderer knows how to draw
// it without asking:
//
//   ![Banked stove](/api/admin/sop-images/<id>)
//   ![Banking the stove](/api/admin/sop-videos/<id>)
//   ![Banking the stove](/api/admin/sop-videos/<id>#t=1:30)   ← start at 1:30
//
// Each route is a real URL (it redirects to a short-lived signed link), so a
// plain markdown link to it works too.

export const SOP_MEDIA_BUCKET = 'sop-media';

export const SOP_MEDIA_KINDS = ['image', 'video'] as const;
export type SopMediaKind = (typeof SOP_MEDIA_KINDS)[number];

/** Mirrors the sop_media_mime_matches_kind check and the bucket's allowed types. */
export const SOP_MEDIA_MIME_TYPES: Record<string, SopMediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
};

/** Per-kind size ceilings; the bucket's own limit is the video one. */
export const MAX_SOP_MEDIA_BYTES: Record<SopMediaKind, number> = {
  image: 20_971_520, // 20 MB
  video: 524_288_000, // 500 MB
};

export const MAX_SOP_MEDIA_TITLE = 200;

/** What the file picker offers. */
export const SOP_MEDIA_ACCEPT = Object.keys(SOP_MEDIA_MIME_TYPES).join(',');

/** The library: listing and uploads. */
export const SOP_MEDIA_ROUTE = '/api/admin/sop-media';

/** Where each kind is served from, and what documents embed. */
export const SOP_MEDIA_ROUTES: Record<SopMediaKind, string> = {
  image: '/api/admin/sop-images',
  video: '/api/admin/sop-videos',
};

/** A library file as the API returns it. */
export interface SopMedia {
  id: string;
  kind: SopMediaKind;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  /** The SOPs whose current text references this file. */
  used_in: { slug: string; title: string }[];
}

/** The bare mime type, without parameters or case. */
export function normalizeMime(mime: string): string {
  return mime.toLowerCase().split(';')[0].trim();
}

export function kindForMime(mime: string): SopMediaKind | null {
  return SOP_MEDIA_MIME_TYPES[normalizeMime(mime)] ?? null;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE_ALT = '/api/admin/sop-(images|videos)';
const REF_RE = new RegExp(`^${ROUTE_ALT}/(${UUID})(?:#t=([0-9:.]+))?$`, 'i');
const REF_GLOBAL_RE = new RegExp(`${ROUTE_ALT}/(${UUID})`, 'gi');

/** The route a library file is served from. */
export function sopMediaSrc(media: { kind: SopMediaKind; id: string }): string {
  return `${SOP_MEDIA_ROUTES[media.kind]}/${media.id}`;
}

/**
 * Seconds from a `t=` value: plain seconds (`90`), `m:ss` (`1:30`) or
 * `h:mm:ss`. Null when it isn't one.
 */
export function parseStartTime(value: string): number | null {
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value)) return null;
  const seconds = value
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * The library file a markdown href or src points at, or null. `start` is a
 * video's `#t=` start time (always null for an image).
 */
export function parseSopMediaRef(
  href: string | undefined | null
): { kind: SopMediaKind; id: string; start: number | null } | null {
  if (!href) return null;
  const match = REF_RE.exec(href.trim());
  if (!match) return null;
  const kind: SopMediaKind = match[1].toLowerCase() === 'images' ? 'image' : 'video';
  const start = kind === 'video' && match[3] ? parseStartTime(match[3]) : null;
  return { kind, id: match[2].toLowerCase(), start };
}

/** Every distinct library file a document references, in order of first use. */
export function sopMediaIdsIn(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(REF_GLOBAL_RE)) ids.add(match[2].toLowerCase());
  return [...ids];
}

/**
 * The markdown that embeds a library file. Brackets in the title would close
 * the alt text early, so they are dropped.
 */
export function sopMediaMarkdown(media: { kind: SopMediaKind; id: string; title: string }): string {
  const alt =
    media.title.replace(/[[\]]/g, '').trim() || (media.kind === 'image' ? 'Image' : 'Video');
  return `![${alt}](${sopMediaSrc(media)})`;
}

/** A default title from a file name: `banking-the-stove.mp4` → `banking the stove`. */
export function titleFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return (base || 'Untitled').slice(0, MAX_SOP_MEDIA_TITLE);
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** Object key for a library file: `<images|videos>/<id>.<ext>`. */
export function sopMediaStoragePath(id: string, mime: string): string {
  const kind = kindForMime(mime) ?? 'image';
  return `${kind}s/${id}.${EXTENSIONS[normalizeMime(mime)] ?? 'bin'}`;
}

/** Client-side pre-check so a bad file is reported before a byte moves. */
export function checkSopMediaFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const kind = kindForMime(file.type);
  if (!kind) {
    return `${file.name}: only JPEG, PNG, WebP or GIF images and MP4, WebM or MOV videos can be uploaded`;
  }
  if (file.size === 0) return `${file.name}: file is empty`;
  if (file.size > MAX_SOP_MEDIA_BYTES[kind]) {
    return `${file.name} is over the ${formatMegabytes(MAX_SOP_MEDIA_BYTES[kind])} limit for ${kind}s`;
  }
  return null;
}

/**
 * `block` inserted into `content` at `caret` (the end when unknown) on a line
 * of its own, so an embed never lands mid-sentence.
 */
export function insertBlock(content: string, block: string, caret: number | null): string {
  const at = caret === null ? content.length : Math.max(0, Math.min(caret, content.length));
  // Move to the end of the line the caret is on.
  const lineEnd = content.indexOf('\n', at);
  const split = lineEnd === -1 ? content.length : lineEnd;
  const before = content.slice(0, split).replace(/\s+$/, '');
  const after = content.slice(split).replace(/^\s+/, '');
  return [before, block, after].filter(Boolean).join('\n\n') + (after ? '' : '\n');
}
