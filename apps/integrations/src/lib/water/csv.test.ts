// The export is what leaves the app for a spreadsheet, so the escaping rules
// (quoting, formula defusing) and the column contract get pinned here.

import { describe, expect, it } from 'vitest';
import type { WaterTestRow } from '@/lib/db';
import { waterTestsToCsv } from './csv';

const record = (over: Partial<WaterTestRow> = {}): WaterTestRow => ({
  id: 'row-1',
  tub: 'left',
  entry_type: 'test',
  ta_ppm: 90,
  ph: 7.4,
  free_chlorine_ppm: 2,
  combined_chlorine_ppm: 0.2,
  salt_ppm: 3200,
  test_method: 'tf_pro_salt',
  doses: [],
  notes: null,
  recorded_by: 'staff@pyresauna.com',
  created_at: '2026-08-09T14:12:00.000Z',
  updated_at: '2026-08-09T14:12:00.000Z',
  ...over,
});

const rows = (csv: string) => csv.replace('\uFEFF', '').trimEnd().split('\r\n');

describe('waterTestsToCsv', () => {
  it('writes a header and one row per entry', () => {
    const [header, first] = rows(waterTestsToCsv([record()]));
    expect(header).toBe(
      'Recorded at,Tub,Entry type,TA (ppm),pH,Free chlorine (ppm),Combined chlorine (ppm),Salt (ppm),Test method,Added to water,Notes,Recorded by'
    );
    expect(first).toBe(
      '2026-08-09T14:12:00.000Z,left,test,90,7.4,2,0.2,3200,TF-Pro Salt,,,staff@pyresauna.com'
    );
  });

  it('leaves untested readings blank rather than zero', () => {
    const [, row] = rows(waterTestsToCsv([record({ ta_ppm: null, salt_ppm: null })]));
    expect(row.split(',').slice(3, 8)).toEqual(['', '7.4', '2', '0.2', '']);
  });

  it('flattens doses into one cell', () => {
    const [, row] = rows(
      waterTestsToCsv([
        record({
          entry_type: 'shock',
          doses: [
            { chemical: 'Cold Water Sanitizer', grams: 30 },
            { chemical: 'Dead Sea Salt', grams: 200 },
          ],
        }),
      ])
    );
    expect(row).toContain('Cold Water Sanitizer 30 g; Dead Sea Salt 200 g');
  });

  it('quotes notes containing commas, quotes, and newlines', () => {
    const [, row] = rows(waterTestsToCsv([record({ notes: 'Cloudy, said "hazy"' })]));
    expect(row).toContain('"Cloudy, said ""hazy"""');
  });

  it('defuses notes a spreadsheet would run as a formula', () => {
    const [, row] = rows(waterTestsToCsv([record({ notes: '=SUM(A1:A9)' })]));
    expect(row).toContain("'=SUM(A1:A9)");
  });

  it('starts with a BOM and ends every line with CRLF', () => {
    const csv = waterTestsToCsv([record()]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
