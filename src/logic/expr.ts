/**
 * Boolean expressions: parse, print, evaluate.
 *
 * Accepts the notations students meet in textbooks and on keyboards:
 *   NOT   A'   !A   ~A   ¬A   NOT A   (and a bar can't be typed, so A' is the default)
 *   AND   AB   A·B   A*B   A&B   A.B   A AND B   A∧B
 *   OR    A+B   A|B   A OR B   A∨B
 *   XOR   A^B   A⊕B   A XOR B
 *   constants 0 and 1, parentheses.
 *
 * Juxtaposition means AND, so variable names are one letter optionally followed by digits
 * (A, x, A0, X12). Longer names ("Cin") are recognised when they are passed in `known`.
 * Precedence, lowest first: OR, XOR, AND, NOT.
 */

export type Expr =
  | { t: "const"; v: 0 | 1 }
  | { t: "var"; name: string }
  | { t: "not"; a: Expr }
  | { t: "and"; args: Expr[] }
  | { t: "or"; args: Expr[] }
  | { t: "xor"; args: Expr[] };

export class ParseError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

type Tok =
  | { k: "var"; v: string; pos: number }
  | { k: "const"; v: 0 | 1; pos: number }
  | { k: "not" | "post" | "and" | "or" | "xor" | "(" | ")"; pos: number };

const WORD_OPS: Record<string, Tok["k"]> = { AND: "and", OR: "or", XOR: "xor", NOT: "not" };

function tokenize(src: string, known: string[]): Tok[] {
  const toks: Tok[] = [];
  const names = [...known].sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if ("'’′".includes(c)) { toks.push({ k: "post", pos: i }); i++; continue; }
    if ("!~¬".includes(c)) { toks.push({ k: "not", pos: i }); i++; continue; }
    if ("·*&.∧".includes(c)) { toks.push({ k: "and", pos: i }); i++; continue; }
    if ("+|∨".includes(c)) { toks.push({ k: "or", pos: i }); i++; continue; }
    if ("^⊕".includes(c)) { toks.push({ k: "xor", pos: i }); i++; continue; }
    if (c === "(" || c === ")") { toks.push({ k: c, pos: i }); i++; continue; }
    if (c === "0" || c === "1") { toks.push({ k: "const", v: c === "1" ? 1 : 0, pos: i }); i++; continue; }
    const word = src.slice(i).match(/^(AND|OR|XOR|NOT)(?![A-Za-z0-9_])/);
    if (word) { toks.push({ k: WORD_OPS[word[1]], pos: i } as Tok); i += word[1].length; continue; }
    const kn = names.find((n) => src.startsWith(n, i) && !/[0-9]/.test(src[i + n.length] ?? ""));
    if (kn) { toks.push({ k: "var", v: kn, pos: i }); i += kn.length; continue; }
    const m = src.slice(i).match(/^[A-Za-z][0-9]*/);
    if (m) { toks.push({ k: "var", v: m[0], pos: i }); i += m[0].length; continue; }
    throw new ParseError(`Unexpected "${c}" at position ${i + 1}.`, i);
  }
  return toks;
}

export function parse(src: string, known: string[] = []): Expr {
  const toks = tokenize(src, known);
  if (toks.length === 0) throw new ParseError("The expression is empty.", 0);
  let p = 0;
  const peek = () => toks[p];
  const flat = (t: "and" | "or" | "xor", args: Expr[]): Expr =>
    args.length === 1 ? args[0] : { t, args: args.flatMap((a) => (a.t === t ? a.args : [a])) };

  const parseOr = (): Expr => {
    const args = [parseXor()];
    while (peek()?.k === "or") { p++; args.push(parseXor()); }
    return flat("or", args);
  };
  const parseXor = (): Expr => {
    const args = [parseAnd()];
    while (peek()?.k === "xor") { p++; args.push(parseAnd()); }
    return flat("xor", args);
  };
  const startsFactor = (t?: Tok) => !!t && (t.k === "var" || t.k === "const" || t.k === "(" || t.k === "not");
  const parseAnd = (): Expr => {
    const args = [parseUnary()];
    for (;;) {
      if (peek()?.k === "and") { p++; args.push(parseUnary()); }
      else if (startsFactor(peek())) args.push(parseUnary()); // juxtaposition
      else break;
    }
    return flat("and", args);
  };
  const parseUnary = (): Expr => {
    if (peek()?.k === "not") { p++; return { t: "not", a: parseUnary() }; }
    let e = parsePrimary();
    while (peek()?.k === "post") { p++; e = { t: "not", a: e }; }
    return e;
  };
  const parsePrimary = (): Expr => {
    const t = peek();
    if (!t) throw new ParseError("The expression ends too early.", src.length);
    if (t.k === "var") { p++; return { t: "var", name: t.v }; }
    if (t.k === "const") { p++; return { t: "const", v: t.v }; }
    if (t.k === "(") {
      p++;
      const e = parseOr();
      if (peek()?.k !== ")") throw new ParseError(`Missing ")" for the "(" at position ${t.pos + 1}.`, t.pos);
      p++;
      return e;
    }
    throw new ParseError(`Expected a variable, 0, 1 or "(" at position ${t.pos + 1}.`, t.pos);
  };

  const e = parseOr();
  if (p < toks.length) {
    const t = toks[p];
    throw new ParseError(t.k === ")" ? `Unmatched ")" at position ${t.pos + 1}.` : `Unexpected symbol at position ${t.pos + 1}.`, t.pos);
  }
  return e;
}

/** Variables in order of first appearance, then sorted A–Z (the conventional truth-table order). */
export function variables(e: Expr): string[] {
  const out = new Set<string>();
  const walk = (x: Expr) => {
    if (x.t === "var") out.add(x.name);
    else if (x.t === "not") walk(x.a);
    else if (x.t !== "const") x.args.forEach(walk);
  };
  walk(e);
  return [...out].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export function evaluate(e: Expr, env: Record<string, 0 | 1>): 0 | 1 {
  switch (e.t) {
    case "const": return e.v;
    case "var": {
      const v = env[e.name];
      if (v === undefined) throw new Error(`No value for ${e.name}`);
      return v;
    }
    case "not": return evaluate(e.a, env) ? 0 : 1;
    case "and": return e.args.every((a) => evaluate(a, env)) ? 1 : 0;
    case "or": return e.args.some((a) => evaluate(a, env)) ? 1 : 0;
    case "xor": return (e.args.reduce((s, a) => s ^ evaluate(a, env), 0) & 1) as 0 | 1;
  }
}

/** Print with minimal parentheses. Juxtaposition for AND when every name is short. */
export function print(e: Expr): string {
  const short = variables(e).every((v) => /^[A-Za-z][0-9]*$/.test(v));
  const prec = (x: Expr) => ({ or: 1, xor: 2, and: 3, not: 4, var: 5, const: 5 })[x.t];
  const wrap = (x: Expr, min: number) => (prec(x) < min ? `(${go(x)})` : go(x));
  const go = (x: Expr): string => {
    switch (x.t) {
      case "const": return String(x.v);
      case "var": return x.name;
      case "not": return x.a.t === "var" || x.a.t === "const" || x.a.t === "not" ? `${go(x.a)}'` : `(${go(x.a)})'`;
      case "and": {
        // "A1" would read back as a variable called A1, so a factor starting with a digit
        // gets an explicit dot
        const parts = x.args.map((a) => wrap(a, 4));
        const juxtapose = short && !parts.slice(1).some((s) => /^[0-9]/.test(s));
        return parts.join(juxtapose ? "" : "·");
      }
      case "or": return x.args.map((a) => wrap(a, 2)).join(" + ");
      case "xor": return x.args.map((a) => wrap(a, 3)).join(" ⊕ ");
    }
  };
  return go(e);
}

export const V = (name: string): Expr => ({ t: "var", name });
export const NOT = (a: Expr): Expr => ({ t: "not", a });
export const AND = (...args: Expr[]): Expr => (args.length === 1 ? args[0] : { t: "and", args });
export const OR = (...args: Expr[]): Expr => (args.length === 1 ? args[0] : { t: "or", args });
