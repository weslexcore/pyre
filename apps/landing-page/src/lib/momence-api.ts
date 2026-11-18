// Base URL of the Momence v1 API (the host-token API behind events, teachers
// and products).
//
// Overridable with MOMENCE_API_BASE so the E2E suite can point the server-side
// fetches at its mock upstream (apps/landing-page/e2e/mock-server). Unset in
// every deployed environment, where this is always the real API.

const DEFAULT_MOMENCE_API_BASE = 'https://api.momence.com/api/v1';

function override(): string | undefined {
  const fromImportMeta = import.meta.env.MOMENCE_API_BASE as string | undefined;
  if (fromImportMeta) return fromImportMeta;
  // `process` doesn't exist when a module that imports this lands in a
  // client bundle.
  return typeof process !== 'undefined' ? process.env.MOMENCE_API_BASE : undefined;
}

export const MOMENCE_API_BASE: string = override() || DEFAULT_MOMENCE_API_BASE;
