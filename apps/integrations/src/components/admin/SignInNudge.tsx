// The dashboard's prompt to add a password or passkey, shown to someone who
// can only sign in by email (pages/admin/index.astro decides). "Not now"
// hides it on this device for 30 days.

import { useState } from 'react';
import { ACCOUNT_HREF } from './adminTools';

export const NUDGE_DISMISSED_COOKIE = 'pyre_signin_nudge_dismissed';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function SignInNudge() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const dismiss = () => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    // biome-ignore lint/suspicious/noDocumentCookie: the server reads this flag to skip the check; the Cookie Store API is not in every browser staff use
    document.cookie = `${NUDGE_DISMISSED_COOKIE}=1; Max-Age=${THIRTY_DAYS}; Path=/; SameSite=Lax${secure}`;
    setHidden(true);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-4 py-3">
      <p className="text-sm text-[var(--pyre-creme)]">
        Add a password or passkey so you can sign in without your email.
      </p>
      <div className="flex shrink-0 items-center gap-4 font-mono text-xs uppercase tracking-wide">
        <a href={ACCOUNT_HREF} className="text-[var(--pyre-gold)] underline hover:text-white">
          Set up
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="text-white/50 underline hover:text-white"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
