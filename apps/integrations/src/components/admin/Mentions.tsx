// How a mention reads once written: `@wes@pyre.co` in the text, "@Wes" on
// the page, as a chip that says the address on hover. MentionChip is what
// SopMarkdown draws for a mention link (lib/mentions markdownWithMentions);
// MentionedText is the same for text that isn't markdown — an incident's
// follow-up notes — cutting the words at each mention it has a name for.

import { type MentionSegment, mentionSegments } from '@/lib/mentions';
import type { PeopleNames } from '@/lib/sops/names';

export function MentionChip({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <span
      title={email}
      className="rounded bg-[var(--pyre-gold)]/15 px-1 font-medium text-[var(--pyre-gold)]"
    >
      {children}
    </span>
  );
}

export function MentionedText({ text, names }: { text: string; names: PeopleNames }) {
  let offset = 0;
  return (
    <>
      {mentionSegments(text, names).map((segment: MentionSegment) => {
        const key = offset;
        offset += segment.text.length;
        return segment.mention ? (
          <MentionChip key={key} email={segment.mention.email}>
            @{segment.mention.name}
          </MentionChip>
        ) : (
          segment.text
        );
      })}
    </>
  );
}
