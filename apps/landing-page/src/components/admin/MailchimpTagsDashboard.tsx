import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface MailchimpTag {
  id: number;
  name: string;
  member_count: number;
}

interface TagsResponse {
  tags: MailchimpTag[];
}

export function MailchimpTagsDashboard() {
  const { isAuthenticated, user, loading: authLoading, login } = useAuth();

  const [tags, setTags] = useState<MailchimpTag[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/mailchimp-tags');
      if (res.status === 401) {
        setError('not_authenticated');
        return;
      }
      if (res.status === 403) {
        setError('forbidden');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed to fetch tags (${res.status})`);
        return;
      }
      const json: TagsResponse = await res.json();
      setTags(json.tags);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTags();
    }
  }, [isAuthenticated, fetchTags]);

  const copyId = useCallback(async (id: number) => {
    try {
      await navigator.clipboard.writeText(String(id));
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    } catch {
      // Clipboard not available
    }
  }, []);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--pyre-red)] border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">Sign In</h1>
        <p className="text-white/60 mb-6">Log in to continue.</p>
        <button
          type="button"
          onClick={() => login({ returnUrl: '/admin/mailchimp-tags' })}
          className="px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log In
        </button>
      </div>
    );
  }

  if (error === 'forbidden') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Unauthorized
        </h1>
        <p className="text-white/60">You do not have access to this page.</p>
      </div>
    );
  }

  const lowerSearch = search.toLowerCase();
  const filtered = tags?.filter((tag) => {
    if (!lowerSearch) return true;
    return tag.name.toLowerCase().includes(lowerSearch) || String(tag.id).includes(lowerSearch);
  });

  return (
    <div className="max-w-4xl mx-auto px-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-primary-semibold text-2xl text-[var(--pyre-creme)]">
            Mailchimp Tags
          </h1>
          <p className="text-xs text-white/40 mt-1">
            All static segments (tags) in the configured audience. Click an ID to copy it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchTags()}
          disabled={loading}
          className="px-3 py-1.5 rounded text-xs font-mono-bold uppercase tracking-wide border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="mt-4 mb-4">
        <input
          type="text"
          placeholder="Filter by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30"
        />
      </div>

      {error && error !== 'forbidden' && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-900/40 rounded text-sm text-[var(--pyre-red)]">
          {error}
        </div>
      )}

      {tags && tags.length === 0 && (
        <div className="text-center py-16 text-white/40">No tags found in this audience.</div>
      )}

      {filtered && filtered.length === 0 && tags && tags.length > 0 && (
        <div className="text-center py-8 text-white/40">No results matching "{search}"</div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3 text-right">Members</th>
              </tr>
            </thead>
            <tbody className="text-[var(--pyre-creme)]">
              {filtered.map((tag) => (
                <tr key={tag.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">{tag.name}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => copyId(tag.id)}
                      title="Copy ID"
                      className="font-mono text-xs text-white/70 hover:text-[var(--pyre-creme)] transition-colors"
                    >
                      {tag.id}
                      <span className="ml-2 text-white/30">
                        {copiedId === tag.id ? 'Copied' : 'Copy'}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/50">
                    {tag.member_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tags && (
        <div className="mt-4 text-xs text-white/40">
          {filtered?.length ?? 0} of {tags.length} tag{tags.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
