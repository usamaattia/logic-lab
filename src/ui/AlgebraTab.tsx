import { useMemo, useState } from "react";
import { circuitFromExpr, nandCircuit, norCircuit } from "../logic/build";
import type { Circuit } from "../logic/circuit";
import { parse, print, variables, type Expr } from "../logic/expr";
import { bits, groupRects, kmapLayout } from "../logic/kmap";
import { literalCount, minimisePOS, minimiseSOP, termExpr, twoLevelCost, type Implicant, type Minimised } from "../logic/qm";
import { canonicalSOP, pi, rowValues, sigma, tableOf, type Out, type TruthTable } from "../logic/truth";

export interface AlgebraState {
  text: string;
  /** set when the table has been edited by hand (then it, not the text, is the function) */
  table: TruthTable | null;
}

export const ALGEBRA_DEFAULT: AlgebraState = { text: "A'B'C' + A'BC' + AB'C' + AB'C + ABC'", table: null };

const MAX_TABLE_VARS = 6;

export function AlgebraTab({
  state,
  setState,
  openCircuit,
}: {
  state: AlgebraState;
  setState: (s: AlgebraState) => void;
  openCircuit: (c: Circuit) => void;
}) {
  const [grouping, setGrouping] = useState<"SOP" | "POS">("SOP");
  const [nVarsNew, setNVarsNew] = useState(3);

  const parsed = useMemo(() => {
    if (state.table) return { table: state.table, expr: null as Expr | null, error: null as string | null };
    try {
      const expr = parse(state.text);
      const vars = variables(expr);
      if (vars.length > MAX_TABLE_VARS) return { table: null, expr, error: `Up to ${MAX_TABLE_VARS} variables here (this has ${vars.length}).` };
      if (vars.length === 0) return { table: null, expr, error: "Use at least one variable." };
      return { table: tableOf(expr, vars), expr, error: null };
    } catch (e) {
      return { table: null, expr: null, error: (e as Error).message };
    }
  }, [state]);

  const t = parsed.table;
  const sop = useMemo(() => (t ? minimiseSOP(t) : null), [t]);
  const pos = useMemo(() => (t ? minimisePOS(t) : null), [t]);

  const cycle = (r: number) => {
    if (!t) return;
    const next: Out = t.out[r] === 0 ? 1 : t.out[r] === 1 ? "X" : 0;
    setState({ ...state, table: { vars: t.vars, out: t.out.map((v, i) => (i === r ? next : v)) } });
  };

  return (
    <div className="algebra">
      <section className="card">
        <label className="field wide-field">
          F =
          <input
            type="text"
            value={state.table ? "" : state.text}
            placeholder={state.table ? "(defined by the truth table below)" : "e.g. A'B + AB'  or  (A + B)(A' + C)"}
            onChange={(e) => setState({ text: e.target.value, table: null })}
            aria-label="Boolean expression"
            spellCheck={false}
          />
        </label>
        <p className="muted small">
          NOT: A' or !A · AND: AB, A·B or A&amp;B · OR: A + B · XOR: A ⊕ B or A^B · constants 0, 1. Variables are single
          letters, optionally with digits (A0, x1).
        </p>
        <div className="row">
          <span className="muted small">Or start from an empty truth table with</span>
          <select value={nVarsNew} onChange={(e) => setNVarsNew(Number(e.target.value))} aria-label="Number of variables">
            {[2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k} variables</option>)}
          </select>
          <button onClick={() => setState({ ...state, table: { vars: "ABCDEF".split("").slice(0, nVarsNew), out: Array(1 << nVarsNew).fill(0) } })}>
            New table
          </button>
        </div>
        {parsed.error && <div className="error" role="alert">{parsed.error}</div>}
      </section>

      {t && sop && pos && (
        <>
          <div className="algebra-grid">
            <section className="card">
              <h2>Truth table</h2>
              <p className="muted small">Click an output to change it: 0 → 1 → X (don't care).</p>
              <div className="scroll table-scroll">
                <table className="truth" aria-label="Truth table">
                  <thead>
                    <tr>
                      <th className="muted">m</th>
                      {t.vars.map((v) => <th key={v}>{v}</th>)}
                      <th className="out-col">F</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.out.map((v, r) => (
                      <tr key={r}>
                        <td className="muted">{r}</td>
                        {rowValues(r, t.vars.length).map((b, i) => <td key={i}>{b}</td>)}
                        <td className="out-col">
                          <button className={`cell-btn v${v}`} onClick={() => cycle(r)} aria-label={`Row ${r}: ${v}. Change`}>{v}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <h2>Forms</h2>
              <dl className="forms">
                <dt>Minterms</dt><dd><code>F = {sigma(t)}</code></dd>
                <dt>Maxterms</dt><dd><code>F = {pi(t)}</code></dd>
                {t.vars.length <= 4 && sop.terms.length > 0 && (
                  <><dt>Canonical SOP</dt><dd><code>{print(canonicalSOP(t))}</code></dd></>
                )}
                <dt>Minimal SOP</dt><dd><code className="big">F = {print(sop.expr)}</code> <span className="muted small">{sop.literals} literals</span></dd>
                <dt>Minimal POS</dt><dd><code className="big">F = {print(pos.expr)}</code> <span className="muted small">{pos.literals} literals</span></dd>
              </dl>
              <CostTable t={t} sop={sop} pos={pos} />
              <h3>Build it</h3>
              <div className="row">
                {parsed.expr && <button onClick={() => openCircuit(circuitFromExpr(parsed.expr!, t.vars))}>As written</button>}
                <button onClick={() => openCircuit(circuitFromExpr(sop.expr, t.vars))}>Minimal AND-OR</button>
                <button onClick={() => openCircuit(nandCircuit(sop, t.vars))}>NAND only</button>
                <button onClick={() => openCircuit(norCircuit(pos, t.vars))}>NOR only</button>
              </div>
            </section>
          </div>

          {t.vars.length >= 2 && t.vars.length <= 4 && (
            <section className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>Karnaugh map</h2>
                <div className="seg-toggle" role="radiogroup" aria-label="Group">
                  <button role="radio" aria-checked={grouping === "SOP"} onClick={() => setGrouping("SOP")}>Group the 1s (SOP)</button>
                  <button role="radio" aria-checked={grouping === "POS"} onClick={() => setGrouping("POS")}>Group the 0s (POS)</button>
                </div>
              </div>
              <KMap t={t} m={grouping === "SOP" ? sop : pos} onCell={cycle} />
            </section>
          )}
          {t.vars.length > 4 && (
            <section className="card">
              <h2>Prime implicants</h2>
              <PrimeList t={t} m={sop} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CostTable({ t, sop, pos }: { t: TruthTable; sop: Minimised; pos: Minimised }) {
  const n = t.vars.length;
  const ones = t.out.filter((v) => v === 1).length;
  const canon = { gates: (ones > 1 ? 1 : 0) + ones, gateInputs: ones * n + (ones > 1 ? ones : 0) };
  const rows = [
    { name: "Canonical SOP", ...canon },
    { name: "Minimal SOP", ...twoLevelCost(sop, n) },
    { name: "Minimal POS", ...twoLevelCost(pos, n) },
  ];
  return (
    <table className="cost" aria-label="Two-level cost">
      <thead>
        <tr><th>Two-level circuit</th><th className="num">Gates</th><th className="num">Gate inputs</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.gates}</td><td className="num">{r.gateInputs}</td></tr>)}
      </tbody>
      <caption className="muted small">Inverters on the inputs are not counted, as in most textbooks.</caption>
    </table>
  );
}

function PrimeList({ t, m }: { t: TruthTable; m: Minimised }) {
  const chosen = new Set(m.terms);
  const essential = new Set(m.essential.map((e) => `${e.value}/${e.mask}`));
  return (
    <table aria-label="Prime implicants">
      <thead><tr><th>Term</th><th>Covers</th><th></th></tr></thead>
      <tbody>
        {m.primes.map((p) => (
          <tr key={`${p.value}/${p.mask}`} style={{ opacity: chosen.has(p) ? 1 : 0.55 }}>
            <td><code>{print(termExpr(p, t.vars, m.form === "POS"))}</code></td>
            <td className="small">{p.covers.filter((r) => t.out[r] !== "X").join(", ")}</td>
            <td className="small">{essential.has(`${p.value}/${p.mask}`) ? "essential" : chosen.has(p) ? "chosen" : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KMap({ t, m, onCell }: { t: TruthTable; m: Minimised; onCell: (r: number) => void }) {
  const k = kmapLayout(t.vars);
  const cell = 56;
  const left = 64;
  const top = 50;
  const W = left + k.colCodes.length * cell + 12;
  const H = top + k.rowCodes.length * cell + 12;
  const nr = k.rowVars.length;
  const nc = k.colVars.length;
  const inset = (i: number) => 5 + (i % 4) * 4;
  const target = m.form === "SOP" ? 1 : 0;

  return (
    <div className="kmap-wrap">
      <div className="scroll">
        <svg width={W} height={H} role="img" aria-label="Karnaugh map" className="kmap">
          <defs>
            <clipPath id="kmap-clip">
              <rect x={left} y={top} width={k.colCodes.length * cell} height={k.rowCodes.length * cell} />
            </clipPath>
          </defs>
          <text x={left - 8} y={top - 28} textAnchor="end" className="axis">{k.rowVars.join("")}</text>
          <text x={left + 4} y={top - 28} className="axis">{k.colVars.join("")}</text>
          <line x1={left - 40} y1={top - 40} x2={left} y2={top} className="grid-line" />
          {k.colCodes.map((code, c) => (
            <text key={c} x={left + c * cell + cell / 2} y={top - 8} textAnchor="middle" className="code">{bits(code, nc)}</text>
          ))}
          {k.rowCodes.map((code, r) => (
            <text key={r} x={left - 8} y={top + r * cell + cell / 2 + 4} textAnchor="end" className="code">{bits(code, nr)}</text>
          ))}
          {k.rowCodes.map((_, r) =>
            k.colCodes.map((__, c) => {
              const mt = k.cell(r, c);
              const v = t.out[mt];
              return (
                <g key={`${r}-${c}`} onClick={() => onCell(mt)} className="kcell" role="button" aria-label={`m${mt} = ${v}`}>
                  <rect x={left + c * cell} y={top + r * cell} width={cell} height={cell} className={`kbox ${v === target ? "target" : ""}`} />
                  <text x={left + c * cell + cell / 2} y={top + r * cell + cell / 2 + 6} textAnchor="middle" className={`kval v${v}`}>{v}</text>
                  <text x={left + c * cell + 4} y={top + r * cell + 12} className="kidx">{mt}</text>
                </g>
              );
            }),
          )}
          {m.terms.map((imp, i) =>
            groupRects(imp, k).map((g, j) => {
              const pad = inset(i);
              // open sides run past the map edge and are clipped, so the group reads as
              // continuing on the opposite edge
              const x0 = left + g.c0 * cell + (g.open.left ? -20 : pad);
              const x1 = left + (g.c1 + 1) * cell - (g.open.right ? -20 : pad);
              const y0 = top + g.r0 * cell + (g.open.top ? -20 : pad);
              const y1 = top + (g.r1 + 1) * cell - (g.open.bottom ? -20 : pad);
              return (
                <rect
                  key={`${i}-${j}`}
                  x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={12}
                  className="group"
                  style={{ stroke: `var(--s${(i % 8) + 1})` }}
                  clipPath="url(#kmap-clip)"
                  pointerEvents="none"
                />
              );
            }),
          )}
        </svg>
      </div>
      <ul className="group-list">
        {m.terms.map((imp: Implicant, i) => (
          <li key={i}>
            <span className="swatch" style={{ borderColor: `var(--s${(i % 8) + 1})` }} />
            <code>{print(termExpr(imp, t.vars, m.form === "POS"))}</code>
            <span className="muted small">
              {" "}covers {imp.covers.filter((r) => t.out[r] === target).map((r) => `${m.form === "SOP" ? "m" : "M"}${r}`).join(", ")}
              {m.essential.includes(imp) ? " · essential" : ""} · {literalCount(imp, t.vars.length)} literal{literalCount(imp, t.vars.length) === 1 ? "" : "s"}
            </span>
          </li>
        ))}
        {!m.terms.length && <li className="muted">F is constant: no groups.</li>}
      </ul>
      <p className="muted small">
        Groups are rectangles of 1, 2, 4 or 8 cells and may wrap around the edges. Click a cell to change it. X cells (don't
        cares) are used only when they make a group bigger.
      </p>
    </div>
  );
}
