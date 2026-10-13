// The email body editor for one journey step: subject, inbox preview line,
// background, and an ordered list of blocks. Merge-field chips insert
// {{field}} at the cursor of whichever field was focused last.

import { type ReactNode, useRef } from 'react';
import { isTaggedHost, journeyLink, journeyLinkContent } from '@/emails/components/utm';
import { MERGE_FIELD_KEYS, MERGE_FIELDS } from '@/lib/email/journeys/merge-fields';
import {
  type BlockContent,
  EMAIL_BACKGROUNDS,
  type EmailBlock,
  type EmailBlockType,
} from '@/lib/email/journeys/schema';
import {
  BLOCK_LABELS,
  buttonClass,
  compactInputClass,
  compactSelectClass,
  microLabelClass,
  newBlock,
} from './journeyUi';

type Inserter = (token: string) => void;

const textareaClass = `${compactInputClass} w-full font-sans leading-relaxed`;

export function BlockEditor({
  content,
  onChange,
  journeyId,
  stepKey,
}: {
  content: BlockContent;
  onChange: (next: BlockContent) => void;
  journeyId: string;
  stepKey: string;
}) {
  const tracked = (label: string, url: string) => (
    <TrackedLink url={url} label={label} journeyId={journeyId} stepKey={stepKey} />
  );
  // The last-focused field's insert function, for the merge-field chips.
  const inserter = useRef<Inserter | null>(null);

  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...content, blocks });
  const updateBlock = (index: number, block: EmailBlock) =>
    setBlocks(content.blocks.map((b, i) => (i === index ? block : b)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= content.blocks.length) return;
    const next = [...content.blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  };

  /** Props that make an input/textarea a merge-field insertion target. */
  const field = (value: string, set: (v: string) => void) => ({
    value,
    onChange: (e: { target: { value: string } }) => set(e.target.value),
    onFocus: (e: { target: HTMLInputElement | HTMLTextAreaElement }) => {
      const el = e.target;
      inserter.current = (token) => {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        set(el.value.slice(0, start) + token + el.value.slice(end));
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + token.length, start + token.length);
        });
      };
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <label>
          <span className={microLabelClass}>Subject</span>
          <input
            className={`${compactInputClass} mt-1 w-full`}
            {...field(content.subject, (subject) => onChange({ ...content, subject }))}
          />
        </label>
        <label>
          <span className={microLabelClass}>Background</span>
          <select
            className={`${compactSelectClass} mt-1 w-full`}
            value={content.background}
            onChange={(e) =>
              onChange({ ...content, background: e.target.value as BlockContent['background'] })
            }
          >
            {EMAIL_BACKGROUNDS.map((bg) => (
              <option key={bg} value={bg}>
                {bg}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span className={microLabelClass}>Inbox preview line</span>
        <input
          className={`${compactInputClass} mt-1 w-full`}
          placeholder="The grey text after the subject in most inboxes"
          {...field(content.preview, (preview) => onChange({ ...content, preview }))}
        />
      </label>

      <div className="rounded border border-white/10 bg-white/[0.02] p-2">
        <p className={microLabelClass}>Merge fields - click to insert where your cursor is</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {MERGE_FIELD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={`${MERGE_FIELDS[key].label} - e.g. ${MERGE_FIELDS[key].sample}`}
              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-white/70 hover:border-white/30"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => inserter.current?.(`{{${key}}}`)}
            >
              {`{{${key}}}`}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-white/40">
          Add a fallback after a bar, e.g. {'{{firstName|friend}}'}. Without one, a field that has
          no value for someone makes the step skip for them rather than send a broken sentence. Text
          supports **bold**, *italic* and [link text](https://...).
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {content.blocks.map((block, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond position
          <li key={i} className="rounded border border-white/10 bg-white/[0.03] p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                {BLOCK_LABELS[block.type]}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  Up
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => move(i, 1)}
                  disabled={i === content.blocks.length - 1}
                  aria-label="Move down"
                >
                  Down
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setBlocks(content.blocks.filter((_, j) => j !== i))}
                >
                  Delete
                </button>
              </span>
            </div>
            <BlockFields
              block={block}
              onChange={(b) => updateBlock(i, b)}
              field={field}
              tracked={tracked}
            />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(BLOCK_LABELS) as EmailBlockType[]).map((type) => (
          <button
            key={type}
            type="button"
            className={buttonClass}
            onClick={() => setBlocks([...content.blocks, newBlock(type)])}
          >
            + {BLOCK_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}

type FieldProps = (
  value: string,
  set: (v: string) => void
) => {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  onFocus: (e: { target: HTMLInputElement | HTMLTextAreaElement }) => void;
};

function BlockFields({
  block,
  onChange,
  field,
  tracked,
}: {
  block: EmailBlock;
  onChange: (b: EmailBlock) => void;
  field: FieldProps;
  tracked: (label: string, url: string) => ReactNode;
}) {
  switch (block.type) {
    case 'heading':
    case 'signoff':
      return (
        <input
          className={`${compactInputClass} w-full`}
          {...field(block.text, (text) => onChange({ ...block, text }))}
        />
      );
    case 'paragraph':
      return (
        <textarea
          rows={Math.min(12, Math.max(3, block.text.split('\n').length + 1))}
          className={textareaClass}
          placeholder="Write the paragraph. A blank line starts a new one."
          {...field(block.text, (text) => onChange({ ...block, text }))}
        />
      );
    case 'list':
      return (
        <textarea
          rows={Math.min(10, Math.max(3, block.items.length + 1))}
          className={textareaClass}
          placeholder="One bullet per line"
          {...field(block.items.join('\n'), (text) =>
            onChange({ ...block, items: text.split('\n') })
          )}
        />
      );
    case 'button':
      return (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input
            className={compactInputClass}
            placeholder="Button label"
            {...field(block.label, (label) => onChange({ ...block, label }))}
          />
          <input
            className={`${compactInputClass} font-mono text-xs`}
            placeholder="https://..."
            {...field(block.url, (url) => onChange({ ...block, url }))}
          />
          <div className="sm:col-span-2">{tracked(block.label, block.url)}</div>
        </div>
      );
    case 'image':
      return (
        <div className="grid gap-1.5 sm:grid-cols-3">
          <input
            className={`${compactInputClass} font-mono text-xs sm:col-span-2`}
            placeholder="Image URL (https://...)"
            {...field(block.src, (src) => onChange({ ...block, src }))}
          />
          <input
            className={compactInputClass}
            placeholder="Describe the image"
            {...field(block.alt, (alt) => onChange({ ...block, alt }))}
          />
          <input
            className={`${compactInputClass} font-mono text-xs sm:col-span-3`}
            placeholder="Link when tapped (optional)"
            {...field(block.href ?? '', (href) =>
              onChange({ ...block, ...(href ? { href } : { href: undefined }) })
            )}
          />
          {block.href && (
            <div className="sm:col-span-3">{tracked(block.alt || 'image', block.href)}</div>
          )}
        </div>
      );
    case 'divider':
      return <p className="text-xs text-white/40">A thin line between sections.</p>;
  }
}

/** The link as it will actually be sent, so nobody has to build tracked links by hand. */
function TrackedLink({
  url,
  label,
  journeyId,
  stepKey,
}: {
  url: string;
  label: string;
  journeyId: string;
  stepKey: string;
}) {
  const raw = url.trim();
  if (!raw || raw.includes('{{')) return null;
  if (!/^https?:\/\//i.test(raw)) {
    return <p className="text-[11px] text-[var(--pyre-red)]">Links must start with https://</p>;
  }
  if (!isTaggedHost(raw)) {
    return (
      <p className="text-[11px] text-white/40">
        Not tagged (not our site or Momence) - clicks still show on the People tab.
      </p>
    );
  }
  let sent: string;
  try {
    sent = journeyLink(raw, journeyId, journeyLinkContent(stepKey, label, raw));
  } catch {
    return null;
  }
  return (
    <p
      className="break-all font-mono text-[10px] text-white/35"
      title="The link as it will be sent"
    >
      Sent as {sent}
    </p>
  );
}
