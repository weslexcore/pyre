// The control for a `files` field: the files the answer lists, as tiles —
// a photo or a clip shows itself and opens in the lightbox, the way shift
// notes do; a PDF shows its name — and a picker that uploads the moment a
// file is chosen. The same control in the card drawer and on a board's
// form; the two differ in where the upload goes (`action`) and where the
// bytes come back from: the drawer reads them through the signed route
// (`href`), while a form cannot read a file back at all, so its previews
// are the browser's own copies of what was just picked.
//
// The answer is the list of ids (lib/boards/files.ts), and this control
// speaks it: a finished upload adds its id, Remove takes one away, and the
// card or the submission carries the list. The rows behind the ids — names,
// sizes, kinds — arrive with the card (`known`) or with each upload.

import { useEffect, useRef, useState } from 'react';
import {
  ACCEPT_ATTRIBUTE,
  type AttachmentSummary,
  checkFile,
  downscaleImage,
  formatBytes,
  kindForMime,
  MAX_FILE_BYTES,
  MAX_FILES_PER_FIELD,
} from '@/lib/boards/files';
import { buttonClass } from '../goalsUi';
import { ShiftNoteViewer } from '../ShiftNoteViewer';

interface PendingFile {
  /** Stable identity for a pick, so retrying keeps its tile. */
  key: string;
  file: File;
  status: 'uploading' | 'failed';
  /** 0–100 while uploading. */
  progress: number;
  error?: string;
  abort?: () => void;
}

export interface FilesFieldProps {
  id: string;
  /** For the picker's accessible name: "Add files to Contract". */
  label: string;
  /** The ids the answer lists, in order. */
  value: string[];
  /** The rows behind ids the answer already listed when the control mounted. */
  known?: AttachmentSummary[];
  /** Where a pick is uploaded: the staff route or the form's. */
  action: string;
  /** Sent with each upload beside the file: the board and the field. */
  params: Record<string, string>;
  /** Where a listed file's bytes are read back, when the viewer may; `download` names the save. */
  href?: (id: string, download?: boolean) => string;
  /** Un-picks a file that was uploaded but not yet sent (the form); the drawer's save does this itself. */
  unpick?: (id: string) => Promise<void>;
  /** In the builder's preview: nothing is uploaded, and a pick is only pretended. */
  preview?: boolean;
  disabled?: boolean;
  onChange: (ids: string[] | null) => void;
}

/**
 * POST one multipart form via XHR — fetch can't report upload progress, and
 * a 50 MB PDF over venue wifi needs a moving number, not a frozen spinner.
 */
function uploadWithProgress(
  action: string,
  form: FormData,
  onProgress: (pct: number) => void
): { promise: Promise<AttachmentSummary>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<AttachmentSummary>((resolve, reject) => {
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let parsed: { attachment?: AttachmentSummary; error?: string } = {};
      try {
        parsed = JSON.parse(xhr.responseText) as typeof parsed;
      } catch {
        // Non-JSON body; the status check below carries the error.
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.attachment) resolve(parsed.attachment);
      else reject(new Error(parsed.error ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check the connection.'));
    xhr.onabort = () => reject(new Error('Upload canceled'));
    xhr.open('POST', action);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

function pickKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

const tileClass = 'rounded border border-white/10 bg-white/5 p-1.5';
const tileNameClass = 'mt-1 flex items-center gap-2 font-mono text-[10px] text-white/30';

export function FilesField({
  id,
  label,
  value,
  known = [],
  action,
  params,
  href,
  unpick,
  preview = false,
  disabled = false,
  onChange,
}: FilesFieldProps) {
  // The rows behind the ids: what arrived with the card, plus every upload
  // that landed here. Keyed by id so a re-render after a save finds them.
  const [uploaded, setUploaded] = useState<Record<string, AttachmentSummary>>({});
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Uploads finish in their own time; the list they append to is whatever
  // the answer says by then, not what it said when they started.
  const valueRef = useRef(value);
  valueRef.current = value;
  // The browser's own copy of each photo or clip picked here, for a preview
  // where nothing can be read back (the form) — revoked when the control
  // goes away.
  const localUrls = useRef<Record<string, string>>({});
  useEffect(
    () => () => {
      for (const url of Object.values(localUrls.current)) URL.revokeObjectURL(url);
    },
    []
  );

  const rows = new Map<string, AttachmentSummary>();
  for (const row of known) rows.set(row.id, row);
  for (const row of Object.values(uploaded)) rows.set(row.id, row);

  /** Where a listed file's bytes show from, if anywhere. */
  const srcOf = (fileId: string): string | null =>
    href ? href(fileId) : (localUrls.current[fileId] ?? null);

  const listed = value.map((fileId) => ({ id: fileId, row: rows.get(fileId) }));
  // What the lightbox steps through: the photos and clips with something to show.
  const viewable = listed.flatMap(({ id: fileId, row }) =>
    row && row.kind !== 'document' && srcOf(fileId) ? [row] : []
  );

  const room = MAX_FILES_PER_FIELD - value.length - pending.length;
  const full = room <= 0;

  const setPendingEntry = (key: string, patch: Partial<PendingFile>) =>
    setPending((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry))
    );
  const dropPending = (key: string) =>
    setPending((current) => current.filter((entry) => entry.key !== key));

  const finish = (row: AttachmentSummary, original: File) => {
    if (!href && row.kind !== 'document' && typeof URL.createObjectURL === 'function') {
      localUrls.current[row.id] = URL.createObjectURL(original);
    }
    setUploaded((current) => ({ ...current, [row.id]: row }));
    onChange([...valueRef.current.filter((entry) => entry !== row.id), row.id]);
  };

  const start = async (key: string, original: File) => {
    if (preview) {
      // The builder's preview has no board to upload to; a pick becomes a
      // row with a made-up id so the form can be walked through.
      finish(
        {
          id: globalThis.crypto?.randomUUID?.() ?? `preview-${key}`,
          card_id: null,
          field_key: params.field ?? '',
          file_name: original.name,
          mime_type: original.type,
          size_bytes: original.size,
          kind: kindForMime(original.type) ?? 'document',
        },
        original
      );
      return;
    }
    setPending((current) => [
      ...current.filter((entry) => entry.key !== key),
      { key, file: original, status: 'uploading', progress: 0 },
    ]);
    try {
      const file = await downscaleImage(original);
      const form = new FormData();
      for (const [name, entry] of Object.entries(params)) form.append(name, entry);
      form.append('file', file, file.name);
      const { promise, abort } = uploadWithProgress(action, form, (progress) =>
        setPendingEntry(key, { progress })
      );
      setPendingEntry(key, { abort });
      const row = await promise;
      dropPending(key);
      finish(row, file);
    } catch (e) {
      setPendingEntry(key, {
        status: 'failed',
        abort: undefined,
        error: e instanceof Error ? e.message : 'Upload failed',
      });
    }
  };

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setProblem(null);
    const seen = new Set(pending.map((entry) => entry.key));
    let left = room;
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      const key = pickKey(file);
      if (seen.has(key)) continue;
      if (left <= 0) {
        problems.push(`Up to ${MAX_FILES_PER_FIELD} files; the rest were not added.`);
        break;
      }
      const reason = checkFile(file);
      if (reason) {
        problems.push(reason);
        continue;
      }
      seen.add(key);
      left -= 1;
      void start(key, file);
    }
    if (problems.length > 0) setProblem(problems.join(' '));
  };

  const remove = (fileId: string) => {
    const next = valueRef.current.filter((entry) => entry !== fileId);
    onChange(next.length > 0 ? next : null);
    const local = localUrls.current[fileId];
    if (local) {
      URL.revokeObjectURL(local);
      delete localUrls.current[fileId];
    }
    if (unpick && !preview) {
      void unpick(fileId).catch(() => {
        // A staged row that stays behind is swept a day later.
      });
    }
  };

  return (
    <div className="space-y-2">
      {(listed.length > 0 || pending.length > 0) && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {listed.map(({ id: fileId, row }) => {
            const name = row?.file_name ?? 'File';
            const src = srcOf(fileId);
            const viewerIndex = viewable.findIndex((entry) => entry.id === fileId);
            return (
              <li key={fileId} className={tileClass}>
                {row?.kind === 'photo' && src ? (
                  <button
                    type="button"
                    onClick={() => setLightbox(viewerIndex)}
                    aria-label={`View ${name}`}
                    className="block w-full cursor-zoom-in"
                  >
                    <img
                      src={src}
                      alt={name}
                      loading="lazy"
                      className="h-24 w-full rounded object-cover"
                    />
                  </button>
                ) : row?.kind === 'video' && src ? (
                  <button
                    type="button"
                    onClick={() => setLightbox(viewerIndex)}
                    aria-label={`Play ${name}`}
                    className="relative block w-full cursor-zoom-in"
                  >
                    <video
                      src={src}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      className="pointer-events-none h-24 w-full rounded bg-black object-contain"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="rounded border border-white/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white">
                        Play
                      </span>
                    </span>
                  </button>
                ) : href ? (
                  <a
                    href={href(fileId)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-24 w-full items-center justify-center rounded bg-white/5 font-mono text-xs uppercase tracking-wide text-white/40"
                  >
                    {row?.kind === 'document' ? 'PDF' : 'Open'}
                  </a>
                ) : (
                  <span className="flex h-24 w-full items-center justify-center rounded bg-white/5 font-mono text-xs uppercase tracking-wide text-white/40">
                    {row?.kind === 'document' ? 'PDF' : row?.kind === 'video' ? 'Video' : 'Photo'}
                  </span>
                )}
                <div className={tileNameClass}>
                  <span className="min-w-0 flex-1 truncate" title={name}>
                    {name}
                  </span>
                  {row && <span className="shrink-0">{formatBytes(row.size_bytes)}</span>}
                  {href && (
                    <a href={href(fileId, true)} className="shrink-0 uppercase hover:text-white">
                      download
                    </a>
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      className="shrink-0 uppercase hover:text-[var(--pyre-red)]"
                      aria-label={`Remove ${name}`}
                      onClick={() => remove(fileId)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {pending.map((entry) => (
            <li
              key={entry.key}
              aria-busy={entry.status === 'uploading'}
              className={`${tileClass} ${
                entry.status === 'failed'
                  ? 'border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10'
                  : ''
              }`}
            >
              <span
                className={`flex h-24 w-full items-center justify-center rounded bg-white/5 font-mono text-xs uppercase tracking-wide ${
                  entry.status === 'failed' ? 'text-[var(--pyre-red)]' : 'text-white/40'
                }`}
              >
                {entry.status === 'uploading' ? `Uploading ${entry.progress}%` : 'Failed'}
              </span>
              <div className={tileNameClass}>
                <span className="min-w-0 flex-1 truncate" title={entry.file.name}>
                  {entry.file.name}
                </span>
                <span className="shrink-0">{formatBytes(entry.file.size)}</span>
                {entry.status === 'failed' && (
                  <button
                    type="button"
                    className="shrink-0 uppercase underline hover:text-white"
                    title={entry.error}
                    onClick={() => void start(entry.key, entry.file)}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  className="shrink-0 uppercase hover:text-[var(--pyre-red)]"
                  aria-label={`Remove ${entry.file.name}`}
                  onClick={() => {
                    entry.abort?.();
                    dropPending(entry.key);
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${buttonClass} cursor-pointer ${full || disabled ? 'opacity-50' : ''}`}>
          {listed.length > 0 || pending.length > 0 ? 'Add more files' : 'Add files'}
          <input
            id={id}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            className="hidden"
            disabled={full || disabled}
            aria-label={`Add files to ${label}`}
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-xs text-white/35">
          Up to {MAX_FILES_PER_FIELD} files, {formatBytes(MAX_FILE_BYTES)} each. Photos, video, or
          PDF.
        </span>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-[var(--pyre-red)]">
          {problem}
        </p>
      )}
      {lightbox !== null && viewable[lightbox] && (
        <ShiftNoteViewer
          items={viewable}
          index={lightbox}
          onNavigate={setLightbox}
          onClose={() => setLightbox(null)}
          srcOf={(item) => srcOf(item.id) ?? ''}
          downloadOf={(item) => (href ? href(item.id, true) : null)}
        />
      )}
    </div>
  );
}
