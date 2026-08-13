// Fetches the logged-in member's referral code + stats from
// /api/member/referral (which get-or-creates it via the integrations service).

import { useEffect, useState } from 'react';

export interface ReferralStats {
  clicks: number;
  redemptions: number;
  conversions: number;
  rewardsEarned: number;
  rewardsActive: number;
}

export interface ReferralInfo {
  code: string;
  url: string;
  /** The friend-side discount as copy, e.g. "$5". */
  discountLabel: string;
  enabled: boolean;
  stats: ReferralStats;
}

export function useReferral() {
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/member/referral');
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && data.referral) {
          setReferral(data.referral as ReferralInfo);
        } else {
          setError(typeof data.error === 'string' ? data.error : 'unavailable');
        }
      } catch {
        if (!cancelled) setError('unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { referral, loading, error };
}
