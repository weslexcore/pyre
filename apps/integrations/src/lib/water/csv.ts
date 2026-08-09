// CSV serialization for the cold-tub water log export. Kept out of the API
// route so the escaping rules are unit-testable; the route only decides which
// rows to hand over.

import type { WaterTestRow } from '@/lib/db';
import { TEST_METHOD_LABELS } from './charts';

const COLUMNS: Array<[string, (row: WaterTestRow) => string | number | null]> = [
  ['Recorded at', (r) => r.created_at],
  ['Tub', (r) => r.tub],
  ['Entry type', (r) => r.entry_type],
  ['TA (ppm)', (r) => r.ta_ppm],
  ['pH', (r) => r.ph],
  ['Free chlorine (ppm)', (r) => r.free_chlorine_ppm],
  ['Combined chlorine (ppm)', (r) => r.combined_chlorine_ppm],
  ['Salt (ppm)', (r) => r.salt_ppm],
  ['Test method', (r) => (r.test_method ? TEST_METHOD_LABELS[r.test_method] : null)],
  ['Added to water', (r) => r.doses.map((d) => `${d.chemical} ${d.grams} g`).join('; ')],
  ['Notes', (r) => r.notes],
  ['Recorded by', (r) => r.recorded_by],
];

/**
 * One CSV cell: quote anything that would otherwise break the row, and defuse
 * leading characters a spreadsheet would read as a formula (the log carries
 * staff-typed notes).
 */
function cell(value: string | number | null): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header row plus one line per entry, in the order given. */
export function waterTestsToCsv(records: readonly WaterTestRow[]): string {
  const lines = [COLUMNS.map(([header]) => cell(header)).join(',')];
  for (const record of records) {
    lines.push(COLUMNS.map(([, read]) => cell(read(record))).join(','));
  }
  // Leading BOM so Excel opens the file as UTF-8; CRLF line breaks per RFC 4180.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
