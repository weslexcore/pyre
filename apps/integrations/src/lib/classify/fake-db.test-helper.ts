// A tiny in-memory stand-in for the one table lib/classify and the agent
// route touch (content_classifications), supporting exactly the builder
// calls they make: select/eq/in/maybeSingle, upsert(onConflict)/select/single,
// update/eq/select/maybeSingle, and awaiting a bare update. Inserts into any
// other table (the activity a saved answer records) are kept in `inserted`.
// Not a test file itself; imported by the classify tests.

type Row = Record<string, unknown>;

export function fakeClassificationsDb(initial: Row[] = []) {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  const log: string[] = [];
  const inserted: Array<{ table: string; row: Row }> = [];

  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let action:
      | { kind: 'select' }
      | { kind: 'update'; patch: Row }
      | { kind: 'upsert'; value: Row; conflict: string[] }
      | { kind: 'insert'; value: Row } = {
      kind: 'select',
    };

    const matching = () => rows.filter((row) => filters.every((f) => f(row)));

    function run(): { data: Row[]; error: null } {
      if (action.kind === 'insert') {
        inserted.push({ table, row: action.value });
        return { data: [action.value], error: null };
      }
      if (table !== 'content_classifications') return { data: [], error: null };
      if (action.kind === 'update') {
        const hit = matching();
        for (const row of hit) Object.assign(row, action.patch);
        log.push(`update:${JSON.stringify(action.patch)}`);
        return { data: hit, error: null };
      }
      if (action.kind === 'upsert') {
        const { value, conflict } = action;
        const existing = rows.find((row) => conflict.every((k) => row[k] === value[k]));
        if (existing) Object.assign(existing, value);
        else rows.push({ id: `row-${rows.length + 1}`, ...value });
        log.push(`upsert:${value.status}`);
        return {
          data: [existing ?? (rows[rows.length - 1] as Row)],
          error: null,
        };
      }
      return { data: matching(), error: null };
    }

    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return api;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return api;
      },
      update: (patch: Row) => {
        action = { kind: 'update', patch };
        return api;
      },
      insert: (value: Row) => {
        action = { kind: 'insert', value };
        return api;
      },
      upsert: (value: Row, options: { onConflict: string }) => {
        action = { kind: 'upsert', value, conflict: options.onConflict.split(',') };
        return api;
      },
      maybeSingle: async () => {
        const { data } = run();
        return { data: data[0] ?? null, error: null };
      },
      single: async () => {
        const { data } = run();
        return { data: data[0] ?? null, error: null };
      },
      // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable supabase builder
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return api;
  }

  return { db: { from: builder }, rows, log, inserted };
}
