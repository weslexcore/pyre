// The email body editor for one journey step: subject, inbox preview line,
// background, and an ordered list of blocks. Merge-field chips insert
// {{field}} at the cursor of whichever field was focused last.

import { type ReactNode, useId, useRef } from 'react';
import { isTaggedHost, journeyLink, journeyLinkContent } from '@/emails/components/utm';
import { MERGE_FIELD_KEYS, MERGE_FIELDS } from '@/lib/email/journeys/merge-fields';
import {
  type BlockContent,
  BUTTON_COLOR_KEYS,
  BUTTON_COLORS,
  BUTTON_STYLE_LABELS,
  BUTTON_STYLES,
  type ButtonStyle,
  EMAIL_BACKGROUNDS,
  type EmailBlock,
  type EmailBlockType,
} from '@/lib/email/journeys/schema';
import { Field, FieldLabel } from './Field';
import {
  BLOCK_LABELS,
  buttonClass,
  compactInputClass,
  compactSelectClass,
  newBlock,
} from './journeyUi';
import { DragHandle, SortableList } from './Sortable';

type Inserter = (token: string) => void;

const TIPS = {
  subject:
    'The first thing people see in their inbox. Keep it short and specific; merge fields like {{firstName|friend}} work here too.',
  background: 'The photo behind the email header. Each one is a Pyre photo in the brand style.',
  preview:
    'The grey line most inboxes show after the subject. Use it to add the hook the subject leaves out. Leave empty to let the inbox pick text from the email.',
  mergeFields:
    'Fill in details from Momence for each person, like their name or when their credits expire. Add a fallback after a bar - {{firstName|friend}} - for people with no value; without one, the step is skipped for them rather than sending a broken sentence.',
  body: 'The email is built from blocks, top to bottom. Drag a block by its handle to move it. Text supports **bold**, *italic* and [link text](https://...), and plain links are tracked automatically.',
} as const;

const BACKGROUND_LABELS: Record<BlockContent['background'], string> = {
  trees: 'Trees',
  clouds: 'Clouds',
  lamps: 'Lamps',
};

const BLOCK_HINTS: Record<EmailBlockType, string> = {
  heading: 'A large line of text to open the email or a section.',
  paragraph: 'Body text. A blank line starts a new paragraph.',
  list: 'Bullet points, one per line.',
  button: 'A tappable button or text link.',
  divider: 'A thin line between sections.',
  image: 'A picture, optionally linked.',
  signoff: 'Who the email is from, e.g. "Wes + Julien".',
};

const textareaClass = `${compactInputClass} w-full font-sans leading-relaxed`;

export function BlockEditor({
  content,
  onChange,
  campaign,
  stepKey,
}: {
  content: BlockContent;
  onChange: (next: BlockContent) => void;
  /** utm_campaign the links will carry. */
  campaign: string;
  stepKey: string;
}) {
  const tracked = (label: string, url: string) => (
    <TrackedLink url={url} label={label} campaign={campaign} stepKey={stepKey} />
  );
  // The last-focused field's insert function, for the merge-field chips.
  const inserter = useRef<Inserter | null>(null);

  // Blocks have no id of their own; drag-and-drop needs one that follows a
  // block when it moves. Kept alongside the list, position for position.
  const blockIds = useRef<string[]>([]);
  const nextId = useRef(0);
  while (blockIds.current.length < content.blocks.length) {
    nextId.current += 1;
    blockIds.current.push(`block-${nextId.current}`);
  }
  blockIds.current.length = content.blocks.length;

  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...content, blocks });
  const updateBlock = (index: number, block: EmailBlock) =>
    setBlocks(content.blocks.map((b, i) => (i === index ? block : b)));
  const removeBlock = (index: number) => {
    blockIds.current.splice(index, 1);
    setBlocks(content.blocks.filter((_, j) => j !== index));
  };
  const items = content.blocks.map((block, i) => ({ id: blockIds.current[i], block }));

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
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Subject line" tip={TIPS.subject}>
          <input
            className={`${compactInputClass} w-full`}
            placeholder="e.g. How was your first session, {{firstName|friend}}?"
            {...field(content.subject, (subject) => onChange({ ...content, subject }))}
          />
        </Field>
        <Field label="Background" tip={TIPS.background}>
          <select
            className={`${compactSelectClass} w-full`}
            value={content.background}
            onChange={(e) =>
              onChange({ ...content, background: e.target.value as BlockContent['background'] })
            }
          >
            {EMAIL_BACKGROUNDS.map((bg) => (
              <option key={bg} value={bg}>
                {BACKGROUND_LABELS[bg]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Inbox preview line" tip={TIPS.preview}>
        <input
          className={`${compactInputClass} w-full`}
          placeholder="The grey text after the subject in most inboxes"
          {...field(content.preview, (preview) => onChange({ ...content, preview }))}
        />
      </Field>

      <div className="rounded border border-white/10 bg-white/[0.02] p-3">
        <FieldLabel label="Personalize" tip={TIPS.mergeFields} />
        <p className="-mt-0.5 mb-1.5 text-xs text-white/45">
          Click a field to insert it where your cursor is.
        </p>
        <div className="flex flex-wrap gap-1">
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
      </div>

      <div>
        <FieldLabel label="Email body" tip={TIPS.body} />
        {content.blocks.length === 0 && (
          <p className="rounded border border-dashed border-white/15 p-4 text-sm text-white/50">
            Empty. Add a heading, some text and a button below.
          </p>
        )}
        <SortableList
          items={items}
          getId={(item) => item.id}
          getLabel={(item) => BLOCK_LABELS[item.block.type]}
          onReorder={(next) => {
            blockIds.current = next.map((item) => item.id);
            setBlocks(next.map((item) => item.block));
          }}
          className="flex flex-col gap-2"
        >
          {(item, i, drag) => (
            <div
              className={`rounded border border-white/10 p-2 ${drag.isDragging ? 'bg-[var(--pyre-black)]' : 'bg-white/[0.03]'}`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <DragHandle drag={drag} label={BLOCK_LABELS[item.block.type]} />
                  <span className="text-xs font-medium text-white/70">
                    {BLOCK_LABELS[item.block.type]}
                  </span>
                </span>
                <button type="button" className={buttonClass} onClick={() => removeBlock(i)}>
                  Remove
                </button>
              </div>
              <BlockFields
                block={item.block}
                onChange={(b) => updateBlock(i, b)}
                field={field}
                tracked={tracked}
              />
            </div>
          )}
        </SortableList>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-white/50">Add to the email</p>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(BLOCK_LABELS) as EmailBlockType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={buttonClass}
              title={BLOCK_HINTS[type]}
              onClick={() => setBlocks([...content.blocks, newBlock(type)])}
            >
              + {BLOCK_LABELS[type]}
            </button>
          ))}
        </div>
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
  // Names the color radio group per block.
  const id = useId();
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
        <div className="grid gap-2 sm:grid-cols-2">
          <MiniField label="Button text">
            <input
              className={`${compactInputClass} w-full`}
              placeholder="e.g. Book a session"
              {...field(block.label, (label) => onChange({ ...block, label }))}
            />
          </MiniField>
          <MiniField label="Links to">
            <input
              className={`${compactInputClass} w-full font-mono text-xs`}
              placeholder="https://pyresauna.com/..."
              {...field(block.url, (url) => onChange({ ...block, url }))}
            />
          </MiniField>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <select
              className={compactSelectClass}
              value={block.style}
              aria-label="Button style"
              onChange={(e) => onChange({ ...block, style: e.target.value as ButtonStyle })}
            >
              {BUTTON_STYLES.map((style) => (
                <option key={style} value={style}>
                  {BUTTON_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
            <fieldset className="flex gap-1">
              <legend className="sr-only">Button color</legend>
              {BUTTON_COLOR_KEYS.map((key) => (
                <label
                  key={key}
                  title={BUTTON_COLORS[key].label}
                  className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-transform has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/60 ${
                    block.color === key
                      ? 'scale-110 border-white'
                      : 'border-white/20 hover:border-white/50'
                  }`}
                  style={{ backgroundColor: BUTTON_COLORS[key].hex }}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`button-color-${id}`}
                    checked={block.color === key}
                    onChange={() => onChange({ ...block, color: key })}
                    aria-label={BUTTON_COLORS[key].label}
                  />
                </label>
              ))}
            </fieldset>
            {block.style !== 'link' && (
              <label className="flex items-center gap-1.5 text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={block.fullWidth}
                  onChange={(e) => onChange({ ...block, fullWidth: e.target.checked })}
                />
                Full width
              </label>
            )}
          </div>
          <div className="sm:col-span-2">{tracked(block.label, block.url)}</div>
        </div>
      );
    case 'image':
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <MiniField label="Image address" className="sm:col-span-2">
            <input
              className={`${compactInputClass} w-full font-mono text-xs`}
              placeholder="https://..."
              {...field(block.src, (src) => onChange({ ...block, src }))}
            />
          </MiniField>
          <MiniField label="Description (for screen readers)">
            <input
              className={`${compactInputClass} w-full`}
              placeholder="e.g. The sauna at sunset"
              {...field(block.alt, (alt) => onChange({ ...block, alt }))}
            />
          </MiniField>
          <MiniField label="Links to (optional)" className="sm:col-span-3">
            <input
              className={`${compactInputClass} w-full font-mono text-xs`}
              placeholder="https://..."
              {...field(block.href ?? '', (href) =>
                onChange({ ...block, ...(href ? { href } : { href: undefined }) })
              )}
            />
          </MiniField>
          {block.href && (
            <div className="sm:col-span-3">{tracked(block.alt || 'image', block.href)}</div>
          )}
        </div>
      );
    case 'divider':
      return <p className="text-xs text-white/40">A thin line between sections.</p>;
  }
}

/** A small label above a field inside a block. */
function MiniField({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs text-white/60">{label}</span>
      {children}
    </label>
  );
}

/** The link as it will actually be sent, so nobody has to build tracked links by hand. */
function TrackedLink({
  url,
  label,
  campaign,
  stepKey,
}: {
  url: string;
  label: string;
  campaign: string;
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
    sent = journeyLink(raw, campaign, journeyLinkContent(stepKey, label, raw));
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
