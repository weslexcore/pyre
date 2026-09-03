// Text with every occurrence of a search term wrapped in <mark>, in the
// gold-on-black the admin pages use for in-context highlights.
import { highlightSegments } from '@/lib/sops/search';

export function Marked({ text, term }: { text: string; term: string }) {
  let offset = 0;
  return (
    <>
      {highlightSegments(text, term).map((segment) => {
        const key = offset;
        offset += segment.text.length;
        return segment.match ? (
          <mark
            key={key}
            className="rounded-sm bg-[var(--pyre-gold)] px-0.5 text-[var(--pyre-black)]"
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        );
      })}
    </>
  );
}
