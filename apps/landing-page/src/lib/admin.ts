export function isAdminEmail(email: string): boolean {
  const adminEmails = import.meta.env.ADMIN_EMAILS ?? '';
  if (!adminEmails) return false;

  const allowlist = adminEmails
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.toLowerCase());
}
