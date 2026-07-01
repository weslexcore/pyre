import * as QRCode from 'qrcode';
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
  medium: ['social', 'paid_social', 'email', 'cpc', 'referral', 'qr', 'print'],
  campaign: [],
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
  medium:
    'The channel type. social = organic posts; paid_social = boosted/ads; cpc = paid search; email; referral. GA4 groups reports by these values.',
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

// Mirror of @pyre/webhook-core's slugifyCampaign — used to preview the campaign
// a link will be filed under (grouping is keyed off the utm_campaign value).
function slugifyCampaign(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

// Shared campaign shapes returned by /api/admin/utm-campaigns (mirror the
// @pyre/webhook-core store; kept local so this client island stays server-free).
interface SavedCampaign {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  createdBy: string;
}

interface SavedLink {
  id: string;
  campaignId: string;
  label: string;
  url: string;
  destination: string;
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  createdAt: number;
  createdBy: string;
}

interface CampaignWithLinks {
  campaign: SavedCampaign;
  links: SavedLink[];
}

/** Renders a scannable QR for `url` with a download-as-PNG link. */
function QrCode({ url, filename }: { url: string; filename: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } })
      .then((out) => {
        if (!cancelled) setDataUrl(out);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!dataUrl) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={dataUrl}
        alt="QR code for the generated link"
        className="w-40 h-40 rounded bg-white p-2"
      />
      <a
        href={dataUrl}
        download={`${filename}.png`}
        className="text-xs font-mono-bold uppercase tracking-wide text-white/50 hover:text-[var(--pyre-creme)] transition-colors"
      >
        Download PNG
      </a>
    </div>
  );
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

  // Shared campaigns (KV-backed, visible to every admin). Which campaign a link
  // belongs to is determined by its utm_campaign value — no separate picker.
  const [campaigns, setCampaigns] = useState<CampaignWithLinks[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const suggestions = useMemo<FieldPresets>(() => {
    // Surface existing shared campaign slugs first so the team reuses the same
    // campaign names (grouping is keyed off utm_campaign).
    const sharedCampaigns = (campaigns ?? []).map(({ campaign }) => campaign.slug);
    return {
      source: mergeSuggestions(CURATED_PRESETS.source, customPresets.source),
      medium: mergeSuggestions(CURATED_PRESETS.medium, customPresets.medium),
      campaign: mergeSuggestions(sharedCampaigns, customPresets.campaign),
      term: mergeSuggestions(CURATED_PRESETS.term, customPresets.term),
      content: mergeSuggestions(CURATED_PRESETS.content, customPresets.content),
    };
  }, [customPresets, campaigns]);

  // Load the shared campaign list once the admin gate passes.
  const refreshCampaigns = useCallback(async () => {
    setCampaignsError(null);
    try {
      const res = await fetch('/api/admin/utm-campaigns');
      if (!res.ok) throw new Error(`Failed to load campaigns (${res.status})`);
      const json = (await res.json()) as { campaigns: CampaignWithLinks[] };
      setCampaigns(json.campaigns);
    } catch (err) {
      setCampaignsError(err instanceof Error ? err.message : 'Failed to load campaigns');
      setCampaigns([]);
    }
  }, []);

  useEffect(() => {
    if (gate !== 'ok') return;
    void refreshCampaigns();
  }, [gate, refreshCampaigns]);

  // The campaign a link belongs to is derived from its utm_campaign value; the
  // server upserts a campaign for that slug and files the link under it.
  const campaignSlug = useMemo(() => slugifyCampaign(utm.campaign), [utm.campaign]);

  const saveLink = useCallback(async () => {
    if (!generatedUrl || !campaignSlug) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/admin/utm-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: linkLabel.trim(),
          url: generatedUrl,
          destination,
          ...utm,
        }),
      });
      if (!res.ok) throw new Error(`Could not save link (${res.status})`);
      const { link } = (await res.json()) as { link: SavedLink };
      setLinkLabel('');
      setExpanded((prev) => ({ ...prev, [link.campaignId]: true }));
      await refreshCampaigns();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save link');
    } finally {
      setSaving(false);
    }
  }, [generatedUrl, campaignSlug, linkLabel, destination, utm, refreshCampaigns]);

  const deleteLink = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/admin/utm-links?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshCampaigns();
      } catch {
        // Best-effort; the list refresh will reflect the true state.
      }
    },
    [refreshCampaigns]
  );

  const deleteCampaign = useCallback(
    async (id: string, name: string) => {
      if (!window.confirm(`Delete campaign "${name}" and all its links?`)) return;
      try {
        await fetch(`/api/admin/utm-campaigns?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshCampaigns();
      } catch {
        // Best-effort; the list refresh will reflect the true state.
      }
    },
    [refreshCampaigns]
  );

  const copyLink = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard not available
    }
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

        {/* QR code for the generated link */}
        {generatedUrl && (
          <div className="mt-4 flex justify-center">
            <QrCode url={generatedUrl} filename={utm.campaign.trim() || 'pyre-utm'} />
          </div>
        )}
      </div>

      {/* Save to a shared campaign — grouped by the utm_campaign value */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <FieldLabel info="Saves this link into the shared campaign named by its utm_campaign value, so the whole team can reuse it.">
          Save to campaign
        </FieldLabel>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Label (optional) — e.g. Instagram bio"
            className={inputClass}
          />
          <button
            type="button"
            onClick={saveLink}
            disabled={!generatedUrl || !campaignSlug || saving}
            className="shrink-0 px-4 py-2 rounded font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap"
          >
            {saving ? 'Saving…' : 'Save link'}
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">
          {campaignSlug ? (
            <>
              Filed under campaign <span className="font-mono text-white/70">{campaignSlug}</span>.
            </>
          ) : (
            <>Set a utm_campaign value above to choose which campaign this link joins.</>
          )}
        </p>
        {saveError && <p className="mt-1 text-sm text-[var(--pyre-red)]">{saveError}</p>}
      </div>

      {/* Shared campaigns */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-primary-semibold text-lg text-[var(--pyre-creme)]">Campaigns</h2>
          {campaigns && (
            <span className="text-xs text-white/40">
              {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {campaignsError && <p className="text-sm text-[var(--pyre-red)] mb-3">{campaignsError}</p>}
        {campaigns && campaigns.length === 0 && (
          <p className="text-sm text-white/40">No campaigns yet. Save a link above to start one.</p>
        )}

        <div className="space-y-2">
          {campaigns?.map(({ campaign, links }) => {
            const isOpen = expanded[campaign.id] ?? false;
            return (
              <div key={campaign.id} className="rounded border border-white/10 bg-white/5">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [campaign.id]: !isOpen }))}
                    className="flex-1 flex items-center gap-2 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="text-white/40 text-xs w-3">{isOpen ? '▾' : '▸'}</span>
                    <span className="font-mono-bold text-sm text-[var(--pyre-creme)]">
                      {campaign.name}
                    </span>
                    <span className="text-xs text-white/40">
                      {links.length} link{links.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCampaign(campaign.id, campaign.name)}
                    aria-label={`Delete campaign ${campaign.name}`}
                    className="shrink-0 px-2 text-white/30 hover:text-[var(--pyre-red)] transition-colors"
                  >
                    Delete
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-white/10 divide-y divide-white/5">
                    {links.length === 0 && (
                      <p className="px-3 py-3 text-sm text-white/40">No links saved yet.</p>
                    )}
                    {links.map((link) => (
                      <div key={link.id} className="px-3 py-3 flex flex-col sm:flex-row gap-3">
                        <div className="flex-1 min-w-0">
                          {link.label && (
                            <p className="text-sm text-[var(--pyre-creme)] mb-0.5">{link.label}</p>
                          )}
                          <p className="text-xs font-mono text-white/50 break-all">{link.url}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => copyLink(link.url)}
                              className="px-2 py-1 rounded border border-white/20 text-xs text-white/60 hover:text-white hover:border-white/40 transition-colors"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteLink(link.id)}
                              className="px-2 py-1 rounded border border-white/20 text-xs text-white/40 hover:text-[var(--pyre-red)] hover:border-[var(--pyre-red)]/50 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="shrink-0">
                          <QrCode
                            url={link.url}
                            filename={`${campaign.slug}-${link.id.slice(0, 8)}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
