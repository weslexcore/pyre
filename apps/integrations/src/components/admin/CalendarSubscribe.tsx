// "Subscribe to my shifts": hands the employee their personal .ics feed URL
// so their own calendar app keeps itself current.
//
// The URL is the credential — anyone holding it can read that person's
// schedule — so it's minted on first view rather than for the whole roster up
// front, and Reset link is the revoke when one leaks or a phone is lost.

import { useEffect, useState } from 'react';

interface FeedUrls {
  feedUrl: string;
  webcalUrl: string;
  teamFeedUrl: string | null;
  teamWebcalUrl: string | null;
  canManage: boolean;
}

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

export function CalendarSubscribe() {
  const [urls, setUrls] = useState<FeedUrls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/calendar-feed');
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? 'Could not load your calendar link');
        else setUrls(body as FeedUrls);
      } catch {
        if (!cancelled) setError('Could not load your calendar link');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rotate = async () => {
    if (
      !window.confirm(
        'Reset your calendar link? Any calendar already subscribed to the old link stops updating, and you have to subscribe again with the new one.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/calendar-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate' }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Could not reset your calendar link');
      else {
        setUrls(body as FeedUrls);
        setError(null);
      }
    } catch {
      setError('Could not reset your calendar link');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Copying failed — select the URL and copy it by hand.');
    }
  };

  if (error && !urls) {
    return (
      <section className="mt-6 rounded border border-white/10 bg-white/[0.03] p-4">
        <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>
      </section>
    );
  }

  if (!urls) {
    return (
      <section className="mt-6 rounded border border-white/10 bg-white/[0.03] p-4">
        <p className="font-mono text-xs text-white/40">Loading your calendar link…</p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-1 font-semibold text-[var(--pyre-creme)]">Subscribe to your shifts</h2>
      <p className="mb-4 font-mono text-xs leading-relaxed text-white/50">
        Add this once and your shifts show up in your own calendar and stay current. It covers the
        weeks that are locked in — anything further out is still moving, so it isn't included yet.
      </p>

      <FeedRow
        label="My shifts"
        urls={{ https: urls.feedUrl, webcal: urls.webcalUrl }}
        copied={copied === 'mine'}
        onCopy={() => void copy(urls.feedUrl, 'mine')}
      />

      {urls.canManage && urls.teamFeedUrl && urls.teamWebcalUrl && (
        <div className="mt-4">
          <FeedRow
            label="Everyone's coverage"
            urls={{ https: urls.teamFeedUrl, webcal: urls.teamWebcalUrl }}
            copied={copied === 'team'}
            onCopy={() => void copy(urls.teamFeedUrl as string, 'team')}
          />
        </div>
      )}

      <div className="mt-4 space-y-1 font-mono text-[10px] leading-relaxed text-white/40">
        <p>
          <span className="text-white/60">Apple / Outlook desktop:</span> click Subscribe, then set
          it to refresh every 15 minutes or so.
        </p>
        <p>
          <span className="text-white/60">Google:</span> Other calendars → From URL, and paste the
          copied link. Google re-checks on its own schedule, often only once a day.
        </p>
        <p className="pt-1 text-white/50">
          Because of that lag, treat this as a background copy of the schedule. For a change
          happening soon, use Add to calendar on the shift itself, and go by the board and your
          email.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-white/10 border-t pt-3">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void rotate()}>
          Reset link
        </button>
        <span className="font-mono text-[10px] text-white/40">
          Anyone with your link can read your schedule. Reset it if it ends up somewhere it
          shouldn't.
        </span>
      </div>

      {error && <p className="mt-2 font-mono text-xs text-[var(--pyre-red)]">{error}</p>}
    </section>
  );
}

function FeedRow({
  label,
  urls,
  copied,
  onCopy,
}: {
  label: string;
  urls: { https: string; webcal: string };
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="mb-1 font-mono text-xs uppercase tracking-wide text-white/40">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={urls.https}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2 py-1.5 font-mono text-white/70 text-xs"
        />
        <button type="button" className={buttonClass} onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a className={buttonClass} href={urls.webcal}>
          Subscribe
        </a>
      </div>
    </div>
  );
}
