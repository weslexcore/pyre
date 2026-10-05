/* N-up print sheets for the preview shell's Print button. Selected pages are rendered to PNG by
   /__render, then tiled onto US Letter sheets at their physical size — as many per sheet as fit —
   and handed to the browser's print dialog. Cards are butted edge to edge at trim size (bleed
   cropped off) so every cut is shared; crop marks sit in the sheet margin. */

import { SIZES, type SizeKey } from './sizes.ts';

const PRINT_DPI = 300;
const LETTER = { w: 8.5, h: 11 };
/** Most printers can't print the outer ~0.25in; try to keep cards inside it first. */
const SAFE_MARGIN_IN = 0.25;
const CROP_MARK_IN = 0.1875;
const CROP_MARK_GAP_IN = 0.0625;
const EPSILON = 1e-6;

export type Orientation = 'portrait' | 'landscape';

export interface SheetLayout {
  orientation: Orientation;
  cols: number;
  rows: number;
  /** Trimmed card size on paper, in inches (already scaled). */
  cellW: number;
  cellH: number;
  /** Bleed per edge in inches (already scaled), cropped off by the cell. */
  bleed: number;
  /** <1 only when a single page is larger than the sheet and has to shrink to fit. */
  scale: number;
}

export interface PrintItem {
  size: SizeKey;
  /** URL of the rendered PNG/JPG. */
  src: string;
}

/** True when the size is a 300dpi print artboard that the Print button can place on paper. */
export function isPrintable(size: string): size is SizeKey {
  return SIZES[size as SizeKey]?.bleedIn !== undefined;
}

/** Pick the orientation and grid that fit the most trimmed cards on one Letter sheet. */
export function layoutFor(size: SizeKey): SheetLayout {
  const { w, h, bleedIn = 0 } = SIZES[size];
  const trimW = w / PRINT_DPI - 2 * bleedIn;
  const trimH = h / PRINT_DPI - 2 * bleedIn;

  // Prefer the printer-safe margin; fall back to edge-to-edge for artboards designed to fill
  // the sheet exactly (letter, two tall menus side by side).
  for (const margin of [SAFE_MARGIN_IN, 0]) {
    let best: SheetLayout | null = null;
    for (const orientation of ['portrait', 'landscape'] as const) {
      const sheet = sheetSize(orientation);
      const cols = Math.floor((sheet.w - 2 * margin + EPSILON) / trimW);
      const rows = Math.floor((sheet.h - 2 * margin + EPSILON) / trimH);
      if (cols * rows > (best ? best.cols * best.rows : 0)) {
        best = { orientation, cols, rows, cellW: trimW, cellH: trimH, bleed: bleedIn, scale: 1 };
      }
    }
    if (best) return best;
  }

  // Bigger than a sheet in both orientations: one per sheet, shrunk to fit.
  const fits = (['portrait', 'landscape'] as const).map((orientation) => {
    const sheet = sheetSize(orientation);
    return { orientation, scale: Math.min(sheet.w / trimW, sheet.h / trimH) };
  });
  const { orientation, scale } = fits[0].scale >= fits[1].scale ? fits[0] : fits[1];
  return {
    orientation,
    cols: 1,
    rows: 1,
    cellW: trimW * scale,
    cellH: trimH * scale,
    bleed: bleedIn * scale,
    scale,
  };
}

/**
 * Replace `root`'s contents with print-ready sheets. Items are grouped by size (in order of
 * first appearance) so each sheet holds one card size. Resolves once every image has decoded,
 * so it's safe to call window.print() straight after.
 */
export async function buildPrintSheets(items: PrintItem[], root: HTMLElement): Promise<number> {
  const bySize = new Map<SizeKey, string[]>();
  for (const item of items) {
    const list = bySize.get(item.size) ?? [];
    list.push(item.src);
    bySize.set(item.size, list);
  }

  const sheets: HTMLElement[] = [];
  for (const [size, srcs] of bySize) {
    const layout = layoutFor(size);
    const perSheet = layout.cols * layout.rows;
    for (let i = 0; i < srcs.length; i += perSheet) {
      sheets.push(buildSheet(layout, srcs.slice(i, i + perSheet)));
    }
  }

  root.replaceChildren(...sheets);
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined))
  );
  return sheets.length;
}

function sheetSize(orientation: Orientation) {
  return orientation === 'portrait' ? LETTER : { w: LETTER.h, h: LETTER.w };
}

function buildSheet(layout: SheetLayout, srcs: string[]): HTMLElement {
  const sheet = document.createElement('section');
  sheet.className = `print-sheet print-sheet--${layout.orientation}`;

  // Shrink the grid to the cards actually on this sheet so a short last sheet stays centered.
  const cols = Math.min(layout.cols, srcs.length);
  const rows = Math.ceil(srcs.length / cols);

  const grid = document.createElement('div');
  grid.className = 'print-sheet__grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, ${layout.cellW}in)`;
  grid.style.gridAutoRows = `${layout.cellH}in`;

  for (const src of srcs) {
    const cell = document.createElement('div');
    cell.className = 'print-sheet__cell';
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.width = `${layout.cellW + 2 * layout.bleed}in`;
    img.style.height = `${layout.cellH + 2 * layout.bleed}in`;
    img.style.margin = `${-layout.bleed}in`;
    cell.append(img);
    grid.append(cell);
  }

  // Only trimmed cards need cutting; full-sheet artboards (no bleed) print as-is.
  if (layout.bleed > 0) grid.append(...cropMarks(cols, rows, layout.cellW, layout.cellH));

  sheet.append(grid);
  return sheet;
}

/** Short hairlines just outside the grid, lined up with every cut. */
function cropMarks(cols: number, rows: number, cellW: number, cellH: number): HTMLElement[] {
  const marks: HTMLElement[] = [];
  const offset = -(CROP_MARK_GAP_IN + CROP_MARK_IN);
  for (let c = 0; c <= cols; c++) {
    const x = c * cellW;
    marks.push(mark('v', x, offset), mark('v', x, rows * cellH + CROP_MARK_GAP_IN));
  }
  for (let r = 0; r <= rows; r++) {
    const y = r * cellH;
    marks.push(mark('h', offset, y), mark('h', cols * cellW + CROP_MARK_GAP_IN, y));
  }
  return marks;
}

function mark(axis: 'h' | 'v', x: number, y: number): HTMLElement {
  const el = document.createElement('span');
  el.className = `print-sheet__mark print-sheet__mark--${axis}`;
  el.style.left = `${x}in`;
  el.style.top = `${y}in`;
  return el;
}
