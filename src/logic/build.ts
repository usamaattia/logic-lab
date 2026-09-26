/**
 * Circuits generated from expressions, laid out left to right by logic level.
 *
 *  - "as written": one gate per operator in the expression;
 *  - "NAND only" from a minimal sum of products (AND-OR = NAND-NAND);
 *  - "NOR only" from a minimal product of sums (OR-AND = NOR-NOR).
 * Inverters in the NAND/NOR versions are 2-input gates with both inputs tied together,
 * the standard textbook trick.
 */
import type { Expr } from "./expr";
import type { Circuit, CompType, Component, Wire } from "./circuit";
import { literalCount, type Minimised } from "./qm";

const COL = 150;
const ROW = 70;
const X0 = 60;
const Y0 = 60;

interface Node {
  comp: Component;
  level: number;
  sources: Node[]; // one per input pin
}

class Builder {
  nodes: Node[] = [];
  inputs = new Map<string, Node>();
  inverted = new Map<string, Node>();
  private n = 0;

  constructor(private vars: string[]) {
    vars.forEach((v) => this.input(v));
  }

  input(name: string): Node {
    let node = this.inputs.get(name);
    if (!node) {
      node = { comp: { id: `in_${name}`, type: "INPUT", x: 0, y: 0, label: name, value: 0 }, level: 0, sources: [] };
      this.inputs.set(name, node);
      this.nodes.push(node);
    }
    return node;
  }

  gate(type: CompType, sources: Node[]): Node {
    const comp: Component = { id: `g${++this.n}`, type, x: 0, y: 0 };
    if (!["NOT", "BUF"].includes(type)) comp.inputs = sources.length;
    const node = { comp, level: Math.max(...sources.map((s) => s.level)) + 1, sources };
    this.nodes.push(node);
    return node;
  }

  const(v: 0 | 1): Node {
    const node = { comp: { id: `k${++this.n}`, type: (v ? "CONST1" : "CONST0") as CompType, x: 0, y: 0 }, level: 0, sources: [] };
    this.nodes.push(node);
    return node;
  }

  /** NOT of an input, shared so each variable is inverted once */
  not(name: string, style: "NOT" | "NAND" | "NOR"): Node {
    const k = `${style}:${name}`;
    let node = this.inverted.get(k);
    if (!node) {
      const src = this.input(name);
      node = style === "NOT" ? this.gate("NOT", [src]) : this.gate(style, [src, src]);
      this.inverted.set(k, node);
    }
    return node;
  }

  finish(result: Node, outName: string): Circuit {
    const out: Node = {
      comp: { id: "out", type: "OUTPUT", x: 0, y: 0, label: outName },
      level: result.level + 1,
      sources: [result],
    };
    this.nodes.push(out);
    // order inputs A, B, C...; place other nodes by level, in creation order
    const byLevel = new Map<number, Node[]>();
    for (const node of this.nodes) byLevel.set(node.level, [...(byLevel.get(node.level) ?? []), node]);
    byLevel.set(0, [...this.vars.map((v) => this.inputs.get(v)!), ...(byLevel.get(0) ?? []).filter((x) => x.comp.type !== "INPUT")]);
    const tallest = Math.max(...[...byLevel.values()].map((l) => l.length));
    for (const [level, list] of byLevel) {
      const offset = ((tallest - list.length) * ROW) / 2;
      list.forEach((node, i) => {
        node.comp.x = X0 + level * COL;
        node.comp.y = Y0 + offset + i * ROW;
      });
    }
    const wires: Wire[] = [];
    let w = 0;
    for (const node of this.nodes)
      node.sources.forEach((s, pin) => wires.push({ id: `w${++w}`, from: { id: s.comp.id, pin: 0 }, to: { id: node.comp.id, pin } }));
    return { components: this.nodes.map((x) => x.comp), wires };
  }
}

const MAX_FANIN = 8;

/** One gate per operator; wide AND/OR/XOR are split into trees of up to 8 inputs. */
export function circuitFromExpr(e: Expr, vars: string[], outName = "F"): Circuit {
  const b = new Builder(vars);
  const wide = (type: CompType, xs: Node[]): Node => {
    if (xs.length <= MAX_FANIN) return b.gate(type, xs);
    const chunks: Node[] = [];
    for (let i = 0; i < xs.length; i += MAX_FANIN) {
      const part = xs.slice(i, i + MAX_FANIN);
      chunks.push(part.length === 1 ? part[0] : b.gate(type, part));
    }
    return wide(type, chunks);
  };
  const go = (x: Expr): Node => {
    switch (x.t) {
      case "const": return b.const(x.v);
      case "var": return b.input(x.name);
      case "not": return x.a.t === "var" ? b.not(x.a.name, "NOT") : b.gate("NOT", [go(x.a)]);
      case "and": return wide("AND", x.args.map(go));
      case "or": return wide("OR", x.args.map(go));
      case "xor": return wide("XOR", x.args.map(go));
    }
  };
  return b.finish(go(e), outName);
}

/** Two-level NAND-NAND circuit from a minimal SOP. */
export function nandCircuit(m: Minimised, vars: string[], outName = "F"): Circuit {
  if (m.form !== "SOP") throw new Error("NAND-NAND needs a sum of products");
  return twoLevel(m, vars, outName, "NAND");
}

/** Two-level NOR-NOR circuit from a minimal POS. */
export function norCircuit(m: Minimised, vars: string[], outName = "F"): Circuit {
  if (m.form !== "POS") throw new Error("NOR-NOR needs a product of sums");
  return twoLevel(m, vars, outName, "NOR");
}

function twoLevel(m: Minimised, vars: string[], outName: string, g: "NAND" | "NOR"): Circuit {
  const b = new Builder(vars);
  const n = vars.length;
  if (m.terms.length === 0) return b.finish(b.const(g === "NAND" ? 0 : 1), outName);
  // literal of variable i in a term: for SOP (NAND) the term's own polarity; for POS the
  // implicants are of F', so each literal is complemented (De Morgan)
  const literal = (i: number, positive: boolean): Node =>
    positive ? b.input(vars[i]) : b.not(vars[i], g);
  const firstLevel = m.terms.map((t) => {
    const lits: Node[] = [];
    vars.forEach((_, i) => {
      const bit = 1 << (n - 1 - i);
      if (t.mask & bit) return;
      const one = (t.value & bit) !== 0;
      lits.push(literal(i, g === "NAND" ? one : !one));
    });
    if (literalCount(t, n) === 1) {
      // a single-literal term feeds the second level directly, complemented:
      // NAND(x', …) contributes x
      const [only] = lits;
      const name = only.comp.type === "INPUT" ? only.comp.label! : null;
      if (name) return b.not(name, g);
      return only.sources[0]; // the literal was an inverter: use its input
    }
    return b.gate(g, lits);
  });
  const result = firstLevel.length === 1 ? b.gate(g, [firstLevel[0], firstLevel[0]]) : b.gate(g, firstLevel);
  return b.finish(result, outName);
}
