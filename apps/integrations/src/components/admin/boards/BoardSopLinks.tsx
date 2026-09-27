// The SOPs linked to a board, as its settings edit them: the linked list,
// each with a Remove, and a picker of the rest of the library grouped by
// section. Every change saves at once (PUT /api/admin/board-sops) — there is
// nothing to draft in a list of pointers. The board and each linked SOP show
// the link to whoever may open the other side (lib/boards/sops).

import { useEffect, useState } from 'react';
import type { LinkedSop, SopOption } from '@/lib/boards/sops';
import { readError, sendJson } from '@/lib/client/api';
import { labelClass, SectionTitle, selectClass } from '../goalsUi';

export function BoardSopLinks({ slug, onSaved }: { slug: string; onSaved: () => void }) {
  const [linked, setLinked] = useState<LinkedSop[] | null>(null);
  const [options, setOptions] = useState<SopOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/board-sops?board=${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as { linked: LinkedSop[]; options: SopOption[] };
        if (cancelled) return;
        setLinked(body.linked);
        setOptions(body.options);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the SOPs');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const save = async (next: LinkedSop[]) => {
    const previous = linked;
    setLinked(next);
    setSaving(true);
    try {
      const body = await sendJson<{ linked: LinkedSop[] }>('/api/admin/board-sops', 'PUT', {
        board: slug,
        sopIds: next.map((sop) => sop.id),
      });
      setLinked(body.linked);
      setError(null);
      onSaved();
    } catch (e) {
      setLinked(previous);
      setError(e instanceof Error ? e.message : 'Could not save the SOPs');
    } finally {
      setSaving(false);
    }
  };

  const linkedIds = new Set((linked ?? []).map((sop) => sop.id));
  const unlinked = options.filter((option) => !linkedIds.has(option.id));
  const sections = [...new Set(unlinked.map((option) => option.category))];

  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <SectionTitle note="how the work is done">SOPs</SectionTitle>
      <p className="text-xs text-white/35">
        Linked SOPs show at the top of the board, and each SOP links back here. People only see the
        ones they are allowed to open.
      </p>

      {linked === null && !error && (
        <p className="mt-2 font-mono text-xs text-white/40">Loading…</p>
      )}

      {linked && linked.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {linked.map((sop) => (
            <li
              key={sop.id}
              className="flex items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-1.5"
            >
              <a
                className="min-w-0 truncate text-sm text-[var(--pyre-creme)] hover:text-[var(--pyre-gold)]"
                href={`/admin/sops/${sop.slug}`}
              >
                {sop.title}
              </a>
              <button
                type="button"
                className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-[var(--pyre-red)] disabled:opacity-40"
                disabled={saving}
                onClick={() => void save(linked.filter((other) => other.id !== sop.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {linked && (
        <div className="mt-3">
          <label className={labelClass} htmlFor={`board-sop-add-${slug}`}>
            Link an SOP
          </label>
          <select
            id={`board-sop-add-${slug}`}
            className={selectClass}
            value=""
            disabled={saving || unlinked.length === 0}
            onChange={(e) => {
              const picked = unlinked.find((option) => option.id === e.target.value);
              if (picked)
                void save([...linked, { id: picked.id, slug: picked.slug, title: picked.title }]);
            }}
          >
            <option value="">
              {unlinked.length === 0 ? 'Every SOP is already linked' : 'Choose an SOP'}
            </option>
            {sections.map((section) => (
              <optgroup key={section} label={section}>
                {unlinked
                  .filter((option) => option.category === section)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}
    </div>
  );
}
