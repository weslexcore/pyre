import type QRCodeStyling from 'qr-code-styling';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildQrOptions, type QrStyle } from '@/lib/qr/style';

/**
 * Renders a scannable, styled QR for `url` with a download-as-PNG button.
 * qr-code-styling touches the DOM, so it is imported lazily (client-only) to
 * keep the Astro shell from importing browser APIs.
 */
export function QrCode({
  url,
  filename,
  style,
}: {
  url: string;
  filename: string;
  style: QrStyle;
}) {
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
