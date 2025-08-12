export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalized = typeof path === 'string' ? path.replace(/^\//, '') : '';
  return `${base}${normalized}`;
}


