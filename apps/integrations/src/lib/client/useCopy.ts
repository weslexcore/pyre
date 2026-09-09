// Copy-to-clipboard with a short "Copied" flash, keyed by an id so several
// copy buttons in one list each flash on their own. Clipboard failures
// (insecure context, permissions) are swallowed: the value is still on screen
// to select by hand.

import { useCallback, useEffect, useRef, useState } from 'react';

const FLASH_MS = 1500;

export interface UseCopy {
  /** The key of the button that most recently copied, for FLASH_MS. */
  copied: string | null;
  copy: (key: string, value: string) => Promise<void>;
}

export function useCopy(): UseCopy {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, FLASH_MS);
  }, []);

  return { copied, copy };
}
