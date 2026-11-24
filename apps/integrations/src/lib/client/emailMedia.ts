// Uploads a photo for an email from the browser (/api/admin/email-media) and
// answers with its public address. Photos are shrunk here first: an email is
// at most 560px wide, so 1600px covers any screen at double density, and a
// phone photo straight off the camera (several MB) would make every open
// slow, and could pass Vercel's 4.5 MB request limit.

import { EMAIL_MEDIA_MAX_BYTES, emailMediaProblem } from '@/lib/email/media';
import { ApiError, readError } from './api';

const MAX_WIDTH = 1600;
/** A photo already this small and narrow is sent as it is. */
const SMALL_BYTES = 800 * 1024;
const JPEG_QUALITY = 0.85;

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The file to upload: GIFs as they are (shrinking would stop an animation),
 * other photos scaled down to 1600px wide. A PNG stays a PNG (it may be a
 * logo with a see-through background) unless that leaves it too big.
 */
export async function shrinkEmailImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  if (bitmap.width <= MAX_WIDTH && file.size <= SMALL_BYTES) {
    bitmap.close();
    return file;
  }

  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = file.type === 'image/png' ? await toBlob(canvas, 'image/png') : null;
  let type = 'image/png';
  if (!blob || blob.size > EMAIL_MEDIA_MAX_BYTES / 2) {
    blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    type = 'image/jpeg';
  }
  if (!blob) return file;
  // Not narrowed, only recompressed: keep whichever is smaller.
  if (scale === 1 && blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${name}.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
}

export async function uploadEmailImage(original: File): Promise<string> {
  const typeProblem = emailMediaProblem({ type: original.type, size: 0 });
  if (typeProblem) throw new Error(typeProblem);
  const file = await shrinkEmailImage(original);
  const problem = emailMediaProblem(file);
  if (problem) throw new Error(problem);

  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/admin/email-media', { method: 'POST', body });
  if (res.status === 413)
    throw new Error('That image is too big to upload. Make it smaller first.');
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return ((await res.json()) as { url: string }).url;
}
