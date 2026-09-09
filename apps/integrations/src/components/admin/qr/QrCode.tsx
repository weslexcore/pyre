import type QRCodeStyling from 'qr-code-styling';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildQrOptions,
  PNG_PX,
  PREVIEW_PX,
  type QrRender,
  SVG_MODULE_UNITS,
} from '@/lib/qr/options';
import type { QrStyle } from '@/lib/qr/style';

type Ctor = typeof QRCodeStyling;

/**
 * Renders a styled QR preview for `url` with SVG and print-resolution PNG
 * downloads. qr-code-styling touches the DOM, so it is imported lazily
 * (client-only) to keep the Astro shell from importing browser APIs. A
 * failed import says so instead of leaving an empty box.
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
  const ctorRef = useRef<Ctor | null>(null);
  const instanceRef = useRef<QRCodeStyling | null>(null);
  // Module count per (data, error correction) — it only changes when those
  // do, so most style tweaks redraw exactly once, and exports reuse it.
  const moduleCounts = useRef(new Map<string, number>());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'svg' | null>(null);

  const countKey = useMemo(() => `${url}|${style.logo ? 'H' : 'M'}`, [url, style.logo]);

  /** The module count for this data, generating the code once if needed. */
  const modulesFor = useCallback(
    (Ctor: Ctor): number | null => {
      const known = moduleCounts.current.get(countKey);
      if (known) return known;
      const probe = new Ctor(
        buildQrOptions(url, style, { type: 'canvas', target: PREVIEW_PX, modules: null })
      );
      // `_qr` is the generated matrix the library keeps on the instance (it
      // is in its typings); reading the module count is the only way to size
      // the canvas exactly without generating the code a second time.
      const modules = probe._qr?.getModuleCount() ?? null;
      if (modules) moduleCounts.current.set(countKey, modules);
      return modules;
    },
    [countKey, url, style]
  );

  // Instantiate once on mount (browser only). Options are applied by the update
  // effect below, so this intentionally runs a single time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only init
  useEffect(() => {
    let cancelled = false;
    import('qr-code-styling')
      .then((mod) => {
        if (cancelled) return;
        ctorRef.current = mod.default;
        const modules = modulesFor(mod.default);
        instanceRef.current = new mod.default(
          buildQrOptions(url, style, { type: 'canvas', target: PREVIEW_PX, modules })
        );
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
    const Ctor = ctorRef.current;
    if (!ready || !Ctor || !instanceRef.current) return;
    const modules = modulesFor(Ctor);
    instanceRef.current.update(
      buildQrOptions(url, style, { type: 'canvas', target: PREVIEW_PX, modules })
    );
  }, [ready, url, style, modulesFor]);

  const download = useCallback(
    async (extension: 'png' | 'svg') => {
      const Ctor = ctorRef.current;
      if (!Ctor) return;
      setExporting(extension);
      try {
        const modules = modulesFor(Ctor);
        const render: QrRender =
          extension === 'svg'
            ? {
                type: 'svg',
                target: ((modules ?? 29) + 2 * style.quietZone) * SVG_MODULE_UNITS,
                modules,
              }
            : { type: 'canvas', target: PNG_PX, modules };
        // A fresh, unattached instance: the preview stays small on the page
        // while the file is drawn at export size.
        await new Ctor(buildQrOptions(url, style, render)).download({
          name: filename,
          extension,
        });
      } finally {
        setExporting(null);
      }
    },
    [filename, modulesFor, style, url]
  );

  if (failed) {
    return (
      <p className="text-xs text-[var(--pyre-red)]">
        Could not load the QR renderer. Reload the page and try again.
      </p>
    );
  }

  const downloadClass =
    'text-xs font-mono-bold uppercase tracking-wide text-white/50 hover:text-[var(--pyre-creme)] transition-colors disabled:opacity-40';

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className="overflow-hidden rounded [&>canvas]:block" />
      {!ready && <span className="font-mono text-xs text-white/40">Drawing…</span>}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void download('svg')}
          disabled={!ready || exporting !== null}
          className={downloadClass}
          title="Scales without loss. Use this for print and design files."
        >
          {exporting === 'svg' ? 'Preparing…' : 'Download SVG'}
        </button>
        <button
          type="button"
          onClick={() => void download('png')}
          disabled={!ready || exporting !== null}
          className={downloadClass}
          title={`${PNG_PX}px, enough for a 4 inch print. Use this for web, social, and email.`}
        >
          {exporting === 'png' ? 'Preparing…' : 'Download PNG'}
        </button>
      </div>
      <p className="text-center text-[11px] leading-snug text-white/40">
        SVG for print and design work. PNG for web, social, and email.
      </p>
    </div>
  );
}
