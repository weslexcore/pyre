// Standalone short links (/admin/campaigns/shortlinks): the ones not tied to
// any campaign — a QR on the door, a link read out on a podcast, a URL that
// is just too long to text. Make one at the top, with a custom name if you
// want; the list below shows every link and where it sends people.
//
// Two checks run as you type, against the same store the API writes to: the
// custom name is refused if any short link (campaign-minted included) already
// uses it, and a destination that already has a short link is flagged so the
// team reuses that one instead of printing two codes for one place.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { campaignErrorMessage } from '@/lib/campaigns/errors';
import { parseExternalUrl, qrFilename } from '@/lib/campaigns/links';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { DEFAULT_QR_STYLE } from '@/lib/qr/style';
import { aliasError, normalizeAlias, SHORT_LINK_LIMITS } from '@/lib/shortlinks/alias';
import type {
  ExistingShortLink,
  ShortLinkCheckResponse,
  ShortLinkListResponse,
  StandaloneShortLink,
} from '@/lib/shortlinks/types';
import { BackLink } from '../BackLink';
import { ConfirmDialog } from '../ConfirmDialog';
import { CopyButton } from '../CopyButton';
import {
  buttonClass,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  readError,
} from '../incidentUi';
import { QrCode } from '../qr/QrCode';
import { formatCreated, isSessionExpired, SessionExpired } from './campaignUi';

const LIST_URL = '/api/admin/shortlinks';
const CHECK_URL = '/api/admin/shortlinks/check';

/** Quiet time after the last keystroke before a live check fires. */
const CHECK_DELAY_MS = 400;

function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/** "pyresauna.com/s/" — what the custom name gets appended to. */
function shortPrefix(origin: string): string {
  return `${origin.replace(/^https?:\/\//, '')}/s/`;
}

type AliasState =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking' }
  | { kind: 'taken' }
  | { kind: 'available' };

export function ShortLinks() {
  const { data, error, loading, refreshing, setData } =
    useCachedJson<ShortLinkListResponse>(LIST_URL);
  const origin = data?.origin ?? 'https://pyresauna.com';

  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const links = useMemo(() => {
    const rows = data?.links ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((l) =>
      [l.code, l.url, l.label, l.createdBy, l.campaign?.name ?? ''].some((f) =>
        f.toLowerCase().includes(needle)
      )
    );
  }, [data?.links, search]);

  const onCreated = useCallback(
    (link: StandaloneShortLink) => {
      setData((prev) =>
        prev ? { ...prev, links: [link, ...prev.links], total: prev.total + 1 } : prev
      );
      // Campaign pages join short links by code too; keep their caches honest.
      invalidateJson('/api/admin/campaigns');
    },
    [setData]
  );

  const relabel = useCallback(
    async (code: string, label: string): Promise<void> => {
      setBusyCode(code);
      setActionError(null);
      try {
        const res = await fetch(`${LIST_URL}/${encodeURIComponent(code)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label }),
        });
        if (!res.ok) {
          const message = campaignErrorMessage(await readError(res));
          setActionError(message);
          throw new Error(message);
        }
        const json = (await res.json()) as { link: StandaloneShortLink };
        setData((prev) =>
          prev ? { ...prev, links: prev.links.map((l) => (l.code === code ? json.link : l)) } : prev
        );
      } finally {
        setBusyCode(null);
      }
    },
    [setData]
  );

  const remove = useCallback(
    async (code: string): Promise<void> => {
      setBusyCode(code);
      setActionError(null);
      try {
        const res = await fetch(`${LIST_URL}/${encodeURIComponent(code)}`, { method: 'DELETE' });
        if (!res.ok) {
          const message = campaignErrorMessage(await readError(res));
          setActionError(message);
          throw new Error(message);
        }
        setData((prev) =>
          prev
            ? { ...prev, links: prev.links.filter((l) => l.code !== code), total: prev.total - 1 }
            : prev
        );
        invalidateJson('/api/admin/campaigns');
      } finally {
        setBusyCode(null);
      }
    },
    [setData]
  );

  if (isSessionExpired(error)) return <SessionExpired returnTo="/admin/campaigns/shortlinks" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackLink href="/admin/campaigns">All campaigns</BackLink>
        {refreshing && <span className="font-mono text-xs text-white/35">Refreshing…</span>}
      </div>

      <CreateShortLink origin={origin} onCreated={onCreated} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-primary-semibold text-[var(--pyre-creme)]">
            Short links
            {data && (
              <span className="ml-2 font-mono text-xs font-normal text-white/40">
                {data.links.length} not in a campaign
              </span>
            )}
          </h2>
          <p className="text-xs text-white/45">
            Links made for a campaign live on that campaign's page.
            {data?.truncated && ' Only the newest 1000 short links are listed.'}
          </p>
        </div>

        <input
          className={inputClass}
          value={search}
          placeholder="Search by name, address, or note"
          onChange={(e) => setSearch(e.target.value)}
        />

        {error && (
          <p className="text-sm text-[var(--pyre-red)]">Could not load short links: {error}</p>
        )}
        {actionError && <p className="text-sm text-[var(--pyre-red)]">{actionError}</p>}
        {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

        {!loading && links.length === 0 && (
          <div className={cardClass}>
            <p className="text-sm text-white/60">
              {search
                ? 'Nothing matches that.'
                : 'No standalone short links yet. Make one above: paste where it should go, name it if you like, and copy the short address.'}
            </p>
          </div>
        )}

        {links.length > 0 && (
          <ul className="space-y-2">
            {links.map((link) => (
              <ShortLinkRow
                key={link.code}
                link={link}
                busy={busyCode === link.code}
                onRelabel={(label) => relabel(link.code, label)}
                onDelete={() => remove(link.code)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CreateShortLink({
  origin,
  onCreated,
}: {
  origin: string;
  onCreated: (link: StandaloneShortLink) => void;
}) {
  const [url, setUrl] = useState('');
  const [aliasRaw, setAliasRaw] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<StandaloneShortLink | null>(null);

  const alias = normalizeAlias(aliasRaw);
  const aliasProblem = aliasError(alias);
  const parsedUrl = parseExternalUrl(url)?.toString() ?? '';

  // Live checks, debounced so each keystroke does not hit the store.
  const settledAlias = useSettled(aliasProblem ? '' : alias, CHECK_DELAY_MS);
  const settledUrl = useSettled(parsedUrl, CHECK_DELAY_MS);
  const [aliasTaken, setAliasTaken] = useState<Record<string, boolean>>({});
  const [existingByUrl, setExistingByUrl] = useState<Record<string, ExistingShortLink[]>>({});

  useEffect(() => {
    if (!settledAlias || settledAlias in aliasTaken) return;
    let cancelled = false;
    fetch(`${CHECK_URL}?alias=${encodeURIComponent(settledAlias)}`)
      .then((res) => (res.ok ? (res.json() as Promise<ShortLinkCheckResponse>) : null))
      .then((body) => {
        if (cancelled || !body || body.aliasTaken === undefined) return;
        setAliasTaken((prev) => ({ ...prev, [settledAlias]: body.aliasTaken === true }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settledAlias, aliasTaken]);

  useEffect(() => {
    if (!settledUrl || settledUrl in existingByUrl) return;
    let cancelled = false;
    fetch(`${CHECK_URL}?url=${encodeURIComponent(settledUrl)}`)
      .then((res) => (res.ok ? (res.json() as Promise<ShortLinkCheckResponse>) : null))
      .then((body) => {
        if (cancelled || !body) return;
        setExistingByUrl((prev) => ({ ...prev, [settledUrl]: body.existing ?? [] }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settledUrl, existingByUrl]);

  const aliasState: AliasState = !alias
    ? { kind: 'idle' }
    : aliasProblem
      ? { kind: 'invalid', message: aliasProblem }
      : alias !== settledAlias || !(alias in aliasTaken)
        ? { kind: 'checking' }
        : aliasTaken[alias]
          ? { kind: 'taken' }
          : { kind: 'available' };

  const existing = parsedUrl && parsedUrl === settledUrl ? (existingByUrl[parsedUrl] ?? []) : [];
  const urlProblem =
    url.trim() && !parsedUrl ? 'Enter a full web address, like https://example.com/page' : null;

  const canSubmit =
    !submitting && !!parsedUrl && aliasState.kind !== 'invalid' && aliasState.kind !== 'taken';

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch(LIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parsedUrl, alias, label }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        link?: StandaloneShortLink;
        error?: string;
      };
      if (!res.ok || !json.link) {
        if (json.error === 'alias_taken') {
          setAliasTaken((prev) => ({ ...prev, [alias]: true }));
        }
        setError(campaignErrorMessage(json.error, `Could not create (${res.status})`));
        return;
      }
      const link = json.link;
      // The name is now in use and the destination now has a link: the next
      // check must see both.
      setAliasTaken((prev) => ({ ...prev, [link.code]: true }));
      setExistingByUrl((prev) => {
        const next = { ...prev };
        delete next[parsedUrl];
        return next;
      });
      onCreated(link);
      setCreated(link);
      setUrl('');
      setAliasRaw('');
      setLabel('');
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={`${cardClass} space-y-4`}
    >
      <div>
        <h2 className="text-base font-primary-semibold text-[var(--pyre-creme)]">New short link</h2>
        <p className="mt-0.5 text-xs leading-snug text-white/45">
          For anything that is not a campaign. Campaign links get their short link on the campaign
          page, so the clicks add up there.
        </p>
      </div>

      <div>
        <label htmlFor="shortlink-url" className={labelClass}>
          Where it goes
        </label>
        <input
          id="shortlink-url"
          className={inputClass}
          value={url}
          maxLength={SHORT_LINK_LIMITS.url}
          placeholder="https://"
          inputMode="url"
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
        />
        {urlProblem && <p className="mt-1 text-xs text-[var(--pyre-red)]">{urlProblem}</p>}
      </div>

      {existing.length > 0 && (
        <div className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 p-3 text-sm text-[var(--pyre-gold)]">
          <p>
            {existing.length === 1
              ? 'A short link to this address already exists.'
              : `${existing.length} short links to this address already exist.`}{' '}
            Reuse one unless you need a separate one to count on its own.
          </p>
          <ul className="mt-2 space-y-1">
            {existing.map((s) => (
              <li key={s.code} className="flex flex-wrap items-center gap-2 text-xs">
                <code className="font-mono text-[var(--pyre-creme)]">{s.shortUrl}</code>
                {s.campaign ? (
                  <a href={`/admin/campaigns/${s.campaign.id}`} className="underline">
                    {s.campaign.name}
                  </a>
                ) : (
                  s.label && <span className="text-white/60">{s.label}</span>
                )}
                <span className="text-white/40">
                  {s.clicks} click{s.clicks === 1 ? '' : 's'}
                </span>
                <CopyButton value={s.shortUrl} className="!px-2 !py-1 !text-[10px]" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="shortlink-alias" className={labelClass}>
            Custom name <span className="normal-case text-white/35">(optional)</span>
          </label>
          <div className="flex items-stretch">
            <span className="flex items-center rounded-l border border-r-0 border-white/10 bg-white/[0.02] px-3 font-mono text-xs text-white/40">
              {shortPrefix(origin)}
            </span>
            <input
              id="shortlink-alias"
              className={`${inputClass} rounded-l-none font-mono`}
              value={aliasRaw}
              maxLength={SHORT_LINK_LIMITS.alias}
              placeholder="random if blank"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setAliasRaw(e.target.value)}
            />
          </div>
          <AliasNote state={aliasState} alias={alias} />
        </div>
        <div>
          <label htmlFor="shortlink-label" className={labelClass}>
            Note <span className="normal-case text-white/35">(optional)</span>
          </label>
          <input
            id="shortlink-label"
            className={inputClass}
            value={label}
            maxLength={SHORT_LINK_LIMITS.label}
            placeholder="Where it is printed or posted"
            autoComplete="off"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!canSubmit} className={primaryButtonClass}>
          {submitting
            ? 'Creating…'
            : existing.length > 0
              ? 'Create another anyway'
              : 'Create short link'}
        </button>
        {created && (
          <span className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            Created
            <code className="font-mono text-[var(--pyre-creme)]">{created.shortUrl}</code>
            <CopyButton value={created.shortUrl} className="!px-2 !py-1 !text-[10px]" />
          </span>
        )}
      </div>
    </form>
  );
}

function AliasNote({ state, alias }: { state: AliasState; alias: string }) {
  switch (state.kind) {
    case 'idle':
      return (
        <p className="mt-1 text-xs text-white/40">
          Lowercase letters, numbers, dashes. Leave blank for a random code.
        </p>
      );
    case 'invalid':
      return <p className="mt-1 text-xs text-[var(--pyre-red)]">{state.message}</p>;
    case 'checking':
      return <p className="mt-1 font-mono text-xs text-white/40">Checking {alias}…</p>;
    case 'taken':
      return (
        <p className="mt-1 text-xs text-[var(--pyre-red)]">
          {alias} is already taken. Pick another name.
        </p>
      );
    case 'available':
      return <p className="mt-1 text-xs text-[var(--pyre-sage)]">{alias} is available.</p>;
  }
}

function ShortLinkRow({
  link,
  busy,
  onRelabel,
  onDelete,
}: {
  link: StandaloneShortLink;
  busy: boolean;
  onRelabel: (label: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [showQr, setShowQr] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <code className="min-w-0 truncate rounded bg-black/30 px-2 py-1.5 font-mono text-sm text-[var(--pyre-creme)]">
              {link.shortUrl}
            </code>
            <CopyButton value={link.shortUrl} label="Copy" primary />
          </div>
          <div className="flex items-center gap-2 text-xs text-white/50">
            <span className="shrink-0 font-mono text-white/30">goes to</span>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate font-mono text-white/70 underline decoration-white/20 hover:text-[var(--pyre-creme)]"
              title={link.url}
            >
              {link.url}
            </a>
          </div>
        </div>
        <span className="font-mono text-xs text-white/50 tabular-nums">
          {link.clicks} click{link.clicks === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-white/40">
        {link.label && <span className="text-white/60">{link.label}</span>}
        {link.campaign && (
          <a href={`/admin/campaigns/${link.campaign.id}`} className="underline">
            Tagged for {link.campaign.name}
          </a>
        )}
        <span>
          Created {formatCreated(link.createdAt)}
          {link.createdBy ? ` by ${link.createdBy}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setShowQr((v) => !v)} className={buttonClass}>
          {showQr ? 'Hide QR' : 'QR code'}
        </button>
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onRelabel(label)
                .then(() => setEditing(false))
                .catch(() => {});
            }}
          >
            <input
              className={`${inputClass} !py-1.5 !text-xs w-56`}
              value={label}
              maxLength={SHORT_LINK_LIMITS.label}
              placeholder="Where it is printed or posted"
              onChange={(e) => setLabel(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" disabled={busy} className={buttonClass}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setLabel(link.label);
                setEditing(false);
              }}
              className={buttonClass}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
            {link.label ? 'Edit note' : 'Add note'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${buttonClass} ml-auto text-[var(--pyre-red)]/80 hover:text-[var(--pyre-red)]`}
        >
          Delete
        </button>
      </div>

      {showQr && (
        <div className="pt-2">
          <QrCode url={link.shortUrl} filename={qrFilename([link.code])} style={DEFAULT_QR_STYLE} />
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this short link?"
          body="Anything already printed or posted with it will send people to the home page."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() =>
            void onDelete()
              .then(() => setConfirming(false))
              .catch(() => setConfirming(false))
          }
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}
