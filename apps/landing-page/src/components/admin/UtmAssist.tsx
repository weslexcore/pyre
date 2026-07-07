import type QRCodeStyling from 'qr-code-styling';
import type { Options as QrCodeStylingOptions } from 'qr-code-styling';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import pyreLogoRaw from '@/assets/logos/pyre_logo.svg?raw';
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

type Destination = 'home' | 'events' | 'blog' | 'event' | 'custom';

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
  source: [
    'sms',
    'instagram',
    'facebook',
    'email',
    'newsletter',
    'qr',
    'print',
    'google',
    'linkedin',
  ],
  medium: ['sms', 'social', 'paid_social', 'email', 'cpc', 'referral', 'qr', 'print'],
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
  customUrl:
    'Any external page (Eventbrite, a partner site…). The generated link routes through pyresauna.com so the click is captured, then forwards here with the UTM tags appended.',
  tracked:
    'The pyresauna.com link to share. Clicks are captured on our domain (with the UTM tags) before forwarding to your URL. You can keep editing the UTM fields — the link updates without recreating it.',
  source:
    'Where the visitor comes from — the platform or referrer. e.g. instagram, newsletter, qr.',
  medium:
    'The channel type. social = organic posts; paid_social = boosted/ads; cpc = paid search; email; referral. GA4 groups reports by these values.',
  campaign:
    'The promotion this link belongs to. e.g. summer-launch-2026. Reuse the exact same name across links so reports group them together.',
  term: 'Optional. The paid-search keyword you are bidding on.',
  content: 'Optional. Tells apart two links to the same place. e.g. header-button vs footer-link.',
  link: 'The finished tracked URL. Copy it and share.',
  shorten:
    'Turns the tracked link into a short pyresauna.com/s/… link. The texted message stays clean while the UTM tags still load on the destination, so attribution keeps working.',
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
 * Appends the non-empty UTM fields to a URL. Uses the URL API so params merge
 * cleanly with any existing query string (e.g. the `?event=<id>` deep-link or
 * an Eventbrite `?aff=` param).
 */
function applyUtm(url: URL, utm: UtmFields): string {
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

/** Builds an absolute, UTM-tagged URL for the given internal path. */
function buildUrl(origin: string, path: string, utm: UtmFields): string {
  return applyUtm(new URL(withBase(path), origin), utm);
}

/**
 * Parses a free-text destination into an http(s) URL, or null when it isn't
 * one (yet). A missing scheme is assumed to be https for convenience.
 */
function parseExternalUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Reject hostnames without a dot ("https://foo") — almost certainly mid-typing.
  if (!url.hostname.includes('.')) return null;
  return url;
}

// Returns '' while the URL is invalid so the copy/QR/short-link sections
// (which all key off generatedUrl) stay hidden until it's usable.
function buildExternalUrl(raw: string, utm: UtmFields): string {
  const parsed = parseExternalUrl(raw);
  return parsed ? applyUtm(parsed, utm) : '';
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

// One row of the "Recent short links" list (mirrors the server ShortLink shape,
// minus fields the UI doesn't render).
interface ShortLinkRow {
  code: string;
  url: string;
  label: string;
  createdAt: number;
  clicks: number;
}

function shortErrorMessage(code: unknown): string {
  switch (code) {
    case 'alias_taken':
      return 'That custom alias is already taken.';
    case 'invalid_alias':
      return 'Alias can only contain letters, numbers, - and _.';
    case 'storage_unavailable':
      return 'Link storage is unavailable right now.';
    case 'invalid_url':
      return 'Short links need a valid http(s) URL.';
    default:
      return 'Failed to create short link.';
  }
}

// ── QR styling ──────────────────────────────────────────────────────────────
// The look of every QR (preview + saved links) is driven by this shared style,
// persisted per-browser so an admin's chosen look sticks between visits.
type DotType = 'square' | 'dots' | 'rounded' | 'extra-rounded' | 'classy' | 'classy-rounded';
type CornerSquareType = 'square' | 'dot' | 'extra-rounded';
type CornerDotType = 'square' | 'dot';

interface QrStyle {
  dark: string;
  light: string;
  transparent: boolean;
  dotType: DotType;
  cornerSquareType: CornerSquareType;
  cornerDotType: CornerDotType;
  size: number;
  margin: number;
  logo: boolean;
}

const DOT_TYPES: DotType[] = [
  'square',
  'dots',
  'rounded',
  'extra-rounded',
  'classy',
  'classy-rounded',
];
const CORNER_SQUARE_TYPES: CornerSquareType[] = ['square', 'dot', 'extra-rounded'];
const CORNER_DOT_TYPES: CornerDotType[] = ['square', 'dot'];

// Pyre brand palette (hex from src/styles/global.css). Offered as one-click
// swatches for the QR dot and background colors.
const PYRE_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'Black', hex: '#23221c' },
  { name: 'Creme', hex: '#f5f1e9' },
  { name: 'Red', hex: '#d15232' },
  { name: 'Blue', hex: '#274868' },
  { name: 'Gold', hex: '#dbb155' },
  { name: 'Sage', hex: '#839770' },
  { name: 'Sky', hex: '#3991b7' },
  { name: 'Burnt orange', hex: '#cb6b34' },
];

const DEFAULT_QR_STYLE: QrStyle = {
  dark: '#23221c', // Pyre black
  light: '#f5f1e9', // Pyre creme
  transparent: false,
  dotType: 'classy-rounded',
  cornerSquareType: 'extra-rounded',
  cornerDotType: 'dot',
  size: 240,
  margin: 8,
  logo: true,
};

// The Pyre mark uses fill="currentColor"; recolor it to `color` and inline it as
// a data URL so qr-code-styling can drop it in the center.
function pyreLogoDataUrl(color: string): string {
  const svg = pyreLogoRaw.replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const QR_STYLE_KEY = 'pyre-utm-qr-style';

// Build a readable download filename, always led by the campaign name, with the
// remaining parts (source/medium/etc.) appended to keep sibling files distinct.
function qrFilename(parts: Array<string | undefined>): string {
  const slug = parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `pyre-qr-${slug}` : 'pyre-qr';
}

function loadQrStyle(): QrStyle {
  if (typeof window === 'undefined') return DEFAULT_QR_STYLE;
  try {
    const raw = window.localStorage.getItem(QR_STYLE_KEY);
    if (!raw) return DEFAULT_QR_STYLE;
    return { ...DEFAULT_QR_STYLE, ...(JSON.parse(raw) as Partial<QrStyle>) };
  } catch {
    return DEFAULT_QR_STYLE;
  }
}

function saveQrStyle(style: QrStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QR_STYLE_KEY, JSON.stringify(style));
  } catch {
    // Best-effort persistence.
  }
}

const TRANSPARENT = 'rgba(0,0,0,0)';

function buildQrOptions(url: string, style: QrStyle): QrCodeStylingOptions {
  return {
    width: style.size,
    height: style.size,
    type: 'canvas',
    data: url,
    margin: style.margin,
    // Highest error correction when a center logo covers part of the code.
    qrOptions: { errorCorrectionLevel: style.logo ? 'H' : 'M' },
    // Recolor the logo to match the dots; empty string clears it on toggle-off.
    image: style.logo ? pyreLogoDataUrl(style.dark) : '',
    imageOptions: { imageSize: 0.3, margin: 4, hideBackgroundDots: true, crossOrigin: 'anonymous' },
    dotsOptions: { color: style.dark, type: style.dotType },
    backgroundOptions: { color: style.transparent ? TRANSPARENT : style.light },
    cornersSquareOptions: { color: style.dark, type: style.cornerSquareType },
    cornersDotOptions: { color: style.dark, type: style.cornerDotType },
  };
}

/**
 * Renders a scannable, styled QR for `url` with a download-as-PNG button.
 * qr-code-styling touches the DOM, so it is imported lazily (client-only) to
 * keep the prerendered Astro shell from importing browser APIs.
 */
function QrCode({ url, filename, style }: { url: string; filename: string; style: QrStyle }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<QRCodeStyling | null>(null);
  const [ready, setReady] = useState(false);

  const options = useMemo(() => buildQrOptions(url, style), [url, style]);

  // Instantiate once on mount (browser only). Options are applied by the update
  // effect below, so this intentionally runs a single time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only init
  useEffect(() => {
    let cancelled = false;
    import('qr-code-styling').then((mod) => {
      if (cancelled) return;
      const QRCodeStylingCtor = mod.default;
      instanceRef.current = new QRCodeStylingCtor(options);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        instanceRef.current.append(containerRef.current);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render whenever the URL or style changes.
  useEffect(() => {
    if (ready) instanceRef.current?.update(options);
  }, [ready, options]);

  const download = useCallback(() => {
    void instanceRef.current?.download({ name: filename, extension: 'png' });
  }, [filename]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className="overflow-hidden rounded [&>canvas]:block" />
      <button
        type="button"
        onClick={download}
        className="text-xs font-mono-bold uppercase tracking-wide text-white/50 hover:text-[var(--pyre-creme)] transition-colors"
      >
        Download PNG
      </button>
    </div>
  );
}

/** Compact controls that mutate the shared QR style. */
function QrStyleControls({
  style,
  onChange,
}: {
  style: QrStyle;
  onChange: (next: QrStyle) => void;
}) {
  const set = <K extends keyof QrStyle>(key: K, value: QrStyle[K]) =>
    onChange({ ...style, [key]: value });

  const selectClass =
    'w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';
  const labelClass = 'text-[10px] font-mono-bold uppercase tracking-wide text-white/40 mb-1 block';

  // One-click Pyre brand-color swatches for a color field.
  const Swatches = ({ onPick }: { onPick: (hex: string) => void }) => (
    <div className="mt-1 flex flex-wrap gap-1">
      {PYRE_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.name}
          aria-label={c.name}
          onClick={() => onPick(c.hex)}
          style={{ backgroundColor: c.hex }}
          className="h-4 w-4 rounded-sm border border-white/25 transition-transform hover:scale-110"
        />
      ))}
    </div>
  );

  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 rounded border border-white/10 bg-white/5 p-3">
      <div>
        <span className={labelClass}>Dot color</span>
        <input
          type="color"
          value={style.dark}
          onChange={(e) => set('dark', e.target.value)}
          className="h-8 w-full rounded bg-transparent"
          aria-label="Dot color"
        />
        <Swatches onPick={(hex) => set('dark', hex)} />
      </div>
      <div>
        <span className={labelClass}>Background</span>
        <input
          type="color"
          value={style.light}
          onChange={(e) => set('light', e.target.value)}
          disabled={style.transparent}
          className="h-8 w-full rounded bg-transparent disabled:opacity-30"
          aria-label="Background color"
        />
        <Swatches onPick={(hex) => set('light', hex)} />
      </div>
      <div className="flex flex-col justify-end gap-1.5 pb-1.5">
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input
            type="checkbox"
            checked={style.transparent}
            onChange={(e) => set('transparent', e.target.checked)}
          />
          Transparent bg
        </label>
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input
            type="checkbox"
            checked={style.logo}
            onChange={(e) => set('logo', e.target.checked)}
          />
          Center logo
        </label>
      </div>
      <div>
        <span className={labelClass}>Dot shape</span>
        <select
          value={style.dotType}
          onChange={(e) => set('dotType', e.target.value as DotType)}
          className={selectClass}
          aria-label="Dot shape"
        >
          {DOT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelClass}>Corner shape</span>
        <select
          value={style.cornerSquareType}
          onChange={(e) => set('cornerSquareType', e.target.value as CornerSquareType)}
          className={selectClass}
          aria-label="Corner shape"
        >
          {CORNER_SQUARE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelClass}>Corner dot</span>
        <select
          value={style.cornerDotType}
          onChange={(e) => set('cornerDotType', e.target.value as CornerDotType)}
          className={selectClass}
          aria-label="Corner dot shape"
        >
          {CORNER_DOT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelClass}>Size {style.size}px</span>
        <input
          type="range"
          min={120}
          max={600}
          step={20}
          value={style.size}
          onChange={(e) => set('size', Number(e.target.value))}
          className="w-full"
          aria-label="Size"
        />
      </div>
      <div>
        <span className={labelClass}>Quiet zone {style.margin}</span>
        <input
          type="range"
          min={0}
          max={40}
          step={2}
          value={style.margin}
          onChange={(e) => set('margin', Number(e.target.value))}
          className="w-full"
          aria-label="Quiet zone margin"
        />
      </div>
      <div className="flex items-end pb-0.5">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_QR_STYLE)}
          className="text-[10px] font-mono-bold uppercase tracking-wide text-white/40 hover:text-white transition-colors"
        >
          Reset
        </button>
      </div>
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
  const [customUrl, setCustomUrl] = useState<string>('');
  // External destinations route through /s/<code> so the click is captured on
  // our domain before redirecting. `forDest` pins the code to the bare
  // destination it was minted for — editing the URL invalidates it, editing
  // UTM fields doesn't (the params ride the tracked link's query string).
  const [tracked, setTracked] = useState<{
    code: string;
    shortUrl: string;
    forDest: string;
  } | null>(null);
  const [utm, setUtm] = useState<UtmFields>(EMPTY_UTM);

  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [customPresets, setCustomPresets] = useState<FieldPresets>(() => loadCustomPresets());

  // Shared QR look (persisted per browser), plus a toggle for the style panel.
  const [qrStyle, setQrStyle] = useState<QrStyle>(() => loadQrStyle());
  const [showQrStyle, setShowQrStyle] = useState(false);
  const updateQrStyle = useCallback((next: QrStyle) => {
    setQrStyle(next);
    saveQrStyle(next);
  }, []);

  // Shared campaigns (KV-backed, visible to every admin). Which campaign a link
  // belongs to is determined by its utm_campaign value — no separate picker.
  const [campaigns, setCampaigns] = useState<CampaignWithLinks[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Inline relabel of a saved campaign link, and per-link QR visibility (QRs are
  // hidden by default and revealed on demand to keep long campaigns light).
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkLabel, setEditLinkLabel] = useState('');
  const [shownQr, setShownQr] = useState<Record<string, boolean>>({});

  // Short-link creation + recent-links list. The result/error carry the exact URL
  // they belong to (`forUrl`) so they auto-hide once the built URL changes.
  const [shortLabel, setShortLabel] = useState('');
  const [shortAlias, setShortAlias] = useState('');
  const [shortResult, setShortResult] = useState<{ shortUrl: string; forUrl: string } | null>(null);
  const [shortLoading, setShortLoading] = useState(false);
  const [shortError, setShortError] = useState<{ message: string; forUrl: string } | null>(null);
  const [shortCopied, setShortCopied] = useState(false);
  const [recent, setRecent] = useState<ShortLinkRow[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

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

  // The bare (untagged) external destination, and the same with UTM params —
  // the latter is what gets stored behind the tracked link's short code.
  const bareCustom = useMemo(() => parseExternalUrl(customUrl)?.toString() ?? '', [customUrl]);
  const externalTagged = useMemo(
    () => (destination === 'custom' ? buildExternalUrl(customUrl, utm) : ''),
    [destination, customUrl, utm]
  );
  const trackedActive =
    destination === 'custom' && tracked?.forDest === bareCustom ? tracked : null;

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
      case 'custom':
        // The shareable link is on our domain; the UTM params ride its query
        // string and are passed through to the destination at redirect time.
        return trackedActive ? applyUtm(new URL(trackedActive.shortUrl), utm) : '';
      default:
        return '';
    }
  }, [destination, origin, utm, blogSlug, eventId, trackedActive]);

  // The URL the short-link section acts on: custom destinations shorten the
  // UTM-tagged external URL; everything else shortens the generated link itself.
  const shortSource = destination === 'custom' ? externalTagged : generatedUrl;

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
      // Remove from view immediately; only re-sync from the server if the
      // delete fails (an immediate refetch can briefly return the stale row).
      setCampaigns((prev) =>
        prev ? prev.map((c) => ({ ...c, links: c.links.filter((l) => l.id !== id) })) : prev
      );
      try {
        const res = await fetch(`/api/admin/utm-links?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      } catch {
        await refreshCampaigns();
      }
    },
    [refreshCampaigns]
  );

  const deleteCampaign = useCallback(
    async (id: string, name: string) => {
      if (!window.confirm(`Delete campaign "${name}" and all its links?`)) return;
      setCampaigns((prev) => (prev ? prev.filter((c) => c.campaign.id !== id) : prev));
      try {
        const res = await fetch(`/api/admin/utm-campaigns?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      } catch {
        await refreshCampaigns();
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

  const startEditLink = useCallback((link: SavedLink) => {
    setEditingLinkId(link.id);
    setEditLinkLabel(link.label);
  }, []);

  const cancelEditLink = useCallback(() => {
    setEditingLinkId(null);
    setEditLinkLabel('');
  }, []);

  // Relabel a saved campaign link, then patch the new label into local state.
  const saveEditLink = useCallback(
    async (id: string) => {
      const label = editLinkLabel.trim();
      try {
        const res = await fetch('/api/admin/utm-links', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, label }),
        });
        if (!res.ok) throw new Error();
        setCampaigns((prev) =>
          prev
            ? prev.map((c) => ({
                ...c,
                links: c.links.map((l) => (l.id === id ? { ...l, label } : l)),
              }))
            : prev
        );
      } catch {
        // Leave the link unchanged on failure.
      } finally {
        setEditingLinkId(null);
        setEditLinkLabel('');
      }
    },
    [editLinkLabel]
  );

  const toggleQr = useCallback((id: string) => {
    setShownQr((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await fetch('/api/admin/shortlinks?limit=25');
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { links?: ShortLinkRow[] };
      setRecent(Array.isArray(data.links) ? data.links : []);
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const toggleRecent = useCallback(() => {
    setRecentOpen((open) => {
      const next = !open;
      if (next && recent === null) void loadRecent();
      return next;
    });
  }, [recent, loadRecent]);

  const createShort = useCallback(async () => {
    // For a custom destination the short code IS the tracked link's backbone,
    // so it's minted from the UTM-tagged external URL (the params are also
    // baked into storage so the bare /s/<code> keeps attribution in SMS).
    const isCustom = destination === 'custom';
    const forUrl = shortSource;
    if (!forUrl) return;
    setShortLoading(true);
    setShortError(null);
    setShortResult(null);
    try {
      const res = await fetch('/api/admin/shortlinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Tracked links are created inline (no label/alias inputs in that flow),
        // so the campaign name doubles as the label in the recent-links list.
        body: JSON.stringify(
          isCustom
            ? { url: forUrl, label: utm.campaign.trim() || undefined }
            : {
                url: forUrl,
                label: shortLabel.trim() || undefined,
                alias: shortAlias.trim() || undefined,
              }
        ),
      });
      const data = (await res.json()) as { shortUrl?: string; code?: string; error?: string };
      if (!res.ok || !data.shortUrl || !data.code) throw new Error(shortErrorMessage(data.error));
      if (isCustom) {
        setTracked({ code: data.code, shortUrl: data.shortUrl, forDest: bareCustom });
      }
      setShortResult({ shortUrl: data.shortUrl, forUrl });
      setShortAlias('');
      if (recent !== null) void loadRecent();
    } catch (err) {
      setShortError({
        message: err instanceof Error ? err.message : shortErrorMessage(undefined),
        forUrl,
      });
    } finally {
      setShortLoading(false);
    }
  }, [
    destination,
    shortSource,
    bareCustom,
    utm.campaign,
    shortLabel,
    shortAlias,
    recent,
    loadRecent,
  ]);

  const copyShort = useCallback(async () => {
    if (!shortResult) return;
    try {
      await navigator.clipboard.writeText(shortResult.shortUrl);
      setShortCopied(true);
      setTimeout(() => setShortCopied(false), 1500);
    } catch {
      // Clipboard not available
    }
  }, [shortResult]);

  const copyRow = useCallback(async (code: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch {
      // Clipboard not available
    }
  }, []);

  const startEditRow = useCallback((row: ShortLinkRow) => {
    setEditingCode(row.code);
    setEditLabel(row.label);
  }, []);

  const cancelEditRow = useCallback(() => {
    setEditingCode(null);
    setEditLabel('');
  }, []);

  // Rename/retag: persist the new label, then patch it into the local list.
  const saveEditRow = useCallback(
    async (code: string) => {
      const label = editLabel.trim();
      try {
        const res = await fetch('/api/admin/shortlinks', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, label }),
        });
        if (!res.ok) throw new Error();
        setRecent((prev) => prev?.map((r) => (r.code === code ? { ...r, label } : r)) ?? prev);
      } catch {
        // Leave the row unchanged on failure.
      } finally {
        setEditingCode(null);
        setEditLabel('');
      }
    },
    [editLabel]
  );

  const deleteRow = useCallback(
    async (code: string) => {
      if (!window.confirm(`Delete short link /s/${code}? Any texts using it will stop working.`)) {
        return;
      }
      // Remove from view immediately; only re-sync if the delete fails.
      setRecent((prev) => prev?.filter((r) => r.code !== code) ?? prev);
      try {
        const res = await fetch(`/api/admin/shortlinks?code=${encodeURIComponent(code)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error();
      } catch {
        void loadRecent();
      }
    },
    [loadRecent]
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
          Build a tracked link to the site, a blog post, an event, or any external URL.
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
              ['custom', 'Custom URL'],
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
                  {event.time ? ` at ${event.time}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Custom external URL */}
      {destination === 'custom' && (
        <div className="mb-6">
          <FieldLabel htmlFor="utm-custom-url" info={FIELD_INFO.customUrl}>
            External URL
          </FieldLabel>
          <input
            id="utm-custom-url"
            type="url"
            inputMode="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://www.eventbrite.com/e/…"
            autoComplete="off"
            className={inputClass}
          />
          {customUrl.trim() !== '' && !parseExternalUrl(customUrl) && (
            <p className="mt-1 text-sm text-[var(--pyre-red)]">Enter a valid http(s) URL.</p>
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

      {/* Generated link (for external destinations: the tracked pyresauna.com link) */}
      <div>
        <FieldLabel info={destination === 'custom' ? FIELD_INFO.tracked : FIELD_INFO.link}>
          {destination === 'custom' ? 'Tracked link' : 'Generated link'}
        </FieldLabel>
        {destination === 'custom' && externalTagged && !trackedActive ? (
          <div>
            <button
              type="button"
              onClick={createShort}
              disabled={shortLoading}
              className="px-4 py-2 rounded font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {shortLoading ? 'Creating…' : 'Create tracked link'}
            </button>
            <p className="mt-2 text-xs text-white/40">
              Routes the click through pyresauna.com so it&apos;s counted, then forwards to your URL
              with the UTM tags.
            </p>
            {shortError?.forUrl === shortSource && (
              <p className="mt-2 text-sm text-[var(--pyre-red)]">{shortError.message}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <output className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-sm font-mono text-[var(--pyre-creme)] break-all min-h-[2.5rem]">
              {generatedUrl || (
                <span className="text-white/30">
                  {destination === 'custom'
                    ? 'Enter an external URL above…'
                    : 'Select a destination…'}
                </span>
              )}
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
        )}
        {trackedActive && generatedUrl && (
          <p className="mt-2 text-xs text-white/40">
            Clean version for SMS (params hidden, still tracked):{' '}
            <button
              type="button"
              onClick={() => copyRow(trackedActive.code, trackedActive.shortUrl)}
              title="Copy"
              className="font-mono text-white/60 hover:text-white underline decoration-white/30 transition-colors"
            >
              {copiedCode === trackedActive.code ? 'Copied!' : trackedActive.shortUrl}
            </button>
          </p>
        )}

        {/* QR code for the generated link */}
        {generatedUrl && (
          <div className="mt-4">
            <div className="flex justify-center">
              <QrCode
                url={generatedUrl}
                filename={qrFilename([utm.campaign, utm.source, utm.medium, utm.content])}
                style={qrStyle}
              />
            </div>
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setShowQrStyle((s) => !s)}
                aria-expanded={showQrStyle}
                className="text-xs font-mono-bold uppercase tracking-wide text-white/40 hover:text-white transition-colors"
              >
                {showQrStyle ? 'Hide QR style' : 'Customize QR'}
              </button>
            </div>
            {showQrStyle && <QrStyleControls style={qrStyle} onChange={updateQrStyle} />}
          </div>
        )}
      </div>

      {/* Short link (for SMS). Hidden for external destinations — there the
          tracked link is created inline in the section above, and its bare
          /s/<code> form already serves the SMS use case. */}
      <div className="mt-8 pt-6 border-t border-white/10">
        {destination !== 'custom' && (
          <>
            <FieldLabel info={FIELD_INFO.shorten}>Short link (for SMS)</FieldLabel>
            <p className="text-xs text-white/40 -mt-1 mb-3">
              Hides the UTM params in the texted message. Tracking still works when the link opens.
            </p>
            <div className="grid sm:grid-cols-2 gap-2 mb-2">
              <input
                value={shortLabel}
                onChange={(e) => setShortLabel(e.target.value)}
                placeholder="Label (optional, e.g. July SMS blast)"
                autoComplete="off"
                className={inputClass}
              />
              <input
                value={shortAlias}
                onChange={(e) => setShortAlias(e.target.value)}
                placeholder="Custom alias (optional)"
                autoComplete="off"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={createShort}
              disabled={!shortSource || shortLoading}
              className="px-4 py-2 rounded font-mono-bold text-sm uppercase tracking-wide border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors disabled:opacity-40"
            >
              {shortLoading ? 'Creating…' : 'Create short link'}
            </button>
            {shortError?.forUrl === shortSource && (
              <p className="mt-2 text-sm text-[var(--pyre-red)]">{shortError.message}</p>
            )}
            {shortResult?.forUrl === shortSource && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <output className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-sm font-mono text-[var(--pyre-creme)] break-all min-h-[2.5rem]">
                  {shortResult.shortUrl}
                </output>
                <button
                  type="button"
                  onClick={copyShort}
                  className="px-4 py-2 rounded font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  {shortCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Recent short links */}
        <div className="mt-4">
          <button
            type="button"
            onClick={toggleRecent}
            aria-expanded={recentOpen}
            className="flex items-center gap-2 text-xs font-mono-bold uppercase tracking-wide text-white/40 hover:text-white transition-colors"
          >
            <span aria-hidden>{recentOpen ? '▾' : '▸'}</span> Recent short links
          </button>
          {recentOpen && (
            <div className="mt-3">
              {recentLoading && <p className="text-sm text-white/40">Loading…</p>}
              {!recentLoading && recent && recent.length === 0 && (
                <p className="text-sm text-white/40">No short links yet.</p>
              )}
              {!recentLoading && recent && recent.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {recent.map((row) => {
                    const rowUrl = `${origin}/s/${row.code}`;
                    const isEditing = editingCode === row.code;
                    const btnClass =
                      'shrink-0 px-3 py-1.5 rounded border border-white/20 text-xs font-mono-bold uppercase tracking-wide text-white/60 hover:text-white hover:border-white/40 transition-colors';
                    return (
                      <li
                        key={row.code}
                        className="flex items-center gap-3 rounded border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-[var(--pyre-creme)] truncate">
                              /s/{row.code}
                            </span>
                            {isEditing ? (
                              <input
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void saveEditRow(row.code);
                                  if (e.key === 'Escape') cancelEditRow();
                                }}
                                placeholder="Label"
                                // biome-ignore lint/a11y/noAutofocus: focus the field the admin just opened
                                autoFocus
                                className="min-w-0 flex-1 px-2 py-0.5 rounded bg-white/5 border border-white/20 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/40"
                              />
                            ) : (
                              row.label && (
                                <span className="text-xs text-white/40 truncate">{row.label}</span>
                              )
                            )}
                          </div>
                          <div className="text-xs text-white/30 truncate">{row.url}</div>
                        </div>
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void saveEditRow(row.code)}
                              className={btnClass}
                            >
                              Save
                            </button>
                            <button type="button" onClick={cancelEditRow} className={btnClass}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="shrink-0 text-xs text-white/40">
                              {row.clicks} {row.clicks === 1 ? 'click' : 'clicks'}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyRow(row.code, rowUrl)}
                              className={btnClass}
                            >
                              {copiedCode === row.code ? 'Copied' : 'Copy'}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditRow(row)}
                              className={btnClass}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteRow(row.code)}
                              aria-label={`Delete short link ${row.code}`}
                              className="shrink-0 px-3 py-1.5 rounded border border-white/20 text-xs font-mono-bold uppercase tracking-wide text-white/40 hover:text-[var(--pyre-red)] hover:border-[var(--pyre-red)]/50 transition-colors"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
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
                    {links.map((link) => {
                      const isEditingLink = editingLinkId === link.id;
                      const qrShown = shownQr[link.id] ?? false;
                      const linkBtn =
                        'px-2 py-1 rounded border border-white/20 text-xs text-white/60 hover:text-white hover:border-white/40 transition-colors';
                      return (
                        <div key={link.id} className="px-3 py-3 flex flex-col sm:flex-row gap-3">
                          <div className="flex-1 min-w-0">
                            {isEditingLink ? (
                              <input
                                value={editLinkLabel}
                                onChange={(e) => setEditLinkLabel(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void saveEditLink(link.id);
                                  if (e.key === 'Escape') cancelEditLink();
                                }}
                                placeholder="Label"
                                // biome-ignore lint/a11y/noAutofocus: focus the field the admin just opened
                                autoFocus
                                className="w-full mb-1 px-2 py-1 rounded bg-white/5 border border-white/20 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/40"
                              />
                            ) : (
                              link.label && (
                                <p className="text-sm text-[var(--pyre-creme)] mb-0.5">
                                  {link.label}
                                </p>
                              )
                            )}
                            <p className="text-xs font-mono text-white/50 break-all">{link.url}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {isEditingLink ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void saveEditLink(link.id)}
                                    className={linkBtn}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditLink}
                                    className={linkBtn}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => copyLink(link.url)}
                                    className={linkBtn}
                                  >
                                    Copy
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditLink(link)}
                                    className={linkBtn}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleQr(link.id)}
                                    aria-expanded={qrShown}
                                    className={linkBtn}
                                  >
                                    {qrShown ? 'Hide QR' : 'Show QR'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteLink(link.id)}
                                    className="px-2 py-1 rounded border border-white/20 text-xs text-white/40 hover:text-[var(--pyre-red)] hover:border-[var(--pyre-red)]/50 transition-colors"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {qrShown && (
                            <div className="shrink-0">
                              <QrCode
                                url={link.url}
                                filename={qrFilename([
                                  campaign.name,
                                  link.label,
                                  link.source,
                                  link.medium,
                                ])}
                                style={qrStyle}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
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
