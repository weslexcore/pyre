// SOP video walkthroughs (see the sop_videos migration): the rules the
// upload route, the library picker and the markdown renderer share, so they
// agree on what a video reference looks like and what may be uploaded.
// Safe to import from the browser and the server.
//
// A document embeds a library video with image syntax pointing at the
// video's route:
//
//   ![Banking the stove](/api/admin/sop-videos/<id>)
//   ![Banking the stove](/api/admin/sop-videos/<id>#t=1:30)   ← start at 1:30
//
// The route is a real URL (it redirects to a short-lived signed link), so a
// plain markdown link to it works too, and the reference survives copying a
// document anywhere the dashboard renders markdown.

export const SOP_VIDEO_BUCKET = 'sop-videos';

/** Mirrors allowed_mime_types on the sop-videos bucket. */
export const SOP_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export type SopVideoMime = (typeof SOP_VIDEO_MIME_TYPES)[number];

/** Same ceiling as the bucket's file_size_limit — 500 MB. */
export const MAX_SOP_VIDEO_BYTES = 524_288_000;

export const MAX_SOP_VIDEO_TITLE = 200;

/** What the file picker offers. */
export const SOP_VIDEO_ACCEPT = SOP_VIDEO_MIME_TYPES.join(',');

export const SOP_VIDEO_ROUTE = '/api/admin/sop-videos';

/** A library video as the API returns it. */
export interface SopVideo {
  id: string;
  title: string;
  file_name: string;
  mime_type: SopVideoMime;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  /** The SOPs whose current text references this video. */
  used_in: { slug: string; title: string }[];
}

export function isSopVideoMime(mime: string): mime is SopVideoMime {
  return (SOP_VIDEO_MIME_TYPES as readonly string[]).includes(mime);
}

/** The bare mime type, without parameters or case. */
export function normalizeMime(mime: string): string {
  return mime.toLowerCase().split(';')[0].trim();
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REF_RE = new RegExp(`^${SOP_VIDEO_ROUTE}/(${UUID})(?:#t=([0-9:.]+))?$`, 'i');
const REF_GLOBAL_RE = new RegExp(`${SOP_VIDEO_ROUTE}/(${UUID})`, 'gi');

/** The route a video plays from. */
export function sopVideoSrc(id: string): string {
  return `${SOP_VIDEO_ROUTE}/${id}`;
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

/** The video a markdown href or src points at, with its start time, or null. */
export function parseSopVideoRef(href: string | undefined | null): {
  id: string;
  start: number | null;
} | null {
  if (!href) return null;
  const match = REF_RE.exec(href.trim());
  if (!match) return null;
  return { id: match[1].toLowerCase(), start: match[2] ? parseStartTime(match[2]) : null };
}

/** Every distinct video id a document references, in order of first use. */
export function sopVideoIdsIn(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(REF_GLOBAL_RE)) ids.add(match[1].toLowerCase());
  return [...ids];
}

/**
 * The markdown that embeds a video. Brackets in the title would close the
 * alt text early, so they are dropped.
 */
export function sopVideoMarkdown(video: { id: string; title: string }): string {
  const alt = video.title.replace(/[[\]]/g, '').trim() || 'Video';
  return `![${alt}](${sopVideoSrc(video.id)})`;
}

/** A default title from a file name: `banking-the-stove.mp4` → `banking the stove`. */
export function titleFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return (base || 'Walkthrough').slice(0, MAX_SOP_VIDEO_TITLE);
}

/** Object key for a video: `videos/<id>.<ext>`. */
export function sopVideoStoragePath(id: string, mime: SopVideoMime): string {
  const ext = mime === 'video/webm' ? 'webm' : mime === 'video/quicktime' ? 'mov' : 'mp4';
  return `videos/${id}.${ext}`;
}

/** Client-side pre-check so a bad file is reported before a byte moves. */
export function checkSopVideoFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!isSopVideoMime(normalizeMime(file.type))) {
    return `${file.name}: only MP4, WebM and MOV videos can be uploaded`;
  }
  if (file.size === 0) return `${file.name}: file is empty`;
  if (file.size > MAX_SOP_VIDEO_BYTES) {
    return `${file.name} is over the ${Math.round(MAX_SOP_VIDEO_BYTES / 1_048_576)} MB limit`;
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
