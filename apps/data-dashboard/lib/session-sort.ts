import {
  MultiSortState,
  SortColumn,
  SortDirection,
  isSortColumn,
  sanitizeSortStack,
} from "@/lib/multi-sort";

const STORAGE_KEY = "pyre:data-dashboard:data-table-sort";
const STORAGE_VERSION = 2;

type StoredSortEntry = {
  column: SortColumn;
  direction: SortDirection;
};

type StoredSortPayload = {
  version: number;
  signature: string;
  stack: StoredSortEntry[];
};

type LegacySortPayload = {
  column?: string;
  direction?: SortDirection;
  signature?: string;
};

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

function parseStoredStack(value: unknown): MultiSortState {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: MultiSortState = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const column = (candidate as { column?: unknown }).column;
    const direction = (candidate as { direction?: unknown }).direction;

    if (typeof column !== "string" || !isSortDirection(direction)) {
      continue;
    }

    if (!isSortColumn(column)) {
      continue;
    }

    entries.push({
      column,
      direction,
    });
  }

  return entries;
}

function isStoredSortPayload(value: unknown): value is StoredSortPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<StoredSortPayload>;

  return (
    typeof payload.version === "number" &&
    typeof payload.signature === "string" &&
    Array.isArray(payload.stack)
  );
}

function isLegacySortPayload(value: unknown): value is LegacySortPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as LegacySortPayload;
  return (
    typeof payload.signature === "string" &&
    typeof payload.column === "string" &&
    isSortDirection(payload.direction)
  );
}

function writePayload(
  storage: Storage,
  payload: StoredSortPayload,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadSortState(signature: string): MultiSortState | null {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (isStoredSortPayload(parsed)) {
      if (parsed.signature !== signature) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }

      const sanitized = sanitizeSortStack(parseStoredStack(parsed.stack));
      if (sanitized.length === 0) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }

      if (parsed.version !== STORAGE_VERSION) {
        writePayload(storage, {
          version: STORAGE_VERSION,
          signature,
          stack: sanitized,
        });
      }

      return sanitized;
    }

    if (isLegacySortPayload(parsed)) {
      if (parsed.signature !== signature) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }

      const entries: MultiSortState = isSortColumn(parsed.column)
        ? [
            {
              column: parsed.column,
              direction: parsed.direction ?? "desc",
            },
          ]
        : [];

      const sanitized = sanitizeSortStack(entries);
      if (sanitized.length === 0) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }

      writePayload(storage, {
        version: STORAGE_VERSION,
        signature,
        stack: sanitized,
      });

      return sanitized;
    }

    storage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveSortState(
  signature: string,
  state: MultiSortState,
): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    const sanitized = sanitizeSortStack(state);

    if (sanitized.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }

    const payload: StoredSortPayload = {
      version: STORAGE_VERSION,
      signature,
      stack: sanitized,
    };
    writePayload(storage, payload);
  } catch {
    // Ignore persistence failures (quota, private mode, etc.)
  }
}

export function clearSortState(): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Clearing failures can be safely ignored.
  }
}
