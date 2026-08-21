// The incident report form (/admin/incidents/new). Designed to be filled out
// on a phone, one-handed, by someone who has just finished dealing with the
// situation itself.
//
// Shape of the thing:
//   * Six short steps instead of one long scroll, so no screen asks more than
//     a few questions and progress is always visible.
//   * The two steps that carry legal weight — what happened, and when/where —
//     come first and are required. People, evidence, and conditions can be
//     filled in as they become known; a thin report filed now beats a
//     complete one filed never.
//   * Photos and video are held locally and uploaded after the report itself
//     is saved, so a failed upload on bathhouse wifi can never cost the
//     report. If an upload fails, the report page can take it later.
//   * Every keystroke is mirrored into localStorage. A phone that locks, a
//     browser that reaps the tab, a mis-tap on Back — the draft survives all
//     of them. It is cleared the moment the report is filed.
//
// Auth is handled by AdminLayout and re-checked by /api/admin/incidents on
// every request; this island only mirrors the rules.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { IncidentRow } from '@/lib/db';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  formatBytes,
  kindForMime,
  MAX_ATTACHMENTS_PER_INCIDENT,
} from '@/lib/incidents/media';
import {
  type AffectedPerson,
  AREA_LABELS,
  BODY_PARTS,
  CATEGORY_OPTIONS,
  CONTRIBUTING_FACTORS,
  emptyAffectedPerson,
  emptyWitness,
  FACTOR_LABELS,
  INCIDENT_AREAS,
  type IncidentArea,
  type IncidentCategory,
  type IncidentSeverity,
  PERSON_ROLE_LABELS,
  PERSON_ROLES,
  SEVERITY_OPTIONS,
  type Witness,
} from '@/lib/incidents/types';
import { FIELD_LIMITS } from '@/lib/incidents/validate';
import {
  buttonClass,
  Chip,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  readError,
  SectionTitle,
  TileButton,
  YesNo,
} from './incidentUi';

const DRAFT_KEY = 'pyre.incident-draft.v1';

interface FormState {
  category: IncidentCategory | '';
  severity: IncidentSeverity | '';
  /** datetime-local value ("2026-08-21T19:42"), i.e. device wall-clock. */
  occurredAtLocal: string;
  area: IncidentArea | '';
  areaDetail: string;
  affectedPeople: AffectedPerson[];
  witnesses: Witness[];
  staffPresent: string[];
  description: string;
  immediateActions: string;
  firstAidGiven: boolean;
  firstAidBy: string;
  emsCalled: boolean;
  policeCalled: boolean;
  transportedToHospital: boolean;
  treatmentRefused: boolean;
  guestLeftPremises: boolean | null;
  guestInformedOfReport: boolean | null;
  contributingFactors: string[];
  equipmentInvolved: string;
  saunaTempF: string;
  waterTempF: string;
  followUpRequired: boolean;
  followUpNotes: string;
}

/** "2026-08-21T19:42" for a Date, in the device's own clock. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initialState(): FormState {
  return {
    category: '',
    severity: '',
    occurredAtLocal: toLocalInputValue(new Date()),
    area: '',
    areaDetail: '',
    affectedPeople: [],
    witnesses: [],
    staffPresent: [],
    description: '',
    immediateActions: '',
    firstAidGiven: false,
    firstAidBy: '',
    emsCalled: false,
    policeCalled: false,
    transportedToHospital: false,
    treatmentRefused: false,
    guestLeftPremises: null,
    guestInformedOfReport: null,
    contributingFactors: [],
    equipmentInvolved: '',
    saunaTempF: '',
    waterTempF: '',
    followUpRequired: false,
    followUpNotes: '',
  };
}

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
  caption: string;
  status: 'ready' | 'uploading' | 'done' | 'failed';
  error?: string;
}

const STEPS = [
  { key: 'what', title: 'What happened' },
  { key: 'when', title: 'When and where' },
  { key: 'who', title: 'Who was involved' },
  { key: 'account', title: 'The account' },
  { key: 'evidence', title: 'Photos and conditions' },
  { key: 'review', title: 'Review and file' },
] as const;

export function IncidentForm({ reporterName }: { reporterName: string }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialState);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const patch = useCallback((changes: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  }, []);

  // Restore a draft left behind by a locked phone or a closed tab. Files
  // can't be serialized, so only the text comes back — the notice says so.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { form?: FormState; step?: number };
      if (saved.form) {
        setForm({ ...initialState(), ...saved.form });
        setStep(Math.min(saved.step ?? 0, STEPS.length - 1));
        setDraftRestored(true);
      }
    } catch {
      // A corrupt draft is not worth a broken form.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step }));
    } catch {
      // Private mode / quota — autosave is a convenience, not a requirement.
    }
  }, [form, step]);

  // Object URLs for the thumbnails are revoked when the component goes away.
  // The live list is mirrored into a ref so the unmount cleanup can read it
  // without re-registering (and re-running) on every file change.
  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    previewUrlsRef.current = files
      .map((f) => f.previewUrl)
      .filter((url): url is string => url !== null);
  }, [files]);
  useEffect(
    () => () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    },
    []
  );

  const goTo = (next: number) => {
    setStep(Math.max(0, Math.min(next, STEPS.length - 1)));
    setError(null);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** What still blocks leaving this step, in words the reporter can act on. */
  const blockerFor = useCallback(
    (index: number): string | null => {
      switch (index) {
        case 0:
          if (!form.category) return 'Pick what kind of incident this was.';
          if (!form.severity) return 'Pick how serious it was.';
          return null;
        case 1:
          if (!form.occurredAtLocal) return 'Set when it happened.';
          if (Date.parse(form.occurredAtLocal) > Date.now() + 5 * 60_000) {
            return 'The time is in the future — check the date.';
          }
          if (!form.area) return 'Pick where in the building it happened.';
          return null;
        case 3:
          if (form.description.trim().length < 10) {
            return 'Describe what happened — a sentence or two is enough.';
          }
          if (form.immediateActions.trim().length < 5) {
            return 'Say what you did about it (write "nothing" if that is the truth).';
          }
          return null;
        default:
          return null;
      }
    },
    [form]
  );

  const blocker = blockerFor(step);
  const firstIncompleteStep = useMemo(() => {
    for (let i = 0; i < STEPS.length; i += 1) if (blockerFor(i)) return i;
    return null;
  }, [blockerFor]);

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFileError(null);

    const room = MAX_ATTACHMENTS_PER_INCIDENT - files.length;
    if (room <= 0) {
      setFileError(`A report can carry ${MAX_ATTACHMENTS_PER_INCIDENT} attachments at most.`);
      return;
    }

    const incoming = Array.from(list).slice(0, room);
    if (incoming.length < list.length) {
      setFileError(
        `Only the first ${incoming.length} were added — the limit is ${MAX_ATTACHMENTS_PER_INCIDENT}.`
      );
    }

    const prepared: PendingFile[] = [];
    for (const original of incoming) {
      const problem = checkFile(original);
      if (problem) {
        setFileError(problem);
        continue;
      }
      // Shrink big phone photos before they ever hit the network.
      const file = await downscaleImage(original);
      prepared.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: kindForMime(file.type) === 'photo' ? URL.createObjectURL(file) : null,
        caption: '',
        status: 'ready',
      });
    }
    if (prepared.length > 0) setFiles((prev) => [...prev, ...prepared]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const buildPayload = () => ({
    category: form.category,
    severity: form.severity,
    occurredAt: new Date(form.occurredAtLocal).toISOString(),
    area: form.area,
    areaDetail: form.areaDetail,
    affectedPeople: form.affectedPeople,
    witnesses: form.witnesses,
    staffPresent: form.staffPresent,
    description: form.description,
    immediateActions: form.immediateActions,
    firstAidGiven: form.firstAidGiven,
    firstAidBy: form.firstAidBy,
    emsCalled: form.emsCalled,
    // The reporter is filing right after the fact, so "when EMS was called" is
    // near enough to now; a reviewer can correct it on the report page.
    emsCalledAt: form.emsCalled ? new Date().toISOString() : null,
    policeCalled: form.policeCalled,
    transportedToHospital: form.transportedToHospital,
    treatmentRefused: form.treatmentRefused,
    guestLeftPremises: form.guestLeftPremises,
    guestInformedOfReport: form.guestInformedOfReport,
    contributingFactors: form.contributingFactors,
    equipmentInvolved: form.equipmentInvolved,
    saunaTempF: form.saunaTempF.trim() === '' ? null : Number(form.saunaTempF),
    waterTempF: form.waterTempF.trim() === '' ? null : Number(form.waterTempF),
    followUpRequired: form.followUpRequired,
    followUpNotes: form.followUpNotes,
  });

  const submit = async () => {
    if (firstIncompleteStep !== null) {
      goTo(firstIncompleteStep);
      setError(blockerFor(firstIncompleteStep));
      return;
    }

    setSubmitting(true);
    setError(null);
    setProgress('Filing the report…');

    try {
      const res = await fetch('/api/admin/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        setError(await readError(res));
        setSubmitting(false);
        setProgress(null);
        return;
      }

      const { incident } = (await res.json()) as { incident: IncidentRow };

      // The report exists from here on. Uploads are best-effort on top of it:
      // whatever fails can be added later from the report page.
      let failed = 0;
      for (let i = 0; i < files.length; i += 1) {
        const pending = files[i];
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        setFiles((prev) =>
          prev.map((f) => (f.id === pending.id ? { ...f, status: 'uploading' } : f))
        );

        const body = new FormData();
        body.set('incidentId', incident.id);
        body.set('file', pending.file);
        if (pending.caption.trim()) body.set('caption', pending.caption.trim());

        try {
          const upload = await fetch('/api/admin/incident-media', { method: 'POST', body });
          const ok = upload.ok;
          const message = ok ? undefined : await readError(upload);
          if (!ok) failed += 1;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pending.id ? { ...f, status: ok ? 'done' : 'failed', error: message } : f
            )
          );
        } catch {
          failed += 1;
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pending.id ? { ...f, status: 'failed', error: 'Network error' } : f
            )
          );
        }
      }

      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to do — the draft is cosmetic at this point.
      }

      // A new report changes every cached page of the log.
      invalidateJson('/api/admin/incidents');

      const suffix = failed > 0 ? '?uploads=failed' : '';
      window.location.href = `/admin/incidents/${incident.id}${suffix}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file the report');
      setSubmitting(false);
      setProgress(null);
    }
  };

  const discardDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore.
    }
    for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    setFiles([]);
    setForm(initialState());
    setStep(0);
    setDraftRestored(false);
  };

  return (
    <div ref={topRef} className="space-y-5 pb-28">
      {draftRestored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2.5">
          <p className="text-xs text-[var(--pyre-gold)]">
            Picked up an unfinished report from this device. Photos aren't saved in a draft — add
            them again on step 5.
          </p>
          <button type="button" className={buttonClass} onClick={discardDraft}>
            Start over
          </button>
        </div>
      )}

      <StepBar step={step} onJump={goTo} blockerFor={blockerFor} />

      {step === 0 && (
        <section className="space-y-6">
          <div>
            <SectionTitle note="Closest match is fine — a reviewer can re-file it.">
              What kind of incident was this?
            </SectionTitle>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <TileButton
                  key={opt.value}
                  selected={form.category === opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  onClick={() => patch({ category: opt.value })}
                />
              ))}
            </div>
          </div>

          <div>
            <SectionTitle note="Judge it by what the person needed, not by how it looked.">
              How serious was it?
            </SectionTitle>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SEVERITY_OPTIONS.map((opt) => (
                <TileButton
                  key={opt.value}
                  selected={form.severity === opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  onClick={() => patch({ severity: opt.value })}
                />
              ))}
            </div>
            {(form.severity === 'severe' || form.severity === 'critical') && (
              <p className="mt-3 rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-2 text-xs text-[var(--pyre-creme)]">
                Filing this emails management right away. If anyone is still in danger, call 911
                first and file afterward.
              </p>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-6">
          <div>
            <SectionTitle note="Best estimate is fine. The gap between when it happened and when it was reported is part of the record.">
              When did it happen?
            </SectionTitle>
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                { label: 'Just now', minutes: 0 },
                { label: '15 min ago', minutes: 15 },
                { label: '30 min ago', minutes: 30 },
                { label: '1 hour ago', minutes: 60 },
                { label: '2 hours ago', minutes: 120 },
              ].map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  selected={false}
                  onClick={() =>
                    patch({
                      occurredAtLocal: toLocalInputValue(
                        new Date(Date.now() - preset.minutes * 60_000)
                      ),
                    })
                  }
                />
              ))}
            </div>
            <input
              type="datetime-local"
              className={inputClass}
              value={form.occurredAtLocal}
              max={toLocalInputValue(new Date())}
              onChange={(e) => patch({ occurredAtLocal: e.target.value })}
            />
          </div>

          <div>
            <SectionTitle>Where in the building?</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INCIDENT_AREAS.map((area) => (
                <TileButton
                  key={area}
                  selected={form.area === area}
                  label={AREA_LABELS[area]}
                  onClick={() => patch({ area })}
                />
              ))}
            </div>
            <div className="mt-3">
              {/** biome-ignore lint/a11y/noLabelWithoutControl: label wraps its input below */}
              <label className={labelClass}>Exactly where (optional)</label>
              <input
                className={inputClass}
                placeholder="Second bench, left sauna — by the stove"
                maxLength={FIELD_LIMITS.areaDetail}
                value={form.areaDetail}
                onChange={(e) => patch({ areaDetail: e.target.value })}
              />
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <PeopleStep
          people={form.affectedPeople}
          witnesses={form.witnesses}
          staffPresent={form.staffPresent}
          onPeople={(affectedPeople) => patch({ affectedPeople })}
          onWitnesses={(witnesses) => patch({ witnesses })}
          onStaff={(staffPresent) => patch({ staffPresent })}
        />
      )}

      {step === 3 && (
        <section className="space-y-6">
          <div>
            <SectionTitle note="Facts only, in the order they happened. Leave out opinions about fault — this record can end up in front of an insurer.">
              What happened?
            </SectionTitle>
            <textarea
              className={`${inputClass} min-h-[160px]`}
              placeholder="Guest came out of the sauna, took two steps toward the cold plunge, and slipped on standing water by the drain. Landed on their left hip."
              maxLength={FIELD_LIMITS.description}
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
            <p className="mt-1 text-right font-mono text-[10px] text-white/30">
              {form.description.length}/{FIELD_LIMITS.description}
            </p>
          </div>

          <div>
            <SectionTitle note="Everything you and anyone else did, including what you told the guest.">
              What did you do about it?
            </SectionTitle>
            <textarea
              className={`${inputClass} min-h-[120px]`}
              placeholder="Helped them to the bench, brought water and ice, mopped the area and set out a wet-floor sign, offered to call someone."
              maxLength={FIELD_LIMITS.immediateActions}
              value={form.immediateActions}
              onChange={(e) => patch({ immediateActions: e.target.value })}
            />
          </div>

          <div className={cardClass}>
            <SectionTitle>Response</SectionTitle>
            <YesNo
              label="First aid given"
              value={form.firstAidGiven}
              onChange={(firstAidGiven) => patch({ firstAidGiven })}
            />
            {form.firstAidGiven && (
              <input
                className={`${inputClass} mt-2`}
                placeholder="Who gave it?"
                maxLength={FIELD_LIMITS.firstAidBy}
                value={form.firstAidBy}
                onChange={(e) => patch({ firstAidBy: e.target.value })}
              />
            )}
            <YesNo
              label="911 / EMS called"
              value={form.emsCalled}
              onChange={(emsCalled) => patch({ emsCalled })}
            />
            <YesNo
              label="Police called"
              value={form.policeCalled}
              onChange={(policeCalled) => patch({ policeCalled })}
            />
            <YesNo
              label="Taken to hospital or urgent care"
              value={form.transportedToHospital}
              onChange={(transportedToHospital) => patch({ transportedToHospital })}
            />
            <YesNo
              label="Treatment refused"
              hint="They turned down first aid or an ambulance"
              value={form.treatmentRefused}
              onChange={(treatmentRefused) => patch({ treatmentRefused })}
            />
            <YesNo
              label="They left the building"
              value={form.guestLeftPremises}
              onChange={(guestLeftPremises) => patch({ guestLeftPremises })}
            />
            <YesNo
              label="They know a report is being filed"
              value={form.guestInformedOfReport}
              onChange={(guestInformedOfReport) => patch({ guestInformedOfReport })}
            />
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="space-y-6">
          <div>
            <SectionTitle note="A photo of the floor, the equipment, or the injury is worth more than any description — take it before anything gets cleaned up.">
              Photos and video
            </SectionTitle>

            <div className="flex flex-wrap gap-2">
              <label className={`${buttonClass} cursor-pointer`}>
                📷 Take a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className={`${buttonClass} cursor-pointer`}>
                🎬 Add from library
                <input
                  type="file"
                  accept={ACCEPT_ATTRIBUTE}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {fileError && <p className="mt-2 text-xs text-[var(--pyre-red)]">{fileError}</p>}

            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((f) => (
                  <li key={f.id} className={`${cardClass} flex items-start gap-3`}>
                    {f.previewUrl ? (
                      <img
                        src={f.previewUrl}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-white/5 text-2xl">
                        {kindForMime(f.file.type) === 'video' ? '🎬' : '📄'}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white/80">{f.file.name}</p>
                      <p className="font-mono text-[10px] text-white/35">
                        {formatBytes(f.file.size)}
                      </p>
                      <input
                        className={`${inputClass} mt-1.5 py-2 text-sm`}
                        placeholder="Caption (optional)"
                        maxLength={FIELD_LIMITS.caption}
                        value={f.caption}
                        onChange={(e) =>
                          setFiles((prev) =>
                            prev.map((x) => (x.id === f.id ? { ...x, caption: e.target.value } : x))
                          )
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="shrink-0 px-2 py-1 font-mono text-xs text-white/40 hover:text-[var(--pyre-red)]"
                      onClick={() => removeFile(f.id)}
                      aria-label={`Remove ${f.file.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionTitle note="What made it possible. This is what a trends review reads to decide what to change about the building.">
              Anything that contributed?
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              {CONTRIBUTING_FACTORS.map((factor) => (
                <Chip
                  key={factor}
                  label={FACTOR_LABELS[factor]}
                  selected={form.contributingFactors.includes(factor)}
                  onClick={() =>
                    patch({
                      contributingFactors: form.contributingFactors.includes(factor)
                        ? form.contributingFactors.filter((f) => f !== factor)
                        : [...form.contributingFactors, factor],
                    })
                  }
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              {/** biome-ignore lint/a11y/noLabelWithoutControl: label wraps its input below */}
              <label className={labelClass}>Equipment involved</label>
              <input
                className={inputClass}
                placeholder="Left sauna stove"
                maxLength={FIELD_LIMITS.equipmentInvolved}
                value={form.equipmentInvolved}
                onChange={(e) => patch({ equipmentInvolved: e.target.value })}
              />
            </div>
            <div>
              {/** biome-ignore lint/a11y/noLabelWithoutControl: label wraps its input below */}
              <label className={labelClass}>Sauna temp (°F)</label>
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder="185"
                value={form.saunaTempF}
                onChange={(e) => patch({ saunaTempF: e.target.value })}
              />
            </div>
            <div>
              {/** biome-ignore lint/a11y/noLabelWithoutControl: label wraps its input below */}
              <label className={labelClass}>Water temp (°F)</label>
              <input
                className={inputClass}
                inputMode="decimal"
                placeholder="42"
                value={form.waterTempF}
                onChange={(e) => patch({ waterTempF: e.target.value })}
              />
            </div>
          </div>

          <div className={cardClass}>
            <YesNo
              label="Needs follow-up"
              hint="Something still has to be fixed, checked, or called about"
              value={form.followUpRequired}
              onChange={(followUpRequired) => patch({ followUpRequired })}
            />
            {form.followUpRequired && (
              <textarea
                className={`${inputClass} mt-2 min-h-[80px]`}
                placeholder="Drain by the plunge backs up whenever both showers run — maintenance should look at it."
                maxLength={FIELD_LIMITS.followUpNotes}
                value={form.followUpNotes}
                onChange={(e) => patch({ followUpNotes: e.target.value })}
              />
            )}
          </div>
        </section>
      )}

      {step === 5 && (
        <ReviewStep
          form={form}
          files={files}
          reporterName={reporterName}
          onJump={goTo}
          firstIncompleteStep={firstIncompleteStep}
        />
      )}

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {/* Sticky footer: the next action is always under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[var(--pyre-black)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            className={buttonClass}
            disabled={step === 0 || submitting}
            onClick={() => goTo(step - 1)}
          >
            Back
          </button>

          <span className="min-w-0 flex-1 truncate text-center font-mono text-[10px] uppercase tracking-wide text-white/35">
            {progress ?? blocker ?? `Step ${step + 1} of ${STEPS.length}`}
          </span>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!!blocker || submitting}
              onClick={() => goTo(step + 1)}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className={primaryButtonClass}
              disabled={submitting || firstIncompleteStep !== null}
              onClick={() => void submit()}
            >
              {submitting ? 'Filing…' : 'File report'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBar({
  step,
  onJump,
  blockerFor,
}: {
  step: number;
  onJump: (next: number) => void;
  blockerFor: (index: number) => string | null;
}) {
  return (
    <nav className="flex gap-1" aria-label="Report progress">
      {STEPS.map((s, i) => {
        const done = i < step && !blockerFor(i);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onJump(i)}
            title={s.title}
            aria-current={i === step ? 'step' : undefined}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i === step
                ? 'bg-[var(--pyre-red)]'
                : done
                  ? 'bg-[var(--pyre-sage)]/60'
                  : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            <span className="sr-only">{s.title}</span>
          </button>
        );
      })}
    </nav>
  );
}

function PeopleStep({
  people,
  witnesses,
  staffPresent,
  onPeople,
  onWitnesses,
  onStaff,
}: {
  people: AffectedPerson[];
  witnesses: Witness[];
  staffPresent: string[];
  onPeople: (next: AffectedPerson[]) => void;
  onWitnesses: (next: Witness[]) => void;
  onStaff: (next: string[]) => void;
}) {
  const [staffDraft, setStaffDraft] = useState('');

  const updatePerson = (index: number, changes: Partial<AffectedPerson>) => {
    onPeople(people.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  };

  const addStaff = () => {
    const name = staffDraft.trim();
    if (!name) return;
    if (!staffPresent.includes(name)) onStaff([...staffPresent, name]);
    setStaffDraft('');
  };

  return (
    <section className="space-y-6">
      <div>
        <SectionTitle note="Skip this if nobody was involved — a burst pipe at 6am has no people. Contact details are what makes follow-up possible, so get them while they're still here.">
          Who did this happen to?
        </SectionTitle>

        {people.length === 0 && (
          <p className="mb-3 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/45">
            Nobody added yet.
          </p>
        )}

        <div className="space-y-3">
          {people.map((person, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable only by add/remove
            <div key={index} className={cardClass}>
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wide text-white/40">
                  Person {index + 1}
                </span>
                <button
                  type="button"
                  className="font-mono text-xs text-white/40 hover:text-[var(--pyre-red)]"
                  onClick={() => onPeople(people.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {PERSON_ROLES.map((role) => (
                  <Chip
                    key={role}
                    label={PERSON_ROLE_LABELS[role]}
                    selected={person.role === role}
                    onClick={() => updatePerson(index, { role })}
                  />
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className={inputClass}
                  placeholder="Full name"
                  maxLength={FIELD_LIMITS.personName}
                  value={person.name}
                  onChange={(e) => updatePerson(index, { name: e.target.value })}
                />
                <input
                  className={inputClass}
                  type="tel"
                  inputMode="tel"
                  placeholder="Phone"
                  value={person.phone}
                  onChange={(e) => updatePerson(index, { phone: e.target.value })}
                />
                <input
                  className={inputClass}
                  type="email"
                  inputMode="email"
                  placeholder="Email"
                  value={person.email}
                  onChange={(e) => updatePerson(index, { email: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="Momence member (if known)"
                  value={person.memberId}
                  onChange={(e) => updatePerson(index, { memberId: e.target.value })}
                />
              </div>

              <div className="mt-3">
                <YesNo
                  label="Injured"
                  value={person.injured}
                  onChange={(injured) => updatePerson(index, { injured })}
                />
              </div>

              {person.injured && (
                <div className="mt-3 space-y-3">
                  <input
                    className={inputClass}
                    placeholder="What the injury was — e.g. reddened skin with a small blister"
                    maxLength={FIELD_LIMITS.personNotes}
                    value={person.injuryNature}
                    onChange={(e) => updatePerson(index, { injuryNature: e.target.value })}
                  />
                  <div>
                    {/** biome-ignore lint/a11y/noLabelWithoutControl: heading for the chip group below */}
                    <label className={labelClass}>Where on the body</label>
                    <div className="flex flex-wrap gap-1.5">
                      {BODY_PARTS.map((part) => (
                        <Chip
                          key={part}
                          label={part.replace(/_/g, ' ')}
                          selected={person.bodyParts.includes(part)}
                          onClick={() =>
                            updatePerson(index, {
                              bodyParts: person.bodyParts.includes(part)
                                ? person.bodyParts.filter((p) => p !== part)
                                : [...person.bodyParts, part],
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <textarea
                className={`${inputClass} mt-3 min-h-[70px]`}
                placeholder="Anything else about this person — what they said, prior conditions they mentioned"
                maxLength={FIELD_LIMITS.personNotes}
                value={person.notes}
                onChange={(e) => updatePerson(index, { notes: e.target.value })}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          className={`${buttonClass} mt-3`}
          onClick={() => onPeople([...people, emptyAffectedPerson()])}
        >
          + Add person
        </button>
      </div>

      <div>
        <SectionTitle note="Anyone who saw it. Write down what they said in their own words, now — memories change fast.">
          Witnesses
        </SectionTitle>

        <div className="space-y-3">
          {witnesses.map((witness, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable only by add/remove
            <div key={index} className={cardClass}>
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wide text-white/40">
                  Witness {index + 1}
                </span>
                <button
                  type="button"
                  className="font-mono text-xs text-white/40 hover:text-[var(--pyre-red)]"
                  onClick={() => onWitnesses(witnesses.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  className={inputClass}
                  placeholder="Name"
                  maxLength={FIELD_LIMITS.personName}
                  value={witness.name}
                  onChange={(e) =>
                    onWitnesses(
                      witnesses.map((w, i) => (i === index ? { ...w, name: e.target.value } : w))
                    )
                  }
                />
                <input
                  className={inputClass}
                  type="tel"
                  inputMode="tel"
                  placeholder="Phone"
                  value={witness.phone}
                  onChange={(e) =>
                    onWitnesses(
                      witnesses.map((w, i) => (i === index ? { ...w, phone: e.target.value } : w))
                    )
                  }
                />
                <input
                  className={inputClass}
                  type="email"
                  inputMode="email"
                  placeholder="Email"
                  value={witness.email}
                  onChange={(e) =>
                    onWitnesses(
                      witnesses.map((w, i) => (i === index ? { ...w, email: e.target.value } : w))
                    )
                  }
                />
              </div>
              <label className="mt-2 flex items-center gap-2 font-mono text-xs text-white/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--pyre-red)]"
                  checked={witness.isStaff}
                  onChange={(e) =>
                    onWitnesses(
                      witnesses.map((w, i) =>
                        i === index ? { ...w, isStaff: e.target.checked } : w
                      )
                    )
                  }
                />
                Pyre staff
              </label>
              <textarea
                className={`${inputClass} mt-2 min-h-[80px]`}
                placeholder="What they saw, in their words"
                maxLength={FIELD_LIMITS.statement}
                value={witness.statement}
                onChange={(e) =>
                  onWitnesses(
                    witnesses.map((w, i) => (i === index ? { ...w, statement: e.target.value } : w))
                  )
                }
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          className={`${buttonClass} mt-3`}
          onClick={() => onWitnesses([...witnesses, emptyWitness()])}
        >
          + Add witness
        </button>
      </div>

      <div>
        <SectionTitle note="Who else was working. They may be asked what they remember.">
          Staff on shift
        </SectionTitle>
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="Name"
            value={staffDraft}
            onChange={(e) => setStaffDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addStaff();
              }
            }}
          />
          <button type="button" className={buttonClass} onClick={addStaff}>
            Add
          </button>
        </div>
        {staffPresent.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {staffPresent.map((name) => (
              <Chip
                key={name}
                label={`${name} ✕`}
                selected
                onClick={() => onStaff(staffPresent.filter((n) => n !== name))}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ReviewStep({
  form,
  files,
  reporterName,
  onJump,
  firstIncompleteStep,
}: {
  form: FormState;
  files: PendingFile[];
  reporterName: string;
  onJump: (step: number) => void;
  firstIncompleteStep: number | null;
}) {
  const category = CATEGORY_OPTIONS.find((c) => c.value === form.category);
  const severity = SEVERITY_OPTIONS.find((s) => s.value === form.severity);
  const injured = form.affectedPeople.filter((p) => p.injured).length;

  const rows: { label: string; value: string; step: number }[] = [
    { label: 'Type', value: category?.label ?? '—', step: 0 },
    { label: 'Severity', value: severity?.label ?? '—', step: 0 },
    {
      label: 'When',
      value: form.occurredAtLocal
        ? new Date(form.occurredAtLocal).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : '—',
      step: 1,
    },
    {
      label: 'Where',
      value:
        [form.area ? AREA_LABELS[form.area] : '', form.areaDetail].filter(Boolean).join(' — ') ||
        '—',
      step: 1,
    },
    {
      label: 'People',
      value:
        form.affectedPeople.length === 0
          ? 'Nobody recorded'
          : `${form.affectedPeople.length} involved, ${injured} injured`,
      step: 2,
    },
    {
      label: 'Witnesses',
      value: form.witnesses.length === 0 ? 'None' : `${form.witnesses.length}`,
      step: 2,
    },
    {
      label: 'Response',
      value:
        [
          form.firstAidGiven && 'first aid',
          form.emsCalled && 'EMS called',
          form.policeCalled && 'police called',
          form.transportedToHospital && 'went to hospital',
          form.treatmentRefused && 'treatment refused',
        ]
          .filter(Boolean)
          .join(', ') || 'None of the above',
      step: 3,
    },
    {
      label: 'Attachments',
      value: files.length === 0 ? 'None' : `${files.length} file${files.length === 1 ? '' : 's'}`,
      step: 4,
    },
  ];

  return (
    <section className="space-y-5">
      <SectionTitle note="Once filed, this becomes the record. You can correct it for an hour; after that, corrections are added as notes.">
        Check it over
      </SectionTitle>

      {firstIncompleteStep !== null && (
        <button
          type="button"
          onClick={() => onJump(firstIncompleteStep)}
          className="block w-full rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-2 text-left text-sm text-[var(--pyre-red)]"
        >
          Something's still missing on step {firstIncompleteStep + 1} — tap to finish it.
        </button>
      )}

      <dl className={cardClass}>
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2 last:border-0"
          >
            <dt className="font-mono text-xs uppercase tracking-wide text-white/40">{row.label}</dt>
            <dd className="flex items-baseline gap-2 text-right text-sm text-white/85">
              <span>{row.value}</span>
              <button
                type="button"
                className="font-mono text-[10px] uppercase text-white/30 hover:text-white/70"
                onClick={() => onJump(row.step)}
              >
                edit
              </button>
            </dd>
          </div>
        ))}
      </dl>

      <div className={cardClass}>
        <p className="mb-1 font-mono text-xs uppercase tracking-wide text-white/40">
          What happened
        </p>
        <p className="whitespace-pre-wrap text-sm text-white/85">{form.description || '—'}</p>
        <p className="mt-4 mb-1 font-mono text-xs uppercase tracking-wide text-white/40">
          What you did
        </p>
        <p className="whitespace-pre-wrap text-sm text-white/85">{form.immediateActions || '—'}</p>
      </div>

      <p className="font-mono text-xs text-white/35">
        Filed by {reporterName} · {new Date().toLocaleString('en-US')}
      </p>
    </section>
  );
}
