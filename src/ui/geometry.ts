import { inputNames, outputNames, type Component } from "../logic/circuit";

export interface Geom {
  w: number;
  h: number;
  ins: { x: number; y: number; name: string }[];
  outs: { x: number; y: number; name: string }[];
}

const PIN = 12; // pin stub length

export function geom(c: Component): Geom {
  const ins = inputNames(c);
  const outs = outputNames(c);
  let w = 60;
  let h = 40;
  switch (c.type) {
    case "INPUT": w = 46; h = 30; break;
    case "CLOCK": w = 46; h = 30; break;
    case "CONST0": case "CONST1": w = 30; h = 26; break;
    case "OUTPUT": w = 30; h = 30; break;
    case "NOT": case "BUF": w = 50; h = 30; break;
    case "DFF": case "TFF": w = 70; h = 80; break;
    case "JKFF": w = 70; h = 90; break;
    case "SEG7": w = 64; h = 100; break;
    default: h = Math.max(40, ins.length * 16 + 8);
  }
  const spread = (n: number, top = 0, bottom = h) =>
    Array.from({ length: n }, (_, i) => top + ((bottom - top) * (i + 1)) / (n + 1));
  let inY = spread(ins.length);
  let outY = spread(outs.length);
  if (c.type === "DFF" || c.type === "TFF") { inY = [20, 60]; outY = [20, 60]; }
  if (c.type === "JKFF") { inY = [20, 45, 70]; outY = [20, 70]; }
  if (c.type === "SEG7") inY = [20, 40, 60, 80];
  return {
    w,
    h,
    ins: ins.map((name, i) => ({ x: -PIN, y: inY[i], name })),
    outs: outs.map((name, i) => ({ x: w + PIN, y: outY[i], name })),
  };
}

export function pinPos(c: Component, kind: "in" | "out", pin: number): { x: number; y: number } {
  const g = geom(c);
  const p = (kind === "in" ? g.ins : g.outs)[pin];
  return { x: c.x + p.x, y: c.y + p.y };
}

/** Distinctive-shape gate bodies (IEEE/ANSI), drawn in a w × h box. */
export function gatePath(type: string, w: number, h: number): string {
  const bodyW = w - (["NAND", "NOR", "XNOR", "NOT"].includes(type) ? 8 : 0);
  switch (type) {
    case "AND": case "NAND":
      return `M0,0 H${bodyW / 2} A${bodyW / 2},${h / 2} 0 0 1 ${bodyW / 2},${h} H0 Z`;
    case "OR": case "NOR": case "XOR": case "XNOR": {
      const x0 = type.startsWith("X") ? 6 : 0;
      return `M${x0},0 Q${x0 + bodyW * 0.55},0 ${bodyW},${h / 2} Q${x0 + bodyW * 0.55},${h} ${x0},${h} Q${x0 + bodyW * 0.28},${h / 2} ${x0},0 Z`;
    }
    case "NOT": case "BUF":
      return `M0,0 L${bodyW},${h / 2} L0,${h} Z`;
    default:
      return `M0,0 H${w} V${h} H0 Z`;
  }
}

export const INVERTING = new Set(["NAND", "NOR", "XNOR", "NOT"]);

/** Seven-segment patterns for 0–15 (hex): segments a..g. */
export const SEG_PATTERNS = [
  "abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc",
  "abcdefg", "abcdfg", "abcefg", "cdefg", "adef", "bcdeg", "adefg", "aefg",
];
