// Email-address and name normalization shared by server and client code:
// every comparison, lookup key and stored actor uses the same lowercased,
// trimmed form. Pure — safe in client bundles.

/** Lowercased and trimmed; '' for a missing address. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** The first word of a display name — how a greeting addresses someone. */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
