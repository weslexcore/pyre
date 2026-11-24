// Uploads a photo for an email from the browser (/api/admin/email-media) and
// answers with its public address.

import { emailMediaProblem } from '@/lib/email/media';
import { ApiError, readError } from './api';

export async function uploadEmailImage(file: File): Promise<string> {
  const problem = emailMediaProblem(file);
  if (problem) throw new Error(problem);
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/admin/email-media', { method: 'POST', body });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return ((await res.json()) as { url: string }).url;
}
