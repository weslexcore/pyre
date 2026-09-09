// One generated link: what it is, the two URLs (with the one the placement
// says to paste highlighted), its utm values, clicks, and a QR on demand
// with its own saved style.

import { useEffect, useRef, useState } from 'react';
import { qrFilename } from '@/lib/campaigns/links';
import { placementByKey } from '@/lib/campaigns/placements';
import type { LinkRow as LinkRowData, UtmCampaign } from '@/lib/campaigns/types';
import { FIELD_LIMITS } from '@/lib/campaigns/validate';
import { type QrStyle, qrStyleOf } from '@/lib/qr/style';
import { ConfirmDialog } from '../ConfirmDialog';
import { CopyButton } from '../CopyButton';
import { buttonClass, inputClass } from '../incidentUi';
import { QrCode } from '../qr/QrCode';
import { QrStyleControls } from '../qr/QrStyleControls';
import { linkTitle, UtmChip } from './campaignUi';

/** Quiet time after the last style tweak before it is written to the link. */
const STYLE_SAVE_DELAY_MS = 600;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function LinkRow({
  link,
  campaign,
  busy,
  onRelabel,
  onMintShort,
  onSaveQrStyle,
  onDelete,
}: {
  link: LinkRowData;
  campaign: UtmCampaign;
  busy: boolean;
  onRelabel: (label: string) => Promise<void>;
  onMintShort: () => Promise<void>;
  /** Persist this link's QR style. Resolves on success, rejects on failure. */
  onSaveQrStyle: (style: QrStyle) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [showQr, setShowQr] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [qrStyle, setQrStyle] = useState<QrStyle>(() => qrStyleOf(link.qrStyle));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [confirming, setConfirming] = useState(false);

  // Debounced autosave: every tweak restarts the timer; the last style wins.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStyle = useRef(qrStyle);
  latestStyle.current = qrStyle;

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const changeStyle = (next: QrStyle) => {
    setQrStyle(next);
    setSaveState('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const style = latestStyle.current;
      setSaveState('saving');
      onSaveQrStyle(style)
        .then(() => setSaveState((s) => (s === 'saving' ? 'saved' : s)))
        .catch(() => setSaveState('error'));
    }, STYLE_SAVE_DELAY_MS);
  };

  const placement = placementByKey(link.placementKey);
  const preferShort = placement?.preferShort ?? false;
  const qrTarget = link.shortUrl ?? link.url;

  const saveNote =
    saveState === 'pending' || saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Could not save this style'
          : '';

  return (
    <li className="rounded border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-primary-semibold text-sm text-[var(--pyre-creme)]">
            {linkTitle(link)}
            {link.label && <span className="ml-2 font-normal text-white/50">{link.label}</span>}
          </h4>
          {placement?.hint && <p className="text-xs text-white/45">{placement.hint}</p>}
        </div>
        <span className="font-mono text-xs text-white/50 tabular-nums">
          {link.clicks} click{link.clicks === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-2">
        {link.shortUrl && (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1.5 font-mono text-xs text-[var(--pyre-creme)]">
              {link.shortUrl}
            </code>
            <CopyButton value={link.shortUrl} label="Copy short link" primary={preferShort} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1.5 font-mono text-xs text-white/70">
            {link.url}
          </code>
          <CopyButton
            value={link.url}
            label="Copy full link"
            primary={!preferShort || !link.shortUrl}
          />
        </div>
        {!link.shortUrl && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onMintShort()}
            className={buttonClass}
          >
            Create short link
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <UtmChip name="utm_source" value={link.source} />
        <UtmChip name="utm_medium" value={link.medium} />
        <UtmChip name="utm_campaign" value={link.campaign} />
        <UtmChip name="utm_content" value={link.content} />
        <UtmChip name="utm_term" value={link.term} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setShowQr((v) => !v)} className={buttonClass}>
          {showQr ? 'Hide QR' : 'QR code'}
        </button>
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onRelabel(label).then(() => setEditing(false));
            }}
          >
            <input
              className={`${inputClass} !py-1.5 !text-xs w-56`}
              value={label}
              maxLength={FIELD_LIMITS.label}
              placeholder="Note for the team"
              onChange={(e) => setLabel(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" disabled={busy} className={buttonClass}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setLabel(link.label);
                setEditing(false);
              }}
              className={buttonClass}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
            {link.label ? 'Edit note' : 'Add note'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${buttonClass} ml-auto text-[var(--pyre-red)]/80 hover:text-[var(--pyre-red)]`}
        >
          Delete
        </button>
      </div>

      {showQr && (
        <div className="space-y-3 pt-2">
          <QrCode
            url={qrTarget}
            filename={qrFilename([campaign.slug, link.placementKey || 'custom', link.variant])}
            style={qrStyle}
          />
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowStyle((v) => !v)}
              className="text-xs font-mono-bold uppercase tracking-wide text-white/50 hover:text-[var(--pyre-creme)] transition-colors"
            >
              {showStyle ? 'Hide style' : 'Style'}
            </button>
            {saveNote && (
              <span
                className={`font-mono text-[10px] uppercase tracking-wide ${
                  saveState === 'error' ? 'text-[var(--pyre-red)]' : 'text-white/40'
                }`}
              >
                {saveNote}
              </span>
            )}
          </div>
          {showStyle && (
            <div>
              <p className="text-xs text-white/45">
                This style is saved with this link only, so every admin sees the same code.
              </p>
              <QrStyleControls style={qrStyle} onChange={changeStyle} />
            </div>
          )}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this link?"
          body={
            link.shortUrl
              ? 'Its short link stops working too. Anything already printed or posted with it will send people to the home page.'
              : 'Anything already posted with this link keeps working, but it will no longer be listed here.'
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => void onDelete().then(() => setConfirming(false))}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}
