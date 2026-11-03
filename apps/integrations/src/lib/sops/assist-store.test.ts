import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CHAT } from './assist-chat';
import {
  clearSopDrafts,
  readStoredAiEdit,
  readStoredAssist,
  type StoredAssist,
  sopDraftKeys,
  storedDraftAt,
  writeStoredAiEdit,
  writeStoredAssist,
} from './assist-store';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const ASSIST: StoredAssist = {
  tab: 'review',
  notes: '',
  result: {
    proposal: {
      title: 'Opening',
      contentMd: '# Opening\n\n- [ ] Unlock',
      summary: 'Tightened',
      changeNote: 'AI review',
      openQuestions: [],
      findings: [],
      model: 'test',
    },
    before: '# Opening\n\nunlock',
    beforeTitle: 'Opening',
    summary: 'Tightened',
    findings: [],
  },
  chat: EMPTY_CHAT,
  sentThrough: 0,
};

describe('assist-store', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keys by viewer and document', () => {
    const a = sopDraftKeys('Wes@Example.com', 'sop-1');
    expect(a).toEqual(sopDraftKeys('wes@example.com', 'sop-1'));
    expect(a.assist).not.toBe(sopDraftKeys('sam@example.com', 'sop-1').assist);
  });

  it('round-trips both records until they are cleared', () => {
    const keys = sopDraftKeys('wes@example.com', 'sop-1');
    expect(storedDraftAt(keys)).toBeNull();
    writeStoredAssist(keys.assist, ASSIST);
    writeStoredAiEdit(keys.edit, { title: 'T', content: 'C', note: '', baseVersion: 3 });
    expect(readStoredAssist(keys.assist)?.value).toEqual(ASSIST);
    expect(readStoredAiEdit(keys.edit)?.value.baseVersion).toBe(3);
    expect(storedDraftAt(keys)).not.toBeNull();
    clearSopDrafts(keys);
    expect(readStoredAssist(keys.assist)).toBeNull();
    expect(readStoredAiEdit(keys.edit)).toBeNull();
    expect(storedDraftAt(keys)).toBeNull();
  });

  it('ignores records that are not drafts', () => {
    const keys = sopDraftKeys('wes@example.com', 'sop-1');
    writeStoredAssist(keys.assist, { ...ASSIST, result: null } as unknown as StoredAssist);
    expect(readStoredAssist(keys.assist)).toBeNull();
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    });
    const keys = sopDraftKeys('wes@example.com', 'sop-1');
    expect(() => writeStoredAssist(keys.assist, ASSIST)).not.toThrow();
    expect(readStoredAssist(keys.assist)).toBeNull();
  });
});
