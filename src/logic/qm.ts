/**
 * Two-level minimisation: Quine–McCluskey for the prime implicants, then an exact
 * minimum cover (fewest terms, then fewest literals) by branch and bound, which gives the
 * same answer as Petrick's method without expanding its product of sums.
 *
 * An implicant is (value, mask): bits set in `mask` are "don't care" positions, i.e. that
 * variable does not appear in the term. Bit n-1 is the first variable.
 */
import { AND, NOT, OR, V, type Expr } from "./expr";
import { dontCares, maxterms, minterms, type TruthTable } from "./truth";

export interface Implicant {
  value: number;
  mask: number;
  /** every row the term is 1 on (minterms and don't-cares) */
  covers: number[];
}

export interface Minimised {
  form: "SOP" | "POS";
  expr: Expr;
  /** terms of the result; for POS, these are the implicants of F' (the zeros) */
  terms: Implicant[];
  primes: Implicant[];
  essential: Implicant[];
  literals: number;
}

const popcount = (x: number) => {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
};

export function literalCount(imp: Implicant, n: number): number {
  return n - popcount(imp.mask);
}

function coveredRows(value: number, mask: number, n: number): number[] {
  const rows: number[] = [];
  for (let r = 0; r < 1 << n; r++) if ((r & ~mask) === (value & ~mask)) rows.push(r);
  return rows;
}

export function primeImplicants(n: number, ones: number[], dcs: number[]): Implicant[] {
  let current = new Map<string, { value: number; mask: number }>();
  for (const m of [...ones, ...dcs]) current.set(`${m}/0`, { value: m, mask: 0 });
  const primes: { value: number; mask: number }[] = [];
  while (current.size) {
    const next = new Map<string, { value: number; mask: number }>();
    const used = new Set<string>();
    const list = [...current.entries()];
    // group by mask, then combine pairs differing in exactly one (non-masked) bit
    const byMask = new Map<number, [string, { value: number; mask: number }][]>();
    for (const e of list) byMask.set(e[1].mask, [...(byMask.get(e[1].mask) ?? []), e]);
    for (const group of byMask.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [ka, a] = group[i];
          const [kb, b] = group[j];
          const diff = a.value ^ b.value;
          if (popcount(diff) !== 1) continue;
          const mask = a.mask | diff;
          const value = a.value & ~diff;
          next.set(`${value}/${mask}`, { value, mask });
          used.add(ka);
          used.add(kb);
        }
      }
    }
    for (const [k, v] of list) if (!used.has(k)) primes.push(v);
    current = next;
  }
  return primes
    .map((p) => ({ ...p, covers: coveredRows(p.value, p.mask, n) }))
    .sort((a, b) => literalCount(a, n) - literalCount(b, n) || a.value - b.value || a.mask - b.mask);
}

/** Minimum cover of `ones` by `primes`: fewest terms, then fewest literals. */
export function minimumCover(n: number, ones: number[], primes: Implicant[]): { chosen: Implicant[]; essential: Implicant[] } {
  const need = new Set(ones);
  const coverers = new Map<number, number[]>();
  for (const m of ones) coverers.set(m, primes.flatMap((p, i) => (p.covers.includes(m) ? [i] : [])));

  // essential prime implicants: the only cover of some minterm
  const essentialIdx = new Set<number>();
  for (const m of ones) if (coverers.get(m)!.length === 1) essentialIdx.add(coverers.get(m)![0]);
  const chosen0 = [...essentialIdx];
  for (const i of chosen0) primes[i].covers.forEach((m) => need.delete(m));

  const cost = (idx: number[]) => idx.length * 1000 + idx.reduce((s, i) => s + literalCount(primes[i], n), 0);
  let best: number[] | null = null;
  let bestCost = Infinity;

  const search = (chosen: number[], left: Set<number>) => {
    const c = cost(chosen);
    if (c >= bestCost) return;
    if (left.size === 0) { best = chosen; bestCost = c; return; }
    // branch on the uncovered minterm with the fewest options
    let pick = -1;
    let fewest = Infinity;
    for (const m of left) {
      const k = coverers.get(m)!.length;
      if (k < fewest) { fewest = k; pick = m; }
    }
    // lower bound: at least one more term
    if (c + 1000 >= bestCost) return;
    const options = [...coverers.get(pick)!].sort((a, b) =>
      primes[b].covers.filter((m) => left.has(m)).length - primes[a].covers.filter((m) => left.has(m)).length ||
      literalCount(primes[a], n) - literalCount(primes[b], n));
    for (const i of options) {
      const rest = new Set(left);
      primes[i].covers.forEach((m) => rest.delete(m));
      search([...chosen, i], rest);
    }
  };
  search(chosen0, need);
  const chosen = (best ?? chosen0).map((i) => primes[i]);
  return { chosen, essential: chosen0.map((i) => primes[i]) };
}

export function termExpr(imp: Implicant, vars: string[], complement = false): Expr {
  const n = vars.length;
  const lits: Expr[] = [];
  vars.forEach((v, i) => {
    const bit = 1 << (n - 1 - i);
    if (imp.mask & bit) return;
    const positive = (imp.value & bit) !== 0;
    lits.push(positive !== complement ? V(v) : NOT(V(v)));
  });
  if (!lits.length) return { t: "const", v: complement ? 0 : 1 };
  return complement ? OR(...lits) : AND(...lits);
}

export function minimiseSOP(table: TruthTable): Minimised {
  const n = table.vars.length;
  const ones = minterms(table);
  const dcs = dontCares(table);
  if (!ones.length) return { form: "SOP", expr: { t: "const", v: 0 }, terms: [], primes: [], essential: [], literals: 0 };
  const primes = primeImplicants(n, ones, dcs);
  const { chosen, essential } = minimumCover(n, ones, primes);
  const terms = sortTerms(chosen, n);
  return {
    form: "SOP",
    expr: terms.length === 1 ? termExpr(terms[0], table.vars) : OR(...terms.map((t) => termExpr(t, table.vars))),
    terms,
    primes,
    essential,
    literals: terms.reduce((s, t) => s + literalCount(t, n), 0),
  };
}

/** Minimise F' as a sum of products, then apply De Morgan to get F as a product of sums. */
export function minimisePOS(table: TruthTable): Minimised {
  const n = table.vars.length;
  const zeros = maxterms(table);
  const dcs = dontCares(table);
  if (!zeros.length) return { form: "POS", expr: { t: "const", v: 1 }, terms: [], primes: [], essential: [], literals: 0 };
  const primes = primeImplicants(n, zeros, dcs);
  const { chosen, essential } = minimumCover(n, zeros, primes);
  const terms = sortTerms(chosen, n);
  return {
    form: "POS",
    expr: terms.length === 1 ? termExpr(terms[0], table.vars, true) : AND(...terms.map((t) => termExpr(t, table.vars, true))),
    terms,
    primes,
    essential,
    literals: terms.reduce((s, t) => s + literalCount(t, n), 0),
  };
}

function sortTerms(terms: Implicant[], n: number): Implicant[] {
  // fewer literals first; then the term whose first variable appears earliest
  const key = (t: Implicant) => {
    let s = "";
    for (let i = n - 1; i >= 0; i--) s += t.mask & (1 << i) ? "2" : t.value & (1 << i) ? "1" : "0";
    return s;
  };
  return [...terms].sort((a, b) => literalCount(a, n) - literalCount(b, n) || key(a).localeCompare(key(b)));
}

/**
 * Cost of the two-level circuit: gates and gate inputs, not counting inverters on the
 * inputs (the usual textbook measure). A single-literal term needs no gate.
 */
export function twoLevelCost(m: Minimised, n: number): { gates: number; gateInputs: number } {
  const sizes = m.terms.map((t) => literalCount(t, n));
  const inner = sizes.filter((k) => k > 1);
  const outer = m.terms.length > 1 ? 1 : 0;
  return {
    gates: inner.length + outer,
    gateInputs: inner.reduce((s, k) => s + k, 0) + (outer ? m.terms.length : 0),
  };
}
