/**
 * Circuit model and simulator.
 *
 * Three-valued logic: 0, 1 and X (unknown: an unconnected input, or a latch that has not
 * been set yet). Simulation is synchronous with a unit delay per component: every
 * component computes its outputs from the previous values, all at once, until nothing
 * changes. That makes feedback work (latches remember, because net values persist between
 * settles) and makes races visible: a loop that never settles is reported as oscillating,
 * which is exactly what happens to an SR latch when S and R fall together from 1, 1.
 *
 * Flip-flops are edge-triggered primitives that act on a rising clock edge and start at
 * Q = 0 (as if reset at power-on).
 */
import { NOT as NOTX, type Expr } from "./expr";

export type Level = 0 | 1 | "X";

export type CompType =
  | "INPUT" | "CLOCK" | "CONST0" | "CONST1" | "OUTPUT"
  | "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XOR" | "XNOR" | "BUF"
  | "DFF" | "JKFF" | "TFF" | "SEG7";

export interface Component {
  id: string;
  type: CompType;
  x: number;
  y: number;
  label?: string;
  /** number of inputs for AND/OR/NAND/NOR/XOR/XNOR (2–8) */
  inputs?: number;
  /** INPUT switch position */
  value?: 0 | 1;
}

export interface PinRef {
  id: string;
  pin: number;
}

export interface Wire {
  id: string;
  from: PinRef; // an output pin
  to: PinRef; // an input pin
}

export interface Circuit {
  components: Component[];
  wires: Wire[];
}

export const GATES: CompType[] = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF"];
export const MULTI_INPUT = new Set<CompType>(["AND", "OR", "NAND", "NOR", "XOR", "XNOR"]);
const FLIP_FLOPS = new Set<CompType>(["DFF", "JKFF", "TFF"]);

export function inputNames(c: Component): string[] {
  switch (c.type) {
    case "INPUT": case "CLOCK": case "CONST0": case "CONST1": return [];
    case "OUTPUT": case "NOT": case "BUF": return ["in"];
    case "DFF": return ["D", "CLK"];
    case "JKFF": return ["J", "CLK", "K"];
    case "TFF": return ["T", "CLK"];
    case "SEG7": return ["D3", "D2", "D1", "D0"];
    default: return Array.from({ length: c.inputs ?? 2 }, (_, i) => `in${i + 1}`);
  }
}

export function outputNames(c: Component): string[] {
  if (c.type === "OUTPUT" || c.type === "SEG7") return [];
  if (FLIP_FLOPS.has(c.type)) return ["Q", "Q'"];
  return ["out"];
}

const key = (id: string, pin: number) => `${id}:${pin}`;

// -- three-valued gates ----------------------------------------------------------------

const and3 = (xs: Level[]): Level => (xs.includes(0) ? 0 : xs.every((x) => x === 1) ? 1 : "X");
const or3 = (xs: Level[]): Level => (xs.includes(1) ? 1 : xs.every((x) => x === 0) ? 0 : "X");
const not3 = (x: Level): Level => (x === "X" ? "X" : x ? 0 : 1);
const xor3 = (xs: Level[]): Level => (xs.includes("X") ? "X" : ((xs.reduce<number>((s, x) => s ^ (x as number), 0) & 1) as 0 | 1));

export function gate(type: CompType, xs: Level[]): Level {
  switch (type) {
    case "AND": return and3(xs);
    case "OR": return or3(xs);
    case "NAND": return not3(and3(xs));
    case "NOR": return not3(or3(xs));
    case "XOR": return xor3(xs);
    case "XNOR": return not3(xor3(xs));
    case "NOT": return not3(xs[0]);
    case "BUF": return xs[0];
    default: throw new Error(`${type} is not a gate`);
  }
}

// -- simulator ---------------------------------------------------------------------------

export interface FFState {
  q: Level;
  lastClk: Level;
}

export interface SettleResult {
  stable: boolean;
  iterations: number;
  /** nets still changing when the simulator gave up */
  oscillating: string[];
}

export class Simulator {
  values = new Map<string, Level>(); // output pin values
  ff = new Map<string, FFState>();
  clocks = new Map<string, 0 | 1>();
  circuit: Circuit;
  private drivers = new Map<string, PinRef>(); // input pin -> output pin

  constructor(circuit: Circuit) {
    this.circuit = circuit;
    this.setCircuit(circuit);
  }

  /** Swap in an edited circuit, keeping the state of components that still exist. */
  setCircuit(circuit: Circuit): void {
    this.circuit = circuit;
    this.drivers.clear();
    for (const w of circuit.wires) this.drivers.set(key(w.to.id, w.to.pin), w.from);
    const ids = new Set(circuit.components.map((c) => c.id));
    for (const k of [...this.values.keys()]) if (!ids.has(k.split(":")[0])) this.values.delete(k);
    for (const c of circuit.components) {
      if (FLIP_FLOPS.has(c.type) && !this.ff.has(c.id)) this.ff.set(c.id, { q: 0, lastClk: "X" });
      if (c.type === "CLOCK" && !this.clocks.has(c.id)) this.clocks.set(c.id, 0);
    }
  }

  reset(): void {
    this.values.clear();
    for (const s of this.ff.values()) { s.q = 0; s.lastClk = "X"; }
    for (const id of this.clocks.keys()) this.clocks.set(id, 0);
  }

  input(c: Component, pin: number): Level {
    const d = this.drivers.get(key(c.id, pin));
    return d ? this.values.get(key(d.id, d.pin)) ?? "X" : "X";
  }

  output(id: string, pin = 0): Level {
    return this.values.get(key(id, pin)) ?? "X";
  }

  settle(maxIterations?: number): SettleResult {
    const comps = this.circuit.components;
    const limit = maxIterations ?? comps.length * 4 + 20;
    let changed: string[] = [];
    for (let it = 1; it <= limit; it++) {
      const next = new Map<string, Level>();
      const ffUpdates: [string, FFState][] = [];
      for (const c of comps) {
        const ins = inputNames(c).map((_, i) => this.input(c, i));
        switch (c.type) {
          case "INPUT": next.set(key(c.id, 0), c.value ?? 0); break;
          case "CLOCK": next.set(key(c.id, 0), this.clocks.get(c.id) ?? 0); break;
          case "CONST0": next.set(key(c.id, 0), 0); break;
          case "CONST1": next.set(key(c.id, 0), 1); break;
          case "OUTPUT": case "SEG7": break;
          case "DFF": case "JKFF": case "TFF": {
            const s = this.ff.get(c.id)!;
            const clk = ins[1];
            let q = s.q;
            if (s.lastClk === 0 && clk === 1) q = nextState(c.type, s.q, ins);
            else if (s.lastClk === 0 && clk === "X") q = "X";
            ffUpdates.push([c.id, { q, lastClk: clk }]);
            next.set(key(c.id, 0), q);
            next.set(key(c.id, 1), not3(q));
            break;
          }
          default: next.set(key(c.id, 0), gate(c.type, ins));
        }
      }
      changed = [...next.keys()].filter((k) => next.get(k) !== this.values.get(k));
      const ffChanged = ffUpdates.some(([id, s]) => {
        const old = this.ff.get(id)!;
        return old.q !== s.q || old.lastClk !== s.lastClk;
      });
      for (const [id, s] of ffUpdates) this.ff.set(id, s);
      this.values = next;
      if (!changed.length && !ffChanged) return { stable: true, iterations: it, oscillating: [] };
    }
    return { stable: false, iterations: limit, oscillating: changed };
  }

  /** One full clock cycle for every CLOCK component: rising edge, settle, falling edge, settle. */
  tick(): SettleResult {
    for (const id of this.clocks.keys()) this.clocks.set(id, 1);
    const a = this.settle();
    for (const id of this.clocks.keys()) this.clocks.set(id, 0);
    const b = this.settle();
    return a.stable ? b : a;
  }
}

function nextState(type: CompType, q: Level, ins: Level[]): Level {
  if (type === "DFF") return ins[0];
  if (type === "TFF") return ins[0] === "X" || q === "X" ? "X" : ins[0] ? not3(q) : q;
  const [j, , k] = ins;
  if (j === "X" || k === "X") return "X";
  if (!j && !k) return q;
  if (!j && k) return 0;
  if (j && !k) return 1;
  return not3(q);
}

/** Decimal value shown by a 7-segment display (D3 is the most significant input), or null. */
export function seg7Value(sim: Simulator, c: Component): number | null {
  const bits = [0, 1, 2, 3].map((i) => sim.input(c, i));
  if (bits.includes("X")) return null;
  return bits.reduce<number>((v, b) => v * 2 + (b as number), 0);
}

// -- analysis ----------------------------------------------------------------------------

export interface Analysis {
  inputs: Component[]; // INPUT components, sorted by label
  outputs: Component[]; // OUTPUT components, sorted by label
  /** expression per OUTPUT label, or the reason there isn't one */
  expressions: Map<string, Expr | { error: string }>;
  combinational: boolean;
  problem?: string;
}

export const labelOf = (c: Component) => c.label?.trim() || c.id;

export function analyse(circuit: Circuit): Analysis {
  const byId = new Map(circuit.components.map((c) => [c.id, c]));
  const drivers = new Map<string, PinRef>();
  for (const w of circuit.wires) drivers.set(key(w.to.id, w.to.pin), w.from);
  const sortByLabel = (a: Component, b: Component) => labelOf(a).localeCompare(labelOf(b), "en", { numeric: true });
  const inputs = circuit.components.filter((c) => c.type === "INPUT").sort(sortByLabel);
  const outputs = circuit.components.filter((c) => c.type === "OUTPUT").sort(sortByLabel);
  const sequential = circuit.components.some((c) => FLIP_FLOPS.has(c.type) || c.type === "CLOCK");

  const expressions = new Map<string, Expr | { error: string }>();
  for (const o of outputs) {
    try {
      const visiting = new Set<string>();
      const build = (id: string, pin: number): Expr => {
        const c = byId.get(id)!;
        if (c.type === "INPUT") return { t: "var", name: labelOf(c) };
        if (c.type === "CONST0") return { t: "const", v: 0 };
        if (c.type === "CONST1") return { t: "const", v: 1 };
        if (FLIP_FLOPS.has(c.type) || c.type === "CLOCK")
          throw new Error("depends on a flip-flop or clock, so it has no single expression");
        if (visiting.has(id)) throw new Error("depends on a feedback loop (a latch?), so it has no single expression");
        visiting.add(id);
        const args = inputNames(c).map((name, i) => {
          const d = drivers.get(key(id, i));
          if (!d) throw new Error(`${c.type} ${labelOf(c)}: input ${name} is not connected`);
          return build(d.id, d.pin);
        });
        visiting.delete(id);
        void pin;
        switch (c.type) {
          case "AND": return { t: "and", args };
          case "OR": return { t: "or", args };
          case "XOR": return { t: "xor", args };
          case "NAND": return NOTX({ t: "and", args });
          case "NOR": return NOTX({ t: "or", args });
          case "XNOR": return NOTX({ t: "xor", args });
          case "NOT": return NOTX(args[0]);
          case "BUF": return args[0];
          default: throw new Error(`unsupported ${c.type}`);
        }
      };
      const d = drivers.get(key(o.id, 0));
      if (!d) throw new Error("is not connected");
      expressions.set(labelOf(o), build(d.id, d.pin));
    } catch (e) {
      expressions.set(labelOf(o), { error: `${labelOf(o)} ${(e as Error).message}.` });
    }
  }
  const allOk = [...expressions.values()].every((e) => !("error" in e));
  const labels = [...inputs, ...outputs].map(labelOf);
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  return {
    inputs,
    outputs,
    expressions,
    combinational: !sequential && allOk,
    ...(dup ? { problem: `Two inputs or outputs are both labelled "${dup}".` } : {}),
  };
}

/** Truth table of a combinational circuit by simulation (agrees with the expressions). */
export function simulateTable(circuit: Circuit): { inputs: string[]; outputs: string[]; rows: Level[][] } {
  const a = analyse(circuit);
  const n = a.inputs.length;
  if (n > 10) throw new Error("Truth tables are limited to 10 inputs.");
  const rows: Level[][] = [];
  for (let r = 0; r < 1 << n; r++) {
    const comps = circuit.components.map((c) => {
      const i = a.inputs.indexOf(c);
      return i === -1 ? c : { ...c, value: ((r >> (n - 1 - i)) & 1) as 0 | 1 };
    });
    const sim = new Simulator({ ...circuit, components: comps });
    sim.settle();
    rows.push(a.outputs.map((o) => sim.input(o, 0)));
  }
  return { inputs: a.inputs.map(labelOf), outputs: a.outputs.map(labelOf), rows };
}

export interface Trace {
  signals: string[];
  /** one row per half clock cycle: values of each signal */
  samples: Level[][];
}

/** Clock the circuit for `cycles` cycles and record every OUTPUT and flip-flop Q. */
export function timing(circuit: Circuit, cycles: number): Trace {
  const sim = new Simulator(circuit);
  sim.settle();
  const clocks = circuit.components.filter((c) => c.type === "CLOCK");
  const probes: { name: string; read: () => Level }[] = [
    ...clocks.map((c) => ({ name: labelOf(c), read: () => sim.output(c.id) })),
    ...circuit.components.filter((c) => c.type === "INPUT").map((c) => ({ name: labelOf(c), read: () => sim.output(c.id) })),
    ...circuit.components.filter((c) => FLIP_FLOPS.has(c.type)).map((c) => ({ name: `${labelOf(c)}.Q`, read: () => sim.output(c.id, 0) })),
    ...circuit.components.filter((c) => c.type === "OUTPUT").map((c) => ({ name: labelOf(c), read: () => sim.input(c, 0) })),
  ];
  const samples: Level[][] = [probes.map((p) => p.read())];
  for (let i = 0; i < cycles; i++) {
    for (const id of sim.clocks.keys()) sim.clocks.set(id, 1);
    sim.settle();
    samples.push(probes.map((p) => p.read()));
    for (const id of sim.clocks.keys()) sim.clocks.set(id, 0);
    sim.settle();
    samples.push(probes.map((p) => p.read()));
  }
  return { signals: probes.map((p) => p.name), samples };
}

let counter = 0;
export function newId(prefix = "c"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}
