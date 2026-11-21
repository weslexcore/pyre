// The first render of an island reading through useCachedJson must match the
// HTML the server rendered for it, or React throws the tree away on hydration
// (and logs an error). The server never holds a cached entry, so even with a
// warm cache — a ClientRouter navigation to a page whose read was warmed, or
// back to the page just left — the first render shows the loading state; the
// cached entry goes in before paint, from a layout effect.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { primeJson, useCachedJson } from './cachedJson';

function Island({ url }: { url: string }) {
  const { data, loading } = useCachedJson<{ notes: string[] }>(url);
  if (loading) return <p>Loading…</p>;
  return (
    <ul>
      {data?.notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

describe('useCachedJson first render', () => {
  it('matches the server even when the cache is warm', () => {
    const url = '/api/admin/shift-notes?hydration-test';
    const cold = renderToStaticMarkup(<Island url={url} />);
    primeJson(url, { notes: ['Filters are low'] });
    expect(renderToStaticMarkup(<Island url={url} />)).toBe(cold);
    expect(cold).toBe('<p>Loading…</p>');
  });
});
