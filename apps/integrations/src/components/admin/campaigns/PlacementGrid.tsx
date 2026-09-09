// The placement tiles: one click generates the link for a standard
// placement. A second click on the same tile asks for a variant instead of
// making a duplicate; the partner and custom tiles ask for their inputs
// first. Everything is sent to the server as "which placement", never as a
// URL — the server owns the utm values.
//
// The Email newsletter tile also offers the blog list: tick posts and it
// generates one link per post, each opening that post with utm_content
// naming it, which is the monthly "what's going on" email's whole job.

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
const NEWSLETTER_KEY = 'email-newsletter';

/** The variant a blog post link gets: its slug, trimmed to the field limit. */
export function blogVariant(postSlug: string): string {
  return slugifyPart(postSlug).slice(0, FIELD_LIMITS.variant).replace(/-+$/, '');
}

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
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);

  const countByKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of links) {
      counts.set(link.placementKey, (counts.get(link.placementKey) ?? 0) + 1);
    }
    return counts;
  }, [links]);

  // Posts this campaign already has a newsletter link for, so they read as
  // done rather than inviting a duplicate.
  const linkedPosts = useMemo(() => {
    const done = new Set<string>();
    for (const link of links) {
      if (link.placementKey === NEWSLETTER_KEY && link.destination.startsWith('blog:')) {
        done.add(link.destination.slice('blog:'.length));
      }
    }
    return done;
  }, [links]);

  const reset = () => {
    setOpen(null);
    setVariant('');
    setSourceOverride('');
    setCustom(EMPTY_CUSTOM);
    setOverrideDestination(false);
    setSelectedPosts([]);
  };

  const clickTile = (placement: Placement) => {
    if (!destinationSet) return;
    const generated = countByKey.get(placement.key) ?? 0;
    const offersPosts = placement.key === NEWSLETTER_KEY && blogPosts.length > 0;
    const needsPanel = placement.custom || placement.askSource || generated > 0 || offersPosts;
    if (needsPanel) {
      setOpen(placement);
      setVariant('');
      setSelectedPosts([]);
      return;
    }
    void onGenerate({ placementKey: placement.key, variant: '' });
  };

  const submitPanel = async () => {
    if (!open) return;
    if (selectedPosts.length > 0) {
      // One link per post, in order; stop at the first failure so its error
      // is the one on screen and the remaining posts stay ticked.
      for (const postSlug of selectedPosts) {
        const ok = await onGenerate({
          placementKey: open.key,
          variant: blogVariant(postSlug),
          destination: { kind: 'blog', value: postSlug },
        });
        if (!ok) return;
        setSelectedPosts((current) => current.filter((s) => s !== postSlug));
      }
      return;
    }
    const ok = await onGenerate({
      placementKey: open.key,
      variant,
      sourceOverride: open.askSource ? sourceOverride : undefined,
      custom: open.custom ? custom : undefined,
      destination: overrideDestination ? destination : undefined,
    });
    if (ok) reset();
  };

  const togglePost = (postSlug: string) =>
    setSelectedPosts((current) =>
      current.includes(postSlug) ? current.filter((s) => s !== postSlug) : [...current, postSlug]
    );

  const preview = open
    ? placementUtm(open, variant, sourceOverride, open.custom ? custom : undefined)
    : null;
  const repeat = open ? (countByKey.get(open.key) ?? 0) > 0 && !open.custom : false;
  const postsMode = selectedPosts.length > 0;
  const showPosts = open?.key === NEWSLETTER_KEY && blogPosts.length > 0;
  const canSubmit =
    !!open &&
    (postsMode ||
      ((!open.askSource || sourceOverride.trim() !== '') &&
        (!open.custom || (custom.source.trim() !== '' && custom.medium.trim() !== '')) &&
        (!repeat || slugifyPart(variant) !== '')));

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
                          ? `${count} link${count === 1 ? '' : 's'}. Click for another`
                          : placement.custom
                            ? 'Set your own values'
                            : placement.askSource
                              ? 'Asks for the partner'
                              : placement.key === NEWSLETTER_KEY && blogPosts.length > 0
                                ? 'Main link or blog posts'
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
                {postsMode
                  ? `One link per post, each opening that post. ${selectedPosts.length} selected.`
                  : repeat
                    ? 'This placement already has a link. Give this one a variant so the two can be told apart.'
                    : open.hint}
              </p>
            </div>
            <button type="button" onClick={reset} className={buttonClass}>
              Close
            </button>
          </div>

          {showPosts && (
            <div>
              <span className={smallLabelClass}>Link to blog posts</span>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded border border-white/10 bg-black/20 p-2">
                {blogPosts.map((post) => {
                  const done = linkedPosts.has(post.slug);
                  const checked = selectedPosts.includes(post.slug);
                  return (
                    <li key={post.slug}>
                      <label
                        className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5 ${
                          done ? 'text-white/40' : 'text-white/80'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          disabled={done}
                          onChange={() => togglePost(post.slug)}
                        />
                        <span className="min-w-0">
                          <span className="block leading-tight">{post.title}</span>
                          <span className="block font-mono text-[10px] text-white/35">
                            {done ? 'Already linked' : `utm_content=cta-${blogVariant(post.slug)}`}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-xs text-white/40">
                Leave every post unticked to generate the email's main link to the campaign
                destination instead.
              </p>
            </div>
          )}

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

          {!postsMode && (
            <>
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
            </>
          )}

          <button
            type="button"
            disabled={!canSubmit || busyKey !== null}
            onClick={() => void submitPanel()}
            className={primaryButtonClass}
          >
            {busyKey
              ? 'Generating…'
              : postsMode
                ? `Generate ${selectedPosts.length} link${selectedPosts.length === 1 ? '' : 's'}`
                : 'Generate link'}
          </button>
        </div>
      )}
    </div>
  );
}
