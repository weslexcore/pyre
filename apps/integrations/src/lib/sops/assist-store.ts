// Keeps an SOP's AI draft on this device until it is dismissed, so a reload,
// a closed tab, or Cancel in the editor never throws away what the writing
// assistant (components/admin/SopAssist) produced. Two records per document
// and viewer:
//
//   * The assistant panel: the open proposal with its diff baseline,
//     findings, and chat. Cleared by Discard/Close, or when the proposal is
//     put into the editor (the editor record takes over).
//   * The editor, once a proposal has been put into it: title, body, change
//     note, and the version the edit started from, so saving a restored
//     draft is still optimistic-locked against what it was based on.
//
// Both clear on Save and on the document page's Discard. Stored with the
// autosave backups (lib/client/autosave), keyed by viewer so a shared device
// never hands one person's draft to another. Client-only; every read and
// write tolerates blocked storage.

import { clearBackup, readBackup, writeBackup } from '@/lib/client/autosave';
import type { AssistFinding, AssistMode, AssistProposal } from './assist';
import type { ChatState } from './assist-chat';

export interface StoredAssistResult {
  proposal: AssistProposal;
  /** The editor text the proposal was made against (the diff's "before"). */
  before: string;
  beforeTitle: string;
  summary: string;
  findings: AssistFinding[];
}

export interface StoredAssist {
  tab: Exclude<AssistMode, 'refine'>;
  notes: string;
  result: StoredAssistResult;
  chat: ChatState;
  /** How many chat messages the assistant has seen. */
  sentThrough: number;
}

export interface StoredAiEdit {
  title: string;
  content: string;
  note: string;
  /** The document version the edit started from. */
  baseVersion: number;
}

export interface SopDraftKeys {
  assist: string;
  edit: string;
}

export function sopDraftKeys(viewerEmail: string, sopId: string): SopDraftKeys {
  const who = viewerEmail.trim().toLowerCase();
  return { assist: `sop-ai-assist:${who}:${sopId}`, edit: `sop-ai-edit:${who}:${sopId}` };
}

export interface StoredDraft<T> {
  value: T;
  /** When it was last written (ISO). */
  at: string;
}

function isAssist(value: unknown): value is StoredAssist {
  const v = value as StoredAssist | null;
  return (
    !!v &&
    (v.tab === 'draft' || v.tab === 'review') &&
    typeof v.notes === 'string' &&
    !!v.result &&
    typeof v.result.proposal?.contentMd === 'string' &&
    typeof v.result.before === 'string' &&
    Array.isArray(v.result.findings) &&
    Array.isArray(v.chat?.messages) &&
    Array.isArray(v.chat?.queue) &&
    typeof v.sentThrough === 'number'
  );
}

function isAiEdit(value: unknown): value is StoredAiEdit {
  const v = value as StoredAiEdit | null;
  return (
    !!v &&
    typeof v.title === 'string' &&
    typeof v.content === 'string' &&
    typeof v.note === 'string' &&
    typeof v.baseVersion === 'number'
  );
}

export function readStoredAssist(key: string): StoredDraft<StoredAssist> | null {
  const backup = readBackup<unknown>(key);
  return backup && isAssist(backup.value) ? { value: backup.value, at: backup.at } : null;
}

export function writeStoredAssist(key: string, value: StoredAssist): void {
  writeBackup(key, value, null);
}

export function clearStoredAssist(key: string): void {
  clearBackup(key);
}

export function readStoredAiEdit(key: string): StoredDraft<StoredAiEdit> | null {
  const backup = readBackup<unknown>(key);
  return backup && isAiEdit(backup.value) ? { value: backup.value, at: backup.at } : null;
}

export function writeStoredAiEdit(key: string, value: StoredAiEdit): void {
  writeBackup(key, value, null);
}

export function clearSopDrafts(keys: SopDraftKeys): void {
  clearBackup(keys.assist);
  clearBackup(keys.edit);
}

/** When the newest of a document's stored AI drafts was written, or null when it has none. */
export function storedDraftAt(keys: SopDraftKeys): string | null {
  const stamps = [readStoredAssist(keys.assist)?.at, readStoredAiEdit(keys.edit)?.at].filter(
    (at): at is string => Boolean(at)
  );
  return stamps.length ? (stamps.sort().at(-1) ?? null) : null;
}
