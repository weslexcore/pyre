// Jev (@pyre/jev) for this app: the one place that knows where the AI Gateway
// credentials come from. Any feature that asks Jev something passes
// jevOptions() through — askJev(state, questions, jevOptions()) — and treats
// null as "Jev is off here".
//
// Deployed, the Gateway authenticates with Vercel OIDC and needs no key.
// Locally, set AI_GATEWAY_API_KEY in .env.local; Astro puts it in
// import.meta.env rather than process.env, where the AI SDK would look, so it
// is passed along explicitly.

import { type JevOptions, jevAvailable } from '@pyre/jev';

/** Options for a Jev call from this app, or null when Jev cannot be reached. */
export function jevOptions(): JevOptions | null {
  // process.env fallback: vars added after the cached build only exist at runtime.
  const apiKey = import.meta.env.AI_GATEWAY_API_KEY ?? process.env.AI_GATEWAY_API_KEY;
  if (!jevAvailable(apiKey)) return null;
  return apiKey ? { apiKey } : {};
}
