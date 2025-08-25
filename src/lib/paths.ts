/**
 * Prepends the site's base URL (from Astro's BASE_URL env) to a given path.
 * Ensures the path does not start with a leading slash to avoid double slashes.
 * Example: withBase('/about') -> '/pyre/about' (if BASE_URL is '/pyre/')
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}${path}`.replace(/\/\//g, '/');
}
