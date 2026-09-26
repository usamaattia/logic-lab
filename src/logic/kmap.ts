/**
 * Karnaugh map layout (2 to 4 variables) in Gray-code order, and the rectangles that draw
 * an implicant's group on it, including groups that wrap around the edges.
 */
import type { Implicant } from "./qm";

const GRAY = { 1: [0, 1], 2: [0, 1, 3, 2] } as const;

export interface KLayout {
  n: number;
  rowVars: string[];
  colVars: string[];
  rowCodes: readonly number[];
  colCodes: readonly number[];
  /** minterm number of the cell in row r, column c */
  cell: (r: number, c: number) => number;
}

export function kmapLayout(vars: string[]): KLayout {
  const n = vars.length;
  if (n < 2 || n > 4) throw new Error("Karnaugh maps are drawn for 2 to 4 variables.");
  const nr = n === 4 ? 2 : 1; // row variables
  const nc = n - nr;
  const rowCodes = GRAY[nr as 1 | 2];
  const colCodes = GRAY[nc as 1 | 2];
  return {
    n,
    rowVars: vars.slice(0, nr),
    colVars: vars.slice(nr),
    rowCodes,
    colCodes,
    cell: (r, c) => (rowCodes[r] << nc) | colCodes[c],
  };
}

export const bits = (code: number, width: number) => code.toString(2).padStart(width, "0");

export interface GroupRect {
  r0: number;
  r1: number; // inclusive
  c0: number;
  c1: number;
  /** sides that continue on the other edge of the map (drawn open) */
  open: { top: boolean; bottom: boolean; left: boolean; right: boolean };
}

/** Split a set of indices on a cyclic axis of length `len` into contiguous runs. */
function runs(idx: number[], len: number): { from: number; to: number; wrapStart: boolean; wrapEnd: boolean }[] {
  const set = new Set(idx);
  if (set.size === len) return [{ from: 0, to: len - 1, wrapStart: false, wrapEnd: false }];
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i < len; i++) {
    if (!set.has(i) || set.has(i - 1)) continue;
    let j = i;
    while (set.has(j + 1)) j++;
    out.push({ from: i, to: j });
  }
  // a run touching both ends wraps around: mark those sides open
  const wraps = set.has(0) && set.has(len - 1) && out.length > 1;
  return out.map((r) => ({ ...r, wrapStart: wraps && r.from === 0, wrapEnd: wraps && r.to === len - 1 }));
}

export function groupRects(imp: Implicant, layout: KLayout): GroupRect[] {
  const rows: number[] = [];
  const cols: number[] = [];
  const covered = new Set(imp.covers);
  layout.rowCodes.forEach((_, r) => {
    if (layout.colCodes.some((__, c) => covered.has(layout.cell(r, c)))) rows.push(r);
  });
  layout.colCodes.forEach((_, c) => {
    if (layout.rowCodes.some((__, r) => covered.has(layout.cell(r, c)))) cols.push(c);
  });
  const rects: GroupRect[] = [];
  for (const rr of runs(rows, layout.rowCodes.length))
    for (const cc of runs(cols, layout.colCodes.length))
      rects.push({
        r0: rr.from, r1: rr.to, c0: cc.from, c1: cc.to,
        open: { top: rr.wrapStart, bottom: rr.wrapEnd, left: cc.wrapStart, right: cc.wrapEnd },
      });
  return rects;
}
