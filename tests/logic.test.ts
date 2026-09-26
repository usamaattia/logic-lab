import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { circuitFromExpr, nandCircuit, norCircuit } from "../src/logic/build";
import { analyse, seg7Value, simulateTable, Simulator, timing, type Circuit } from "../src/logic/circuit";
import { evaluate, parse, ParseError, print, variables, type Expr } from "../src/logic/expr";
import { groupRects, kmapLayout } from "../src/logic/kmap";
import { EXAMPLES } from "../src/logic/library";
import { minimisePOS, minimiseSOP, primeImplicants, twoLevelCost } from "../src/logic/qm";
import { canonicalPOS, canonicalSOP, firstDifference, pi, sigma, tableOf, type Out, type TruthTable } from "../src/logic/truth";

const fromMinterms = (vars: string[], ones: number[], dcs: number[] = []): TruthTable => ({
  vars,
  out: Array.from({ length: 1 << vars.length }, (_, r): Out => (ones.includes(r) ? 1 : dcs.includes(r) ? "X" : 0)),
});
const same = (a: Expr, b: Expr, vars: string[]) => firstDifference(tableOf(a, vars), tableOf(b, vars)) === null;
const termSet = (s: string) => new Set(s.split(" + "));

describe("parsing", () => {
  it.each([
    ["A'B + AB'", "A'B + AB'"],
    ["!A & B | A & !B", "A'B + AB'"],
    ["NOT A AND B OR A AND NOT B", "A'B + AB'"],
    ["(A+B)(A'+C)", "(A + B)(A' + C)"],
    ["A ⊕ B ⊕ C", "A ⊕ B ⊕ C"],
    ["(AB)'", "(AB)'"],
    ["A''", "A''"],
    ["x1 x2' + 1", "x1x2' + 1"],
  ])("%s", (src, out) => expect(print(parse(src))).toBe(out));

  it("reads multi-letter names when they are known", () => {
    const e = parse("A B + Cin(A ^ B)", ["Cin"]);
    expect(variables(e)).toEqual(["A", "B", "Cin"]);
    expect(print(e)).toBe("A·B + Cin·(A ⊕ B)");
  });

  it("explains mistakes with a position", () => {
    expect(() => parse("A + (B")).toThrow(/Missing "\)"/);
    expect(() => parse("A + ")).toThrow(ParseError);
    expect(() => parse("A $ B")).toThrow(/position 3/);
    expect(() => parse("A)")).toThrow(/Unmatched/);
  });

  it("round-trips through print for random expressions", () => {
    const leaf = fc.constantFrom<Expr>({ t: "var", name: "A" }, { t: "var", name: "B" }, { t: "var", name: "C" }, { t: "const", v: 1 });
    const exprArb = fc.letrec<{ e: Expr }>((tie) => ({
      e: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        leaf,
        tie("e").map((a): Expr => ({ t: "not", a })),
        fc.array(tie("e"), { minLength: 2, maxLength: 3 }).map((args): Expr => ({ t: "and", args })),
        fc.array(tie("e"), { minLength: 2, maxLength: 3 }).map((args): Expr => ({ t: "or", args })),
        fc.array(tie("e"), { minLength: 2, maxLength: 3 }).map((args): Expr => ({ t: "xor", args })),
      ),
    })).e;
    fc.assert(fc.property(exprArb, (e) => same(parse(print(e)), e, ["A", "B", "C"])), { numRuns: 500 });
  });
});

describe("truth tables and canonical forms", () => {
  it("numbers rows with the first variable as the most significant bit", () => {
    const t = tableOf(parse("A B' C"), ["A", "B", "C"]);
    expect(t.out.indexOf(1)).toBe(5);
    expect(sigma(t)).toBe("Σm(5)");
  });
  it("canonical SOP and POS equal the function", () => {
    const vars = ["A", "B", "C"];
    const f = parse("A'B + C");
    const t = tableOf(f, vars);
    expect(same(canonicalSOP(t), f, vars)).toBe(true);
    expect(same(canonicalPOS(t), f, vars)).toBe(true);
    expect(pi(t)).toBe("ΠM(0, 4, 6)");
  });
});

describe("minimisation: textbook examples (Mano & Ciletti, Digital Design)", () => {
  it("F(x,y,z) = Σm(0,2,4,5,6) = z' + xy'", () => {
    const m = minimiseSOP(fromMinterms(["x", "y", "z"], [0, 2, 4, 5, 6]));
    expect(termSet(print(m.expr))).toEqual(termSet("z' + xy'"));
  });
  it("F(w,x,y,z) = Σm(0,1,2,4,5,6,8,9,12,13,14) = y' + w'z' + xz'", () => {
    const m = minimiseSOP(fromMinterms(["w", "x", "y", "z"], [0, 1, 2, 4, 5, 6, 8, 9, 12, 13, 14]));
    expect(termSet(print(m.expr))).toEqual(termSet("y' + w'z' + xz'"));
    expect(m.literals).toBe(5);
  });
  it("don't-cares: F = Σm(1,3,7,11,15) + d(0,2,5) = yz + w'x'", () => {
    const t = fromMinterms(["w", "x", "y", "z"], [1, 3, 7, 11, 15], [0, 2, 5]);
    const m = minimiseSOP(t);
    expect(m.terms).toHaveLength(2);
    expect(m.literals).toBe(4);
    expect(firstDifference(tableOf(m.expr, t.vars), t)).toBeNull();
  });
  it("F = Σm(0,1,2,5,8,9,10): SOP x'y' + x'z' + w'y'z, POS with three sums and six literals", () => {
    const t = fromMinterms(["w", "x", "y", "z"], [0, 1, 2, 5, 8, 9, 10]);
    const pos = minimisePOS(t);
    expect(print(pos.expr).split(")(").length).toBe(3);
    expect(pos.literals).toBe(6);
    expect(firstDifference(tableOf(pos.expr, t.vars), t)).toBeNull();
    const sop = minimiseSOP(t);
    expect(termSet(print(sop.expr))).toEqual(termSet("x'y' + x'z' + w'y'z"));
  });
  it("a cyclic core (no essential primes) still gets a minimum cover", () => {
    // Σm(0,1,2,5,6,7): six primes, none essential, two covers of three terms
    const t = fromMinterms(["A", "B", "C"], [0, 1, 2, 5, 6, 7]);
    const m = minimiseSOP(t);
    expect(m.essential).toHaveLength(0);
    expect(m.terms).toHaveLength(3);
    expect(primeImplicants(3, [0, 1, 2, 5, 6, 7], [])).toHaveLength(6);
  });
  it("constant functions", () => {
    expect(print(minimiseSOP(fromMinterms(["A", "B"], [])).expr)).toBe("0");
    expect(print(minimiseSOP(fromMinterms(["A", "B"], [0, 1, 2, 3])).expr)).toBe("1");
  });
});

describe("minimisation: properties", () => {
  const tableArb = fc.integer({ min: 1, max: 5 }).chain((n) =>
    fc.array(fc.constantFrom<Out>(0, 1, "X", 0, 1), { minLength: 1 << n, maxLength: 1 << n }).map((out): TruthTable => ({
      vars: ["A", "B", "C", "D", "E"].slice(0, n),
      out,
    })),
  );
  it("SOP and POS results implement the function (don't-cares free)", () => {
    fc.assert(fc.property(tableArb, (t) => {
      expect(firstDifference(tableOf(minimiseSOP(t).expr, t.vars), t)).toBeNull();
      expect(firstDifference(tableOf(minimisePOS(t).expr, t.vars), t)).toBeNull();
    }), { numRuns: 400 });
  });
  it("never uses more terms or literals than the canonical form", () => {
    fc.assert(fc.property(tableArb, (t) => {
      const m = minimiseSOP(t);
      const ones = t.out.filter((v) => v === 1).length;
      expect(m.terms.length).toBeLessThanOrEqual(ones);
      expect(m.literals).toBeLessThanOrEqual(ones * t.vars.length);
    }), { numRuns: 400 });
  });
  it("the cover is minimal: no chosen term can be dropped", () => {
    fc.assert(fc.property(tableArb, (t) => {
      const m = minimiseSOP(t);
      const ones = t.out.flatMap((v, i) => (v === 1 ? [i] : []));
      for (let k = 0; k < m.terms.length; k++) {
        const rest = m.terms.filter((_, j) => j !== k);
        expect(ones.every((r) => rest.some((p) => p.covers.includes(r)))).toBe(false);
      }
    }), { numRuns: 400 });
  });
  it("two-level cost counts gates and gate inputs", () => {
    const m = minimiseSOP(fromMinterms(["w", "x", "y", "z"], [0, 1, 2, 4, 5, 6, 8, 9, 12, 13, 14]));
    expect(twoLevelCost(m, 4)).toEqual({ gates: 3, gateInputs: 7 }); // two ANDs + one 3-input OR
  });
});

describe("Karnaugh maps", () => {
  it("uses Gray code order", () => {
    const k = kmapLayout(["A", "B", "C", "D"]);
    expect([0, 1, 2, 3].map((c) => k.cell(0, c))).toEqual([0, 1, 3, 2]);
    expect([0, 1, 2, 3].map((r) => k.cell(r, 0))).toEqual([0, 4, 12, 8]);
  });
  it("splits a wrap-around group into pieces with open sides", () => {
    const k = kmapLayout(["w", "x", "y", "z"]);
    const m = minimiseSOP(fromMinterms(["w", "x", "y", "z"], [0, 2, 8, 10])); // the four corners: x'z'
    expect(print(m.expr)).toBe("x'z'");
    const rects = groupRects(m.terms[0], k);
    expect(rects).toHaveLength(4);
    expect(rects.every((r) => r.r0 === r.r1 && r.c0 === r.c1)).toBe(true);
    expect(rects[0].open).toEqual({ top: true, bottom: false, left: true, right: false });
  });
});

const run = (c: Circuit, inputs: Record<string, 0 | 1>) => {
  const comps = c.components.map((x) => (x.type === "INPUT" && x.label! in inputs ? { ...x, value: inputs[x.label!] } : x));
  const sim = new Simulator({ ...c, components: comps });
  const res = sim.settle();
  const outs = Object.fromEntries(c.components.filter((x) => x.type === "OUTPUT").map((o) => [o.label!, sim.input(o, 0)]));
  return { sim, res, outs, comps };
};

describe("simulation", () => {
  const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.circuit();

  it("full adder adds", () => {
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const { outs } = run(ex("full-adder"), { A: a as 0 | 1, B: b as 0 | 1, Cin: c as 0 | 1 });
      expect((outs.Cout as number) * 2 + (outs.S as number)).toBe(a + b + c);
    }
  });

  it("derives the expressions of a combinational circuit", () => {
    const a = analyse(ex("full-adder"));
    expect(a.combinational).toBe(true);
    const cout = a.expressions.get("Cout") as Expr;
    expect(same(cout, parse("AB + ACin + BCin", ["Cin"]), ["A", "B", "Cin"])).toBe(true);
  });

  it("simulation and derived expressions agree on every example", () => {
    for (const e of EXAMPLES) {
      const c = e.circuit();
      const a = analyse(c);
      if (!a.combinational) continue;
      const sim = simulateTable(c);
      a.outputs.forEach((o, j) => {
        const t = tableOf(a.expressions.get(o.label!) as Expr, a.inputs.map((i) => i.label!));
        expect(sim.rows.map((r) => r[j])).toEqual(t.out);
      });
    }
  });

  it("an SR latch remembers, and S = R = 1 then 0 oscillates", () => {
    const c = ex("sr-latch");
    const sim = new Simulator(c);
    const set = (S: 0 | 1, R: 0 | 1) => {
      sim.setCircuit({ ...c, components: c.components.map((x) => (x.label === "S" ? { ...x, value: S } : x.label === "R" ? { ...x, value: R } : x)) });
      return sim.settle();
    };
    const q = () => sim.input(c.components.find((x) => x.label === "Q")!, 0);
    set(0, 0);
    expect(q()).toBe("X"); // never set: unknown
    set(1, 0);
    expect(q()).toBe(1);
    set(0, 0);
    expect(q()).toBe(1); // remembered
    set(0, 1);
    expect(q()).toBe(0);
    expect(set(1, 1).stable).toBe(true);
    const r = set(0, 0); // both released at once: the race
    expect(r.stable).toBe(false);
    expect(r.oscillating.length).toBeGreaterThan(0);
  });

  it("a ring oscillator is reported, not hung", () => {
    const c = ex("ring");
    const sim = new Simulator(c);
    expect(sim.settle().stable).toBe(true); // EN = 0: Y = 1
    expect(sim.output("n")).toBe(1);
    sim.setCircuit({ ...c, components: c.components.map((x) => (x.id === "EN" ? { ...x, value: 1 } : x)) });
    const r = sim.settle();
    expect(r.stable).toBe(false);
    expect(r.oscillating).toContain("n:0");
  });

  it("unconnected inputs are X, and analysis says which one", () => {
    const c: Circuit = {
      components: [
        { id: "a", type: "INPUT", x: 0, y: 0, label: "A", value: 1 },
        { id: "g", type: "AND", x: 0, y: 0, inputs: 2 },
        { id: "o", type: "OUTPUT", x: 0, y: 0, label: "F" },
      ],
      wires: [{ id: "1", from: { id: "a", pin: 0 }, to: { id: "g", pin: 0 } }, { id: "2", from: { id: "g", pin: 0 }, to: { id: "o", pin: 0 } }],
    };
    expect(run(c, {}).outs.F).toBe("X");
    expect((analyse(c).expressions.get("F") as { error: string }).error).toMatch(/in2 is not connected/);
  });

  it("the 3-bit counter counts 0 to 7 and wraps, on the 7-segment display too", () => {
    const c = ex("counter");
    const sim = new Simulator(c);
    sim.settle();
    const seg = c.components.find((x) => x.type === "SEG7")!;
    const seen: (number | null)[] = [seg7Value(sim, seg)];
    for (let i = 0; i < 9; i++) { sim.tick(); seen.push(seg7Value(sim, seg)); }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });

  it("timing traces record every half cycle", () => {
    const t = timing(ex("counter"), 4);
    expect(t.samples).toHaveLength(9);
    const q0 = t.signals.indexOf("Q0");
    expect(t.samples.map((s) => s[q0])).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it("D, JK and T flip-flops change only on the rising edge", () => {
    const mk = (type: "DFF" | "JKFF" | "TFF", ins: (0 | 1)[]): Circuit => ({
      components: [
        { id: "clk", type: "CLOCK", x: 0, y: 0, label: "CLK" },
        ...ins.map((v, i) => ({ id: `i${i}`, type: "INPUT" as const, x: 0, y: 0, label: `I${i}`, value: v })),
        { id: "ff", type, x: 0, y: 0 },
      ],
      wires: [
        { id: "c", from: { id: "clk", pin: 0 }, to: { id: "ff", pin: 1 } },
        ...ins.map((_, i) => ({ id: `w${i}`, from: { id: `i${i}`, pin: 0 }, to: { id: "ff", pin: i === 0 ? 0 : 2 } })),
      ],
    });
    const q = (c: Circuit, ticks: number) => {
      const s = new Simulator(c);
      s.settle();
      const trace = [s.output("ff")];
      for (let i = 0; i < ticks; i++) { s.tick(); trace.push(s.output("ff")); }
      return trace;
    };
    expect(q(mk("DFF", [1]), 2)).toEqual([0, 1, 1]);
    expect(q(mk("TFF", [1]), 3)).toEqual([0, 1, 0, 1]);
    expect(q(mk("JKFF", [1, 1]), 3)).toEqual([0, 1, 0, 1]); // J = K = 1 toggles
    expect(q(mk("JKFF", [1, 0]), 2)).toEqual([0, 1, 1]); // set
    expect(q(mk("JKFF", [0, 1]), 2)).toEqual([0, 0, 0]); // reset
  });
});

describe("circuits built from expressions", () => {
  const exprArb = fc.integer({ min: 1, max: 4 }).chain((n) =>
    fc.array(fc.constantFrom<Out>(0, 1), { minLength: 1 << n, maxLength: 1 << n }).map((out): TruthTable => ({ vars: ["A", "B", "C", "D"].slice(0, n), out })),
  );
  it("as written, NAND-NAND and NOR-NOR circuits all compute the function", () => {
    fc.assert(fc.property(exprArb, (t) => {
      const check = (c: Circuit) => {
        const sim = simulateTable(c);
        expect(sim.rows.map((r) => r[0])).toEqual(t.out);
      };
      check(circuitFromExpr(canonicalSOP(t), t.vars));
      check(nandCircuit(minimiseSOP(t), t.vars));
      check(norCircuit(minimisePOS(t), t.vars));
      const nand = nandCircuit(minimiseSOP(t), t.vars);
      expect(nand.components.every((c) => ["INPUT", "OUTPUT", "NAND", "CONST0", "CONST1"].includes(c.type))).toBe(true);
    }), { numRuns: 300 });
  });
  it("evaluates expressions directly too", () => {
    expect(evaluate(parse("A ⊕ B ⊕ C"), { A: 1, B: 1, C: 1 })).toBe(1);
  });
});
