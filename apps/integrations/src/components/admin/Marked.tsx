// Text with every occurrence of a search term wrapped in <mark>, in the
// gold-on-black the admin pages use for in-context highlights. Marked takes
// the global search's one term; TermsMarked takes a board search's words
// (lib/boards/search searchTerms), each marked wherever it occurs.
import { termSegments } from '@/lib/boards/search';
import { highlightSegments } from '@/lib/sops/search';

export function Marked({ text, term }: { text: string; term: string }) {
  return <Segments segments={highlightSegments(text, term)} />;
}

export function TermsMarked({ text, terms }: { text: string; terms: string[] }) {
  return <Segments segments={termSegments(text, terms)} />;
}

function Segments({ segments }: { segments: { text: string; match: boolean }[] }) {
  let offset = 0;
  return (
    <>
      {segments.map((segment) => {
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
