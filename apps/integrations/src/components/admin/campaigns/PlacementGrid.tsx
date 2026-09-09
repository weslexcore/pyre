// The placement tiles: one click generates the link for a standard
// placement. A second click on the same tile asks for a variant instead of
// making a duplicate; the partner and custom tiles ask for their inputs
// first. Everything is sent to the server as "which placement", never as a
// URL — the server owns the utm values.

import { useMemo, useState } from 'react';
import { placementUtm } from '@/lib/campaigns/links';
import {
  PLACEMENT_GROUPS,
  PLACEMENT_MEDIUMS,
  PLACEMENT_SOURCES,
  PLACEMENTS,
  type Placement,
} from '@/lib/campaigns/placements';
import { slugifyPart } from '@/lib/campaigns/slug';
import type { BlogPostRef, LinkRow } from '@/lib/campaigns/types';
import { FIELD_LIMITS } from '@/lib/campaigns/validate';
import { buttonClass, inputClass, primaryButtonClass } from '../incidentUi';
import { smallLabelClass, UtmChip } from './campaignUi';
import { DestinationPicker, type DestinationValue, type EventsState } from './DestinationPicker';

export interface GenerateRequest {
  placementKey: string;
  variant: string;
  sourceOverride?: string;
  custom?: { source: string; medium: string; content: string; term: string };
  destination?: DestinationValue;
}

const EMPTY_CUSTOM = { source: '', medium: '', content: '', term: '' };

export function PlacementGrid({
  links,
  slug,
  destinationSet,
  origin,
  blogPosts,
  events,
  busyKey,
  error,
  onGenerate,
}: {
  links: LinkRow[];
  slug: string;
  destinationSet: boolean;
  origin: string;
  blogPosts: BlogPostRef[];
  events: EventsState;
  /** The placement currently being generated, for the tile's busy state. */
  busyKey: string | null;
  error: string | null;
  onGenerate: (req: GenerateRequest) => Promise<boolean>;
}) {
  const [open, setOpen] = useState<Placement | null>(null);
  const [variant, setVariant] = useState('');
  const [sourceOverride, setSourceOverride] = useState('');
  const [custom, setCustom] = useState(EMPTY_CUSTOM);
  const [overrideDestination, setOverrideDestination] = useState(false);
  const [destination, setDestination] = useState<DestinationValue>({ kind: 'home', value: '' });

  const countByKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of links) {
      counts.set(link.placementKey, (counts.get(link.placementKey) ?? 0) + 1);
    }
    return counts;
  }, [links]);

  const reset = () => {
    setOpen(null);
    setVariant('');
    setSourceOverride('');
    setCustom(EMPTY_CUSTOM);
    setOverrideDestination(false);
  };

  const clickTile = (placement: Placement) => {
    if (!destinationSet) return;
    const generated = countByKey.get(placement.key) ?? 0;
    const needsPanel = placement.custom || placement.askSource || generated > 0;
    if (needsPanel) {
      setOpen(placement);
      setVariant('');
      return;
    }
    void onGenerate({ placementKey: placement.key, variant: '' });
  };

  const submitPanel = async () => {
    if (!open) return;
    const ok = await onGenerate({
      placementKey: open.key,
      variant,
      sourceOverride: open.askSource ? sourceOverride : undefined,
      custom: open.custom ? custom : undefined,
      destination: overrideDestination ? destination : undefined,
    });
    if (ok) reset();
  };

  const preview = open
    ? placementUtm(open, variant, sourceOverride, open.custom ? custom : undefined)
    : null;
  const repeat = open ? (countByKey.get(open.key) ?? 0) > 0 && !open.custom : false;
  const canSubmit =
    !!open &&
    (!open.askSource || sourceOverride.trim() !== '') &&
    (!open.custom || (custom.source.trim() !== '' && custom.medium.trim() !== '')) &&
    (!repeat || slugifyPart(variant) !== '');

  return (
    <div className="space-y-4">
      {PLACEMENT_GROUPS.map((group) => {
        const items = PLACEMENTS.filter((p) => p.group === group.key);
        if (items.length === 0) return null;
        return (
          <div key={group.key}>
            <span className={smallLabelClass}>{group.label}</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {items.map((placement) => {
                const count = countByKey.get(placement.key) ?? 0;
                const busy = busyKey === placement.key;
                const selected = open?.key === placement.key;
                return (
                  <button
                    key={placement.key}
                    type="button"
                    disabled={!destinationSet || busy}
                    aria-pressed={selected}
                    onClick={() => clickTile(placement)}
                    className={`rounded border px-3 py-3 text-left transition-colors disabled:opacity-40 ${
                      selected
                        ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
                        : count > 0
                          ? 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-creme)] hover:border-[var(--pyre-sage)]'
                          : 'border-white/10 bg-white/5 text-white/80 hover:border-white/30'
                    }`}
                  >
                    <span className="block text-sm font-primary-semibold leading-tight">
                      {placement.label}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-white/45">
                      {busy
                        ? 'Generating…'
                        : count > 0
                          ? `${count} link${count === 1 ? '' : 's'}. Click for a variant`
                          : placement.custom
                            ? 'Set your own values'
                            : placement.askSource
                              ? 'Asks for the partner'
                              : 'Click to generate'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {open && (
        <div className="rounded border border-white/15 bg-white/5 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-primary-semibold text-base text-[var(--pyre-creme)]">
                {open.label}
              </h3>
              <p className="text-xs text-white/50">
                {repeat
                  ? 'This placement already has a link. Give this one a variant so the two can be told apart.'
                  : open.hint}
              </p>
            </div>
            <button type="button" onClick={reset} className={buttonClass}>
              Close
            </button>
          </div>

          {open.askSource && (
            <div>
              <label htmlFor="placement-source" className={smallLabelClass}>
                {open.askSource}
              </label>
              <input
                id="placement-source"
                className={inputClass}
                value={sourceOverride}
                maxLength={FIELD_LIMITS.customValue}
                placeholder="Body Fit Training"
                onChange={(e) => setSourceOverride(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {open.custom && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  ['source', 'utm_source', 'where it is posted', PLACEMENT_SOURCES],
                  ['medium', 'utm_medium', 'the kind of channel', PLACEMENT_MEDIUMS],
                  ['content', 'utm_content', 'optional, which link', []],
                  ['term', 'utm_term', 'optional, paid keyword', []],
                ] as const
              ).map(([field, name, hint, suggestions]) => (
                <div key={field}>
                  <label htmlFor={`custom-${field}`} className={smallLabelClass}>
                    {name} <span className="normal-case text-white/30">{hint}</span>
                  </label>
                  <input
                    id={`custom-${field}`}
                    className={inputClass}
                    list={suggestions.length ? `custom-${field}-list` : undefined}
                    value={custom[field]}
                    maxLength={FIELD_LIMITS.customValue}
                    onChange={(e) => setCustom({ ...custom, [field]: e.target.value })}
                    autoComplete="off"
                  />
                  {suggestions.length > 0 && (
                    <datalist id={`custom-${field}-list`}>
                      {suggestions.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                </div>
              ))}
            </div>
          )}

          <div>
            <label htmlFor="placement-variant" className={smallLabelClass}>
              Variant {repeat ? '' : '(optional)'}
            </label>
            <input
              id="placement-variant"
              className={inputClass}
              value={variant}
              maxLength={FIELD_LIMITS.variant}
              placeholder={
                repeat ? 'v2, footer, week-2' : 'Leave blank unless you need two links here'
              }
              onChange={(e) => setVariant(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 font-mono text-xs text-white/50">
              <input
                type="checkbox"
                checked={overrideDestination}
                onChange={(e) => setOverrideDestination(e.target.checked)}
              />
              Send this link somewhere other than the campaign destination
            </label>
            {overrideDestination && (
              <div className="mt-3">
                <DestinationPicker
                  origin={origin}
                  blogPosts={blogPosts}
                  events={events}
                  value={destination}
                  onChange={setDestination}
                  compact
                />
              </div>
            )}
          </div>

          {preview && (
            <div className="flex flex-wrap gap-1.5">
              <UtmChip name="utm_source" value={preview.source || '?'} />
              <UtmChip name="utm_medium" value={preview.medium || '?'} />
              <UtmChip name="utm_campaign" value={slug} />
              <UtmChip name="utm_content" value={preview.content} />
              <UtmChip name="utm_term" value={preview.term} />
            </div>
          )}

          <button
            type="button"
            disabled={!canSubmit || busyKey !== null}
            onClick={() => void submitPanel()}
            className={primaryButtonClass}
          >
            {busyKey ? 'Generating…' : 'Generate link'}
          </button>
        </div>
      )}
    </div>
  );
}
