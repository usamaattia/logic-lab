/**
 * Truth tables and canonical forms.
 *
 * Row index = the inputs read as a binary number, first variable most significant
 * (A B C = 1 0 1 is row 5, minterm m5), the convention of every digital design textbook.
 */
import { AND, evaluate, NOT, OR, V, type Expr } from "./expr";

export type Out = 0 | 1 | "X"; // X = don't care

export interface TruthTable {
  vars: string[];
  /** one entry per row, 2^n of them */
  out: Out[];
}

export const MAX_VARS = 10;

export function rowValues(row: number, n: number): (0 | 1)[] {
  return Array.from({ length: n }, (_, i) => ((row >> (n - 1 - i)) & 1) as 0 | 1);
}

export function tableOf(e: Expr, vars: string[]): TruthTable {
  if (vars.length > MAX_VARS) throw new Error(`Up to ${MAX_VARS} variables.`);
  const out: Out[] = [];
  for (let r = 0; r < 1 << vars.length; r++) {
    const bits = rowValues(r, vars.length);
    out.push(evaluate(e, Object.fromEntries(vars.map((v, i) => [v, bits[i]]))));
  }
  return { vars, out };
}

export const minterms = (t: TruthTable) => t.out.flatMap((v, i) => (v === 1 ? [i] : []));
export const maxterms = (t: TruthTable) => t.out.flatMap((v, i) => (v === 0 ? [i] : []));
export const dontCares = (t: TruthTable) => t.out.flatMap((v, i) => (v === "X" ? [i] : []));

/** Canonical sum of products: one minterm per 1-row. */
export function canonicalSOP(t: TruthTable): Expr {
  const n = t.vars.length;
  const terms = minterms(t).map((m) =>
    AND(...rowValues(m, n).map((b, i) => (b ? V(t.vars[i]) : NOT(V(t.vars[i]))))),
  );
  return terms.length ? OR(...terms) : { t: "const", v: 0 };
}

/** Canonical product of sums: one maxterm per 0-row (a 0 in the row gives the plain variable). */
export function canonicalPOS(t: TruthTable): Expr {
  const n = t.vars.length;
  const terms = maxterms(t).map((m) =>
    OR(...rowValues(m, n).map((b, i) => (b ? NOT(V(t.vars[i])) : V(t.vars[i])))),
  );
  return terms.length ? AND(...terms) : { t: "const", v: 1 };
}

/** Σm(…) and ΠM(…) notation. */
export function sigma(t: TruthTable): string {
  const d = dontCares(t);
  return `Σm(${minterms(t).join(", ")})${d.length ? ` + d(${d.join(", ")})` : ""}`;
}
export function pi(t: TruthTable): string {
  const d = dontCares(t);
  return `ΠM(${maxterms(t).join(", ")})${d.length ? ` · D(${d.join(", ")})` : ""}`;
}

/** First row where two tables (over the same variables) disagree, ignoring don't-cares. */
export function firstDifference(a: TruthTable, b: TruthTable): number | null {
  for (let r = 0; r < a.out.length; r++) {
    if (a.out[r] === "X" || b.out[r] === "X") continue;
    if (a.out[r] !== b.out[r]) return r;
  }
  return null;
}
