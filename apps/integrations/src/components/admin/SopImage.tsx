// A library image embedded in an SOP (see lib/sops/media): drawn by
// SopMarkdown wherever a document has `![Alt](/api/admin/sop-images/<id>)`.
// The src is the app's own route, which redirects to a short-lived signed
// link. Tapping the image opens it full size in a new tab, which matters on
// a phone, where a photo of a breaker panel is too small to read inline.
import { useState } from 'react';
import { sopMediaSrc } from '@/lib/sops/media';

export function SopImage({ id, alt }: { id: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const src = sopMediaSrc({ kind: 'image', id });
  const label = alt?.trim() ?? '';

  if (failed) {
    return (
      <span className="my-3 block rounded border border-dashed border-white/15 px-3 py-4 text-center text-xs text-white/50">
        {label ? `“${label}” couldn’t be loaded.` : 'This image couldn’t be loaded.'} It may have
        been removed from the library.
      </span>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label ? `${label} (open full size)` : 'Open image full size'}
      className="my-3 inline-block max-w-full"
    >
      <img
        src={src}
        alt={label}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block max-h-[70vh] max-w-full rounded border border-white/10 bg-white/5"
      />
    </a>
  );
}
