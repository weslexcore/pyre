import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { withBase } from '@/lib/paths';
import type { EventItem } from '@/lib/types';

interface BlogPostRef {
  slug: string;
  title: string;
}

interface UtmAssistProps {
  origin: string;
  blogPosts: BlogPostRef[];
}

type GateState = 'checking' | 'ok' | 'unauthenticated' | 'forbidden' | 'error';

type Destination = 'home' | 'events' | 'blog' | 'event';

interface UtmFields {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
}

const EMPTY_UTM: UtmFields = {
  source: '',
  medium: '',
  campaign: '',
  term: '',
  content: '',
};

const SOURCE_PRESETS = [
  'instagram',
  'facebook',
  'email',
  'newsletter',
  'qr',
  'print',
  'google',
  'linkedin',
];

const MEDIUM_PRESETS = ['social', 'email', 'cpc', 'qr', 'print', 'referral', 'organic'];

/**
 * Builds an absolute, UTM-tagged URL for the given internal path.
 * Empty UTM fields are omitted. Uses the URL API so params merge cleanly with
 * any existing query string (e.g. the `?event=<id>` deep-link).
 */
function buildUrl(origin: string, path: string, utm: UtmFields): string {
  const url = new URL(withBase(path), origin);
  const params: Array<[string, string]> = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
    ['utm_term', utm.term],
    ['utm_content', utm.content],
  ];
  for (const [key, value] of params) {
    const trimmed = value.trim();
    if (trimmed) {
      url.searchParams.set(key, trimmed);
    }
  }
  return url.toString();
}

export function UtmAssist({ origin, blogPosts }: UtmAssistProps) {
  const { isAuthenticated, user, loading: authLoading, login } = useAuth();
  const [gate, setGate] = useState<GateState>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [destination, setDestination] = useState<Destination>('home');
  const [blogSlug, setBlogSlug] = useState<string>(blogPosts[0]?.slug ?? '');
  const [eventId, setEventId] = useState<string>('');
  const [utm, setUtm] = useState<UtmFields>(EMPTY_UTM);

  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !user) {
      setGate('unauthenticated');
      return;
    }

    let cancelled = false;
    setGate('checking');
    fetch('/api/admin/check')
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setGate('unauthenticated');
          return;
        }
        if (res.status === 403) {
          setGate('forbidden');
          return;
        }
        if (!res.ok) {
          setErrorMessage(`Admin check failed (${res.status})`);
          setGate('error');
          return;
        }
        setGate('ok');
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMessage('Network error');
        setGate('error');
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user]);

  // Lazily load events the first time the "Specific event" destination is chosen.
  useEffect(() => {
    if (destination !== 'event' || events !== null || eventsLoading) return;

    let cancelled = false;
    setEventsLoading(true);
    setEventsError(null);
    fetch('/api/events?all=1')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
        const json = (await res.json()) as { events: EventItem[] };
        if (cancelled) return;
        setEvents(json.events);
        setEventId((current) => current || json.events[0]?.id || '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEventsError(err instanceof Error ? err.message : 'Failed to load events');
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [destination, events, eventsLoading]);

  const generatedUrl = useMemo(() => {
    switch (destination) {
      case 'home':
        return buildUrl(origin, '/', utm);
      case 'events':
        return buildUrl(origin, '/events', utm);
      case 'blog':
        return blogSlug ? buildUrl(origin, `/blog/${blogSlug}`, utm) : '';
      case 'event':
        return eventId ? buildUrl(origin, `/events?event=${encodeURIComponent(eventId)}`, utm) : '';
      default:
        return '';
    }
  }, [destination, origin, utm, blogSlug, eventId]);

  const copyUrl = useCallback(async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available
    }
  }, [generatedUrl]);

  const setUtmField = useCallback((field: keyof UtmFields, value: string) => {
    setUtm((current) => ({ ...current, [field]: value }));
  }, []);

  if (authLoading || gate === 'checking') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--pyre-red)] border-t-transparent" />
      </div>
    );
  }

  if (gate === 'unauthenticated') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">Sign In</h1>
        <p className="text-white/60 mb-6">Log in to continue.</p>
        <button
          type="button"
          onClick={() => login({ returnUrl: '/admin/utm-assist' })}
          className="px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
        >
          Log In
        </button>
      </div>
    );
  }

  if (gate === 'forbidden') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <h1 className="font-primary-semibold text-2xl mb-4 text-[var(--pyre-creme)]">
          Unauthorized
        </h1>
        <p className="text-white/60">You do not have access to this page.</p>
      </div>
    );
  }

  if (gate === 'error') {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        <p className="text-[var(--pyre-red)]">{errorMessage ?? 'Something went wrong.'}</p>
      </div>
    );
  }

  const inputClass =
    'w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';
  const labelClass = 'block text-xs font-mono-bold uppercase tracking-wide text-white/40 mb-1.5';

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="mb-8">
        <h1 className="font-primary-semibold text-2xl text-[var(--pyre-creme)]">UTM Assist</h1>
        <p className="text-xs text-white/40 mt-1">
          Build a tracked link to the site, a blog post, the events page, or a specific event.
        </p>
      </div>

      {/* Destination */}
      <div className="mb-6">
        <span className={labelClass}>Destination</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ['home', 'Home'],
              ['events', 'Events page'],
              ['blog', 'Blog post'],
              ['event', 'Specific event'],
            ] as Array<[Destination, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDestination(value)}
              className={`px-3 py-2 rounded text-xs font-mono-bold uppercase tracking-wide border transition-colors ${
                destination === value
                  ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
                  : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Blog post selector */}
      {destination === 'blog' && (
        <div className="mb-6">
          <label htmlFor="utm-blog" className={labelClass}>
            Blog post
          </label>
          {blogPosts.length === 0 ? (
            <p className="text-sm text-white/40">No published blog posts found.</p>
          ) : (
            <select
              id="utm-blog"
              value={blogSlug}
              onChange={(e) => setBlogSlug(e.target.value)}
              className={inputClass}
            >
              {blogPosts.map((post) => (
                <option key={post.slug} value={post.slug}>
                  {post.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Event selector */}
      {destination === 'event' && (
        <div className="mb-6">
          <label htmlFor="utm-event" className={labelClass}>
            Event
          </label>
          {eventsLoading && <p className="text-sm text-white/40">Loading events…</p>}
          {eventsError && <p className="text-sm text-[var(--pyre-red)]">{eventsError}</p>}
          {events && events.length === 0 && (
            <p className="text-sm text-white/40">No upcoming events found.</p>
          )}
          {events && events.length > 0 && (
            <select
              id="utm-event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className={inputClass}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                  {event.date ? ` — ${event.date}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* UTM fields */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label htmlFor="utm-source" className={labelClass}>
            utm_source
          </label>
          <input
            id="utm-source"
            list="utm-source-presets"
            value={utm.source}
            onChange={(e) => setUtmField('source', e.target.value)}
            placeholder="e.g. instagram"
            className={inputClass}
          />
          <datalist id="utm-source-presets">
            {SOURCE_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="utm-medium" className={labelClass}>
            utm_medium
          </label>
          <input
            id="utm-medium"
            list="utm-medium-presets"
            value={utm.medium}
            onChange={(e) => setUtmField('medium', e.target.value)}
            placeholder="e.g. social"
            className={inputClass}
          />
          <datalist id="utm-medium-presets">
            {MEDIUM_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="utm-campaign" className={labelClass}>
            utm_campaign
          </label>
          <input
            id="utm-campaign"
            value={utm.campaign}
            onChange={(e) => setUtmField('campaign', e.target.value)}
            placeholder="e.g. summer-launch"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="utm-term" className={labelClass}>
            utm_term
          </label>
          <input
            id="utm-term"
            value={utm.term}
            onChange={(e) => setUtmField('term', e.target.value)}
            placeholder="optional"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="utm-content" className={labelClass}>
            utm_content
          </label>
          <input
            id="utm-content"
            value={utm.content}
            onChange={(e) => setUtmField('content', e.target.value)}
            placeholder="optional"
            className={inputClass}
          />
        </div>
      </div>

      {/* Generated link */}
      <div>
        <span className={labelClass}>Generated link</span>
        <div className="flex flex-col sm:flex-row gap-2">
          <output className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-sm font-mono text-[var(--pyre-creme)] break-all min-h-[2.5rem]">
            {generatedUrl || <span className="text-white/30">Select a destination…</span>}
          </output>
          <button
            type="button"
            onClick={copyUrl}
            disabled={!generatedUrl}
            className="px-4 py-2 rounded font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
