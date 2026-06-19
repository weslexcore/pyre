import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Curated, built-in presets seeded for the team. Users can add their own on top
// of these (persisted to localStorage); curated ones can't be removed.
const CURATED_PRESETS: Record<keyof UtmFields, string[]> = {
  source: ['instagram', 'facebook', 'email', 'newsletter', 'qr', 'print', 'google', 'linkedin'],
  medium: ['social', 'email', 'cpc', 'qr', 'print', 'referral', 'organic'],
  campaign: ['grand-opening', 'summer-launch', 'membership-drive', 'holiday', 'referral-program'],
  term: [],
  content: ['header', 'footer', 'cta-button', 'bio-link', 'story-link'],
};

// Short explanations surfaced via the info button next to each label.
const FIELD_INFO: Record<string, string> = {
  destination:
    'The page this link opens. The UTM tags below are appended to whichever destination you choose.',
  blog: 'Which published blog article the link opens.',
  event: 'Which upcoming event the link opens. Loaded live from Momence.',
  source:
    'Where the visitor comes from — the platform or referrer. e.g. instagram, newsletter, qr.',
  medium: 'The type of channel the link lives in. e.g. social, email, cpc, print.',
  campaign:
    'The promotion this link belongs to. e.g. summer-launch-2026. Reuse the exact same name across links so reports group them together.',
  term: 'Optional. The paid-search keyword you are bidding on.',
  content: 'Optional. Tells apart two links to the same place. e.g. header-button vs footer-link.',
  link: 'The finished tracked URL. Copy it and share.',
};

// User-created presets are persisted per browser so campaigns/terms can be
// reused with one click (and reused verbatim to avoid typos).
const CUSTOM_PRESETS_KEY = 'pyre-utm-custom-presets';

type FieldPresets = Record<keyof UtmFields, string[]>;

const EMPTY_PRESETS: FieldPresets = {
  source: [],
  medium: [],
  campaign: [],
  term: [],
  content: [],
};

function loadCustomPresets(): FieldPresets {
  if (typeof window === 'undefined') return EMPTY_PRESETS;
  try {
    const raw = window.localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return EMPTY_PRESETS;
    const parsed = JSON.parse(raw) as Partial<FieldPresets>;
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
      source: pick(parsed.source),
      medium: pick(parsed.medium),
      campaign: pick(parsed.campaign),
      term: pick(parsed.term),
      content: pick(parsed.content),
    };
  } catch {
    return EMPTY_PRESETS;
  }
}

function saveCustomPresets(presets: FieldPresets): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Storage unavailable or full — presets are best-effort only.
  }
}

// Combine curated + user presets, de-duped (case-insensitive), curated first.
function mergeSuggestions(curated: string[], custom: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...curated, ...custom]) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/** A label with a hover/tap info button explaining the field. */
function FieldLabel({
  children,
  info,
  htmlFor,
}: {
  children: ReactNode;
  info: string;
  htmlFor?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelClass = 'text-xs font-mono-bold uppercase tracking-wide text-white/40';
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {children}
        </label>
      ) : (
        <span className={labelClass}>{children}</span>
      )}
      <span className="relative inline-flex group">
        <button
          type="button"
          aria-label={`What is ${typeof children === 'string' ? children : 'this field'}?`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onBlur={() => setOpen(false)}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/30 text-[10px] leading-none text-white/50 hover:text-white hover:border-white/60 transition-colors"
        >
          i
        </button>
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-0 top-6 z-20 w-60 rounded border border-white/20 bg-[var(--pyre-black)] px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal leading-snug text-white/70 shadow-lg transition-opacity group-hover:opacity-100 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {info}
        </span>
      </span>
    </div>
  );
}

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
  const [customPresets, setCustomPresets] = useState<FieldPresets>(() => loadCustomPresets());

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
  // A ref guard ensures the fetch fires exactly once and isn't cancelled by the
  // re-render its own setEventsLoading(true) triggers.
  const eventsFetchStarted = useRef(false);
  useEffect(() => {
    if (destination !== 'event' || eventsFetchStarted.current) return;
    eventsFetchStarted.current = true;

    setEventsLoading(true);
    setEventsError(null);
    fetch('/api/events?all=1')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
        const json = (await res.json()) as { events: EventItem[] };
        setEvents(json.events);
        setEventId((current) => current || json.events[0]?.id || '');
      })
      .catch((err: unknown) => {
        setEventsError(err instanceof Error ? err.message : 'Failed to load events');
        eventsFetchStarted.current = false; // allow retry on next selection
      })
      .finally(() => {
        setEventsLoading(false);
      });
  }, [destination]);

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

  // Save the field's current value as a reusable custom preset (persisted).
  const addPreset = useCallback((field: keyof UtmFields, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    setCustomPresets((prev) => {
      const lower = value.toLowerCase();
      // Skip if it already exists as a curated or custom preset.
      const exists = [...CURATED_PRESETS[field], ...prev[field]].some(
        (v) => v.toLowerCase() === lower
      );
      if (exists) return prev;
      const next = { ...prev, [field]: [...prev[field], value] };
      saveCustomPresets(next);
      return next;
    });
  }, []);

  const removePreset = useCallback((field: keyof UtmFields, value: string) => {
    setCustomPresets((prev) => {
      const next = { ...prev, [field]: prev[field].filter((v) => v !== value) };
      saveCustomPresets(next);
      return next;
    });
  }, []);

  const suggestions = useMemo<FieldPresets>(
    () => ({
      source: mergeSuggestions(CURATED_PRESETS.source, customPresets.source),
      medium: mergeSuggestions(CURATED_PRESETS.medium, customPresets.medium),
      campaign: mergeSuggestions(CURATED_PRESETS.campaign, customPresets.campaign),
      term: mergeSuggestions(CURATED_PRESETS.term, customPresets.term),
      content: mergeSuggestions(CURATED_PRESETS.content, customPresets.content),
    }),
    [customPresets]
  );

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
        <FieldLabel info={FIELD_INFO.destination}>Destination</FieldLabel>
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
          <FieldLabel htmlFor="utm-blog" info={FIELD_INFO.blog}>
            Blog post
          </FieldLabel>
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
          <FieldLabel htmlFor="utm-event" info={FIELD_INFO.event}>
            Event
          </FieldLabel>
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
        {(
          [
            ['source', 'utm_source', 'e.g. instagram', false],
            ['medium', 'utm_medium', 'e.g. social', false],
            ['campaign', 'utm_campaign', 'e.g. summer-launch', false],
            ['term', 'utm_term', 'optional', false],
            ['content', 'utm_content', 'optional', true],
          ] as Array<[keyof UtmFields, string, string, boolean]>
        ).map(([field, label, placeholder, fullWidth]) => (
          <div key={field} className={fullWidth ? 'sm:col-span-2' : undefined}>
            <FieldLabel htmlFor={`utm-${field}`} info={FIELD_INFO[field]}>
              {label}
            </FieldLabel>
            <div className="flex gap-2">
              <input
                id={`utm-${field}`}
                list={`utm-${field}-suggestions`}
                value={utm[field]}
                onChange={(e) => setUtmField(field, e.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => addPreset(field, utm[field])}
                disabled={!utm[field].trim()}
                title="Save as preset"
                className="shrink-0 px-3 rounded border border-white/20 text-sm text-white/60 hover:text-white hover:border-white/40 transition-colors disabled:opacity-30"
              >
                + Save
              </button>
            </div>
            {suggestions[field].length > 0 && (
              <datalist id={`utm-${field}-suggestions`}>
                {suggestions[field].map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            )}
            {customPresets[field].length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {customPresets[field].map((preset) => (
                  <span
                    key={preset}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 pl-2 pr-1 py-0.5 text-xs text-white/70"
                  >
                    <button
                      type="button"
                      onClick={() => setUtmField(field, preset)}
                      className="hover:text-[var(--pyre-creme)] transition-colors"
                    >
                      {preset}
                    </button>
                    <button
                      type="button"
                      onClick={() => removePreset(field, preset)}
                      aria-label={`Remove preset ${preset}`}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white/40 hover:text-[var(--pyre-red)] transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Generated link */}
      <div>
        <FieldLabel info={FIELD_INFO.link}>Generated link</FieldLabel>
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
