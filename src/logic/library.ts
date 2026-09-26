/** Example circuits from an introductory digital design course. */
import type { Circuit, CompType, Component, Wire } from "./circuit";

type Extra = Partial<Pick<Component, "label" | "inputs" | "value">>;

function make(parts: (b: {
  c: (id: string, type: CompType, x: number, y: number, extra?: Extra) => void;
  w: (from: string, to: string, toPin?: number, fromPin?: number) => void;
}) => void): Circuit {
  const components: Component[] = [];
  const wires: Wire[] = [];
  parts({
    c: (id, type, x, y, extra = {}) => components.push({ id, type, x, y, ...extra }),
    w: (from, to, toPin = 0, fromPin = 0) =>
      wires.push({ id: `w${wires.length + 1}`, from: { id: from, pin: fromPin }, to: { id: to, pin: toPin } }),
  });
  return { components, wires };
}

export interface Example {
  id: string;
  name: string;
  about: string;
  circuit: () => Circuit;
}

export const EXAMPLES: Example[] = [
  {
    id: "half-adder",
    name: "Half adder",
    about: "Adds two bits: S = A ⊕ B, C = AB.",
    circuit: () => make(({ c, w }) => {
      c("A", "INPUT", 60, 80, { label: "A" });
      c("B", "INPUT", 60, 180, { label: "B" });
      c("x", "XOR", 240, 80, { inputs: 2 });
      c("a", "AND", 240, 180, { inputs: 2 });
      c("S", "OUTPUT", 420, 80, { label: "S" });
      c("C", "OUTPUT", 420, 180, { label: "C" });
      w("A", "x", 0); w("B", "x", 1); w("A", "a", 0); w("B", "a", 1); w("x", "S"); w("a", "C");
    }),
  },
  {
    id: "full-adder",
    name: "Full adder",
    about: "Adds three bits: S = A ⊕ B ⊕ Cin, Cout = AB + Cin(A ⊕ B).",
    circuit: () => make(({ c, w }) => {
      c("A", "INPUT", 60, 60, { label: "A" });
      c("B", "INPUT", 60, 140, { label: "B" });
      c("Cin", "INPUT", 60, 240, { label: "Cin" });
      c("x1", "XOR", 220, 80, { inputs: 2 });
      c("x2", "XOR", 400, 100, { inputs: 2 });
      c("a1", "AND", 220, 180, { inputs: 2 });
      c("a2", "AND", 400, 240, { inputs: 2 });
      c("o", "OR", 560, 210, { inputs: 2 });
      c("S", "OUTPUT", 720, 100, { label: "S" });
      c("Cout", "OUTPUT", 720, 210, { label: "Cout" });
      w("A", "x1", 0); w("B", "x1", 1); w("x1", "x2", 0); w("Cin", "x2", 1); w("x2", "S");
      w("A", "a1", 0); w("B", "a1", 1); w("x1", "a2", 0); w("Cin", "a2", 1);
      w("a1", "o", 0); w("a2", "o", 1); w("o", "Cout");
    }),
  },
  {
    id: "mux2",
    name: "2-to-1 multiplexer",
    about: "Y = S'I0 + SI1: S chooses which input reaches the output.",
    circuit: () => make(({ c, w }) => {
      c("S", "INPUT", 60, 60, { label: "S" });
      c("I0", "INPUT", 60, 160, { label: "I0" });
      c("I1", "INPUT", 60, 260, { label: "I1" });
      c("n", "NOT", 200, 60);
      c("a0", "AND", 340, 120, { inputs: 2 });
      c("a1", "AND", 340, 240, { inputs: 2 });
      c("o", "OR", 500, 180, { inputs: 2 });
      c("Y", "OUTPUT", 660, 180, { label: "Y" });
      w("S", "n"); w("n", "a0", 0); w("I0", "a0", 1); w("S", "a1", 0); w("I1", "a1", 1);
      w("a0", "o", 0); w("a1", "o", 1); w("o", "Y");
    }),
  },
  {
    id: "decoder",
    name: "2-to-4 decoder",
    about: "Exactly one output is 1: the one numbered by AB.",
    circuit: () => make(({ c, w }) => {
      c("A", "INPUT", 60, 80, { label: "A" });
      c("B", "INPUT", 60, 220, { label: "B" });
      c("nA", "NOT", 200, 40);
      c("nB", "NOT", 200, 260);
      ["D0", "D1", "D2", "D3"].forEach((d, i) => {
        c(`a${i}`, "AND", 360, 40 + i * 80, { inputs: 2 });
        c(d, "OUTPUT", 520, 40 + i * 80, { label: d });
        w(`a${i}`, d);
      });
      w("A", "nA"); w("B", "nB");
      w("nA", "a0", 0); w("nB", "a0", 1);
      w("nA", "a1", 0); w("B", "a1", 1);
      w("A", "a2", 0); w("nB", "a2", 1);
      w("A", "a3", 0); w("B", "a3", 1);
    }),
  },
  {
    id: "majority",
    name: "Majority voter",
    about: "F = AB + AC + BC: the output follows at least two of the three inputs.",
    circuit: () => make(({ c, w }) => {
      c("A", "INPUT", 60, 60, { label: "A" });
      c("B", "INPUT", 60, 160, { label: "B" });
      c("C", "INPUT", 60, 260, { label: "C" });
      c("ab", "AND", 240, 60, { inputs: 2 });
      c("ac", "AND", 240, 160, { inputs: 2 });
      c("bc", "AND", 240, 260, { inputs: 2 });
      c("o", "OR", 420, 160, { inputs: 3 });
      c("F", "OUTPUT", 580, 160, { label: "F" });
      w("A", "ab", 0); w("B", "ab", 1); w("A", "ac", 0); w("C", "ac", 1); w("B", "bc", 0); w("C", "bc", 1);
      w("ab", "o", 0); w("ac", "o", 1); w("bc", "o", 2); w("o", "F");
    }),
  },
  {
    id: "sr-latch",
    name: "SR latch (NOR)",
    about: "Set with S, reset with R, and it remembers. Try S = R = 1, then drop both.",
    circuit: () => make(({ c, w }) => {
      c("R", "INPUT", 60, 60, { label: "R" });
      c("S", "INPUT", 60, 220, { label: "S" });
      c("n1", "NOR", 260, 80, { inputs: 2 });
      c("n2", "NOR", 260, 200, { inputs: 2 });
      c("Q", "OUTPUT", 440, 80, { label: "Q" });
      c("Qn", "OUTPUT", 440, 200, { label: "Q'" });
      w("R", "n1", 0); w("n2", "n1", 1); w("S", "n2", 1); w("n1", "n2", 0);
      w("n1", "Q"); w("n2", "Qn");
    }),
  },
  {
    id: "d-latch",
    name: "Gated D latch (NAND)",
    about: "While EN = 1, Q follows D; when EN = 0, Q holds.",
    circuit: () => make(({ c, w }) => {
      c("D", "INPUT", 60, 60, { label: "D" });
      c("EN", "INPUT", 60, 180, { label: "EN" });
      c("nd", "NOT", 180, 260);
      c("g1", "NAND", 320, 80, { inputs: 2 });
      c("g2", "NAND", 320, 240, { inputs: 2 });
      c("g3", "NAND", 480, 100, { inputs: 2 });
      c("g4", "NAND", 480, 220, { inputs: 2 });
      c("Q", "OUTPUT", 640, 100, { label: "Q" });
      c("Qn", "OUTPUT", 640, 220, { label: "Q'" });
      w("D", "g1", 0); w("EN", "g1", 1); w("D", "nd"); w("nd", "g2", 1); w("EN", "g2", 0);
      w("g1", "g3", 0); w("g4", "g3", 1); w("g2", "g4", 1); w("g3", "g4", 0);
      w("g3", "Q"); w("g4", "Qn");
    }),
  },
  {
    id: "counter",
    name: "3-bit counter",
    about: "Synchronous up counter from T flip-flops: T0 = 1, T1 = Q0, T2 = Q0Q1. Press Tick.",
    circuit: () => make(({ c, w }) => {
      c("clk", "CLOCK", 60, 320, { label: "CLK" });
      c("one", "CONST1", 60, 60);
      c("zero", "CONST0", 620, 330);
      c("t0", "TFF", 220, 60, { label: "FF0" });
      c("t1", "TFF", 400, 60, { label: "FF1" });
      c("t2", "TFF", 580, 60, { label: "FF2" });
      c("and", "AND", 400, 200, { inputs: 2 });
      c("Q0", "OUTPUT", 760, 60, { label: "Q0" });
      c("Q1", "OUTPUT", 760, 140, { label: "Q1" });
      c("Q2", "OUTPUT", 760, 220, { label: "Q2" });
      c("seg", "SEG7", 780, 320);
      w("one", "t0", 0); w("clk", "t0", 1); w("clk", "t1", 1); w("clk", "t2", 1);
      w("t0", "t1", 0); w("t0", "and", 0); w("t1", "and", 1); w("and", "t2", 0);
      w("t0", "Q0"); w("t1", "Q1"); w("t2", "Q2");
      w("zero", "seg", 0); w("t2", "seg", 1); w("t1", "seg", 2); w("t0", "seg", 3);
    }),
  },
  {
    id: "ring",
    name: "Ring oscillator",
    about: "A NAND gate feeding itself. With EN = 0 the output is 1; switch EN to 1 and it can never settle.",
    circuit: () => make(({ c, w }) => {
      c("EN", "INPUT", 60, 80, { label: "EN", value: 0 });
      c("n", "NAND", 240, 100, { inputs: 2 });
      c("Y", "OUTPUT", 420, 100, { label: "Y" });
      w("EN", "n", 0); w("n", "n", 1); w("n", "Y");
    }),
  },
];

export const EMPTY: Circuit = { components: [], wires: [] };
