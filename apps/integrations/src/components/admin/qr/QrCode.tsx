import type QRCodeStyling from 'qr-code-styling';
import type { Options as QrCodeStylingOptions } from 'qr-code-styling';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildQrOptions } from '@/lib/qr/options';
import type { QrStyle } from '@/lib/qr/style';

/**
 * qr-code-styling fits whole modules inside `width - 2 * margin` and centers
 * the leftover, so the border it actually draws only changes when the module
 * size steps down — a margin of 5 and 19 can look identical. Sizing the
 * canvas to exactly `modules * moduleSize + 2 * margin` makes every margin
 * value land on the pixel, at the cost of the canvas being up to one module
 * narrower than the requested size.
 */
function exactSizeOptions(options: QrCodeStylingOptions, modules: number): QrCodeStylingOptions {
  const size = options.width ?? 0;
  const margin = options.margin ?? 0;
  const moduleSize = Math.max(1, Math.floor((size - 2 * margin) / modules));
  const exact = modules * moduleSize + 2 * margin;
  return exact === size ? options : { ...options, width: exact, height: exact };
}

/**
 * Renders a scannable, styled QR for `url` with a download-as-PNG button.
 * qr-code-styling touches the DOM, so it is imported lazily (client-only) to
 * keep the Astro shell from importing browser APIs. A failed import says so
 * instead of leaving an empty box.
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
  // Module count per (data, error correction) — it only changes when those
  // do, so most style tweaks redraw exactly once.
  const moduleCounts = useRef(new Map<string, number>());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const options = useMemo(() => buildQrOptions(url, style), [url, style]);

  const draw = useCallback((instance: QRCodeStyling, next: QrCodeStylingOptions) => {
    const key = `${next.data}|${next.qrOptions?.errorCorrectionLevel}`;
    const known = moduleCounts.current.get(key);
    if (known) {
      instance.update(exactSizeOptions(next, known));
      return;
    }
    instance.update(next);
    // `_qr` is the generated matrix the library keeps on the instance (it is
    // in its typings); reading the module count is the only way to size the
    // canvas exactly without generating the code a second time ourselves.
    const modules = instance._qr?.getModuleCount();
    if (!modules) return;
    moduleCounts.current.set(key, modules);
    const exact = exactSizeOptions(next, modules);
    if (exact !== next) instance.update(exact);
  }, []);

  // Instantiate once on mount (browser only). Options are applied by the update
  // effect below, so this intentionally runs a single time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only init
  useEffect(() => {
    let cancelled = false;
    import('qr-code-styling')
      .then((mod) => {
        if (cancelled) return;
        const QRCodeStylingCtor = mod.default;
        instanceRef.current = new QRCodeStylingCtor(options);
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          instanceRef.current.append(containerRef.current);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render whenever the URL or style changes.
  useEffect(() => {
    if (ready && instanceRef.current) draw(instanceRef.current, options);
  }, [ready, options, draw]);

  const download = useCallback(() => {
    void instanceRef.current?.download({ name: filename, extension: 'png' });
  }, [filename]);

  if (failed) {
    return (
      <p className="text-xs text-[var(--pyre-red)]">
        Could not load the QR renderer. Reload the page and try again.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className="overflow-hidden rounded [&>canvas]:block" />
      {!ready && <span className="font-mono text-xs text-white/40">Drawing…</span>}
      <button
        type="button"
        onClick={download}
        disabled={!ready}
        className="text-xs font-mono-bold uppercase tracking-wide text-white/50 hover:text-[var(--pyre-creme)] transition-colors disabled:opacity-40"
      >
        Download PNG
      </button>
    </div>
  );
}
