import { useEffect, useMemo, useRef, useState } from "react";
import { analyse, labelOf, MULTI_INPUT, newId, Simulator, timing, type Circuit, type CompType, type Component, type Level, type SettleResult } from "../logic/circuit";
import { parse, print, type Expr } from "../logic/expr";
import { EXAMPLES } from "../logic/library";
import { minimiseSOP } from "../logic/qm";
import { firstDifference, rowValues, tableOf } from "../logic/truth";
import { Editor, type Selection, type View } from "./Editor";
import { geom } from "./geometry";
import type { useHistory } from "./history";

const PALETTE: { type: CompType; label: string; group: string }[] = [
  { type: "INPUT", label: "Switch", group: "In / out" },
  { type: "CLOCK", label: "Clock", group: "In / out" },
  { type: "CONST0", label: "0", group: "In / out" },
  { type: "CONST1", label: "1", group: "In / out" },
  { type: "OUTPUT", label: "Light", group: "In / out" },
  { type: "SEG7", label: "7-segment", group: "In / out" },
  { type: "AND", label: "AND", group: "Gates" },
  { type: "OR", label: "OR", group: "Gates" },
  { type: "NOT", label: "NOT", group: "Gates" },
  { type: "NAND", label: "NAND", group: "Gates" },
  { type: "NOR", label: "NOR", group: "Gates" },
  { type: "XOR", label: "XOR", group: "Gates" },
  { type: "XNOR", label: "XNOR", group: "Gates" },
  { type: "BUF", label: "Buffer", group: "Gates" },
  { type: "DFF", label: "D flip-flop", group: "Memory" },
  { type: "JKFF", label: "JK flip-flop", group: "Memory" },
  { type: "TFF", label: "T flip-flop", group: "Memory" },
];

function nextLabel(c: Circuit, type: CompType): string | undefined {
  const used = new Set(c.components.map((k) => k.label));
  const pick = (cands: string[]) => cands.find((x) => !used.has(x));
  if (type === "INPUT") return pick("ABCDEFGHIJKLMNPQRSTUVWXYZ".split("")) ?? `I${c.components.length}`;
  if (type === "OUTPUT") return pick(["F", "G", "H", "Y", "Z", "W", "P", "Q", "R", "S"]) ?? `O${c.components.length}`;
  if (type === "CLOCK") return pick(["CLK", "CLK2", "CLK3"]);
  if (["DFF", "JKFF", "TFF"].includes(type)) return pick(Array.from({ length: 16 }, (_, i) => `FF${i}`));
  return undefined;
}

export function CircuitTab({
  history,
  embed,
  openInAlgebra,
}: {
  history: ReturnType<typeof useHistory<Circuit>>;
  embed: boolean;
  openInAlgebra: (expr: Expr, vars: string[]) => void;
}) {
  const circuit = history.value;
  const sim = useMemo(() => new Simulator(circuit), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [simVersion, setSimVersion] = useState(0);
  const [settle, setSettle] = useState<SettleResult>({ stable: true, iterations: 0, oscillating: [] });
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [running, setRunning] = useState(false);
  const [ticks, setTicks] = useState(0);
  const [panel, setPanel] = useState<"table" | "timing" | "check">("table");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fitPending, setFitPending] = useState(false);

  // re-simulate whenever the circuit changes
  useEffect(() => {
    sim.setCircuit(circuit);
    setSettle(sim.settle());
    setSimVersion((v) => v + 1);
  }, [circuit, sim]);

  const hasClock = circuit.components.some((c) => c.type === "CLOCK");
  const tick = () => {
    setSettle(sim.tick());
    setTicks((t) => t + 1);
    setSimVersion((v) => v + 1);
  };
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(tick, 600);
    return () => window.clearInterval(id);
  }); // re-armed each render so tick sees the current simulator

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    sim.reset();
    setTicks(0);
    setRunning(false);
    history.set(ex.circuit(), true);
    setSelection(null);
    setFitPending(true);
  };

  const add = (type: CompType) => {
    const n = circuit.components.length;
    const c: Component = {
      id: newId(),
      type,
      x: Math.round((view.x + 120 + (n % 6) * 30) / 10) * 10,
      y: Math.round((view.y + 60 + (n % 6) * 30) / 10) * 10,
    };
    const label = nextLabel(circuit, type);
    if (label) c.label = label;
    if (MULTI_INPUT.has(type)) c.inputs = 2;
    if (type === "INPUT") c.value = 0;
    history.set({ ...circuit, components: [...circuit.components, c] }, true);
    setSelection({ kind: "comp", id: c.id });
  };

  const removeSelection = () => {
    if (!selection) return;
    if (selection.kind === "wire") history.set({ ...circuit, wires: circuit.wires.filter((w) => w.id !== selection.id) }, true);
    else
      history.set({
        components: circuit.components.filter((c) => c.id !== selection.id),
        wires: circuit.wires.filter((w) => w.from.id !== selection.id && w.to.id !== selection.id),
      }, true);
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selection) { e.preventDefault(); removeSelection(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? history.redo : history.undo)(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); history.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selected = selection?.kind === "comp" ? circuit.components.find((c) => c.id === selection.id) : undefined;
  const update = (patch: Partial<Component>) =>
    selected && history.set({ ...circuit, components: circuit.components.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)) }, true);
  const setInputs = (k: number) => {
    if (!selected) return;
    history.set({
      components: circuit.components.map((c) => (c.id === selected.id ? { ...c, inputs: k } : c)),
      wires: circuit.wires.filter((w) => !(w.to.id === selected.id && w.to.pin >= k)),
    }, true);
  };

  const fit = () => {
    if (!circuit.components.length) return setView({ x: 0, y: 0, scale: 1 });
    const xs = circuit.components.flatMap((c) => [c.x - 40, c.x + geom(c).w + 60]);
    const ys = circuit.components.flatMap((c) => [c.y - 30, c.y + geom(c).h + 30]);
    const box = document.querySelector(".editor")?.getBoundingClientRect();
    const w = box?.width || 900;
    const h = box?.height || 520;
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const scale = Math.min(1.6, Math.max(0.3, Math.min(w / bw, h / bh)));
    setView({ scale, x: Math.min(...xs) - (w / scale - bw) / 2, y: Math.min(...ys) - (h / scale - bh) / 2 });
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    // after the first layout, so the canvas has its real size
    const id = window.requestAnimationFrame(() => fitRef.current());
    return () => window.cancelAnimationFrame(id);
  }, []);
  // fit once the newly loaded circuit has rendered
  useEffect(() => {
    if (!fitPending) return;
    fitRef.current();
    setFitPending(false);
  }, [fitPending, circuit]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(circuit, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "circuit.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => {
    try {
      const c = JSON.parse(await f.text()) as Circuit;
      if (!Array.isArray(c.components) || !Array.isArray(c.wires)) throw new Error();
      sim.reset();
      history.set(c, true);
      setFitPending(true);
    } catch {
      alertLine("That file is not a circuit saved from Logic Lab.");
    }
  };
  const [notice, setNotice] = useState<string | null>(null);
  const alertLine = (s: string) => { setNotice(s); window.setTimeout(() => setNotice(null), 4000); };

  const oscNames = settle.oscillating
    .map((k) => circuit.components.find((c) => c.id === k.split(":")[0]))
    .filter(Boolean)
    .map((c) => (c!.label ? labelOf(c!) : c!.type));

  return (
    <div className="circuit-layout">
      <aside className="palette" aria-label="Parts">
        {["In / out", "Gates", "Memory"].map((g) => (
          <div key={g}>
            <h3>{g}</h3>
            <div className="palette-grid">
              {PALETTE.filter((p) => p.group === g).map((p) => (
                <button key={p.type} onClick={() => add(p.type)} title={`Add ${p.label}`}>{p.label}</button>
              ))}
            </div>
          </div>
        ))}
        <p className="muted small">
          Drag parts to move them. Drag from a pin to another pin to wire them (or tap one pin, then the other).
          Click a switch to flip it. Delete removes the selection.
        </p>
      </aside>

      <section className="canvas-wrap">
        <div className="toolbar">
          <select aria-label="Load an example" value="" onChange={(e) => loadExample(e.target.value)}>
            <option value="">Examples…</option>
            {EXAMPLES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button onClick={() => setView({ ...view, scale: Math.min(2.5, view.scale * 1.2) })} aria-label="Zoom in">+</button>
          <button onClick={() => setView({ ...view, scale: Math.max(0.3, view.scale / 1.2) })} aria-label="Zoom out">−</button>
          <button onClick={fit}>Fit</button>
          {hasClock && (
            <>
              <span className="sep" />
              <button className="primary" onClick={tick}>Tick</button>
              <button onClick={() => setRunning(!running)}>{running ? "Stop" : "Run"}</button>
              <button onClick={() => { sim.reset(); setSettle(sim.settle()); setTicks(0); setSimVersion((v) => v + 1); }}>Reset</button>
              <span className="muted small" aria-live="polite">{ticks} clock cycles</span>
            </>
          )}
          <span className="sep" />
          <button onClick={() => { if (circuit.components.length) { history.set({ components: [], wires: [] }, true); setSelection(null); sim.reset(); } }}>Clear</button>
          {!embed && <button onClick={exportJson}>Save file</button>}
          <button onClick={() => fileRef.current?.click()}>Open file</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
        <div className="canvas">
          <Editor
            circuit={circuit}
            sim={sim}
            simVersion={simVersion}
            onChange={(c, commit) => history.set(c, commit)}
            selection={selection}
            onSelect={setSelection}
            view={view}
            onView={setView}
          />
          {!circuit.components.length && (
            <div className="empty-hint">Add parts from the left, or open an example.</div>
          )}
        </div>
        <div className="statusbar" role="status">
          {settle.stable ? (
            <span className="ok-text">Settled.</span>
          ) : (
            <span className="bad-text">
              Does not settle: {oscNames.length ? [...new Set(oscNames)].join(", ") : "part of the circuit"} keeps changing. A feedback loop is
              racing or oscillating.
            </span>
          )}
          <span className="legend">
            <i className="hi" /> 1 <i className="lo" /> 0 <i className="x" /> X unknown (unconnected, or a loop not yet set)
          </span>
          {notice && <span className="bad-text">{notice}</span>}
        </div>
        {selected && (
          <div className="props" aria-label="Selected part">
            <strong>{selected.type === "INPUT" ? "Switch" : selected.type === "OUTPUT" ? "Light" : selected.type}</strong>
            {["INPUT", "OUTPUT", "CLOCK", "DFF", "JKFF", "TFF"].includes(selected.type) && (
              <label>
                Label{" "}
                <input type="text" value={selected.label ?? ""} onChange={(e) => update({ label: e.target.value.slice(0, 12) })} style={{ width: 80 }} aria-label="Label" />
              </label>
            )}
            {MULTI_INPUT.has(selected.type) && (
              <label>
                Inputs{" "}
                <select value={selected.inputs ?? 2} onChange={(e) => setInputs(Number(e.target.value))} aria-label="Number of inputs">
                  {[2, 3, 4, 5, 6, 7, 8].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
            )}
            <button onClick={removeSelection}>Delete</button>
          </div>
        )}
        {selection?.kind === "wire" && (
          <div className="props"><strong>Wire</strong><button onClick={removeSelection}>Delete</button></div>
        )}
      </section>

      <aside className="side">
        <div className="side-tabs" role="tablist">
          {(["table", "check", "timing"] as const).map((p) => (
            <button key={p} role="tab" aria-selected={panel === p} onClick={() => setPanel(p)}>
              {{ table: "Truth table", check: "Check", timing: "Timing" }[p]}
            </button>
          ))}
        </div>
        {panel === "table" && <TablePanel circuit={circuit} openInAlgebra={openInAlgebra} />}
        {panel === "check" && <CheckPanel circuit={circuit} />}
        {panel === "timing" && <TimingPanel circuit={circuit} />}
      </aside>
    </div>
  );
}

function TablePanel({ circuit, openInAlgebra }: { circuit: Circuit; openInAlgebra: (e: Expr, vars: string[]) => void }) {
  const a = useMemo(() => analyse(circuit), [circuit]);
  if (!a.outputs.length) return <p className="muted">Add a light (output) to see the truth table.</p>;
  if (a.problem) return <p className="bad-text">{a.problem}</p>;
  const vars = a.inputs.map(labelOf);
  const current = a.inputs.reduce((r, c) => r * 2 + (c.value ?? 0), 0);
  const errors = [...a.expressions.values()].filter((e): e is { error: string } => "error" in e);
  if (errors.length)
    return (
      <div>
        {errors.map((e) => <p key={e.error} className="muted">{e.error}</p>)}
        <p className="muted small">A truth table needs every output to depend only on the switches through gates.</p>
      </div>
    );
  if (vars.length > 8) return <p className="muted">Truth tables are shown for up to 8 switches.</p>;
  const tables = a.outputs.map((o) => tableOf(a.expressions.get(labelOf(o)) as Expr, vars));
  return (
    <div>
      {a.outputs.map((o) => {
        const e = a.expressions.get(labelOf(o)) as Expr;
        const min = vars.length ? minimiseSOP(tableOf(e, vars)).expr : e;
        return (
          <div key={o.id} className="expr-block">
            <div><strong>{labelOf(o)}</strong> = <code>{print(e)}</code></div>
            {vars.length > 0 && print(min) !== print(e) && <div className="muted small">minimal SOP: <code>{print(min)}</code></div>}
            {vars.length > 0 && vars.length <= 6 && (
              <button className="link" onClick={() => openInAlgebra(e, vars)}>Open {labelOf(o)} in Boolean algebra</button>
            )}
          </div>
        );
      })}
      <div className="scroll table-scroll">
        <table className="truth" aria-label="Truth table">
          <thead>
            <tr>
              {vars.map((v) => <th key={v}>{v}</th>)}
              {a.outputs.map((o) => <th key={o.id} className="out-col">{labelOf(o)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 1 << vars.length }, (_, r) => (
              <tr key={r} className={r === current ? "current" : ""}>
                {rowValues(r, vars.length).map((b, i) => <td key={i}>{b}</td>)}
                {tables.map((t, j) => <td key={j} className="out-col">{t.out[r]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">The highlighted row is the switches' current setting.</p>
    </div>
  );
}

function CheckPanel({ circuit }: { circuit: Circuit }) {
  const a = useMemo(() => analyse(circuit), [circuit]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const vars = a.inputs.map(labelOf);
  if (!a.outputs.length) return <p className="muted">Add a light (output) first.</p>;
  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Type what each output should be. The circuit is checked against every input combination.
      </p>
      {a.outputs.map((o) => {
        const name = labelOf(o);
        const text = targets[name] ?? "";
        let result: { ok: boolean; msg: string } | null = null;
        const got = a.expressions.get(name)!;
        if (text.trim()) {
          try {
            const target = parse(text, vars);
            const extra = [...new Set(varsOf(target))].filter((v) => !vars.includes(v));
            if (extra.length) result = { ok: false, msg: `The circuit has no switch called ${extra.join(", ")}.` };
            else if ("error" in got) result = { ok: false, msg: got.error };
            else {
              const diff = firstDifference(tableOf(got, vars), tableOf(target, vars));
              result = diff === null
                ? { ok: true, msg: `${name} matches on all ${1 << vars.length} input combinations.` }
                : {
                    ok: false,
                    msg: `Different when ${rowValues(diff, vars.length).map((b, i) => `${vars[i]} = ${b}`).join(", ")}: the circuit gives ${tableOf(got, vars).out[diff]}, it should be ${tableOf(target, vars).out[diff]}.`,
                  };
            }
          } catch (e) {
            result = { ok: false, msg: (e as Error).message };
          }
        }
        return (
          <div key={o.id} className="check-row">
            <label>
              <strong>{name}</strong> should be{" "}
              <input type="text" value={text} placeholder="e.g. A'B + AB'" onChange={(e) => setTargets({ ...targets, [name]: e.target.value })} aria-label={`Expected ${name}`} />
            </label>
            {result && <div className={result.ok ? "ok" : "error"}>{result.msg}</div>}
          </div>
        );
      })}
    </div>
  );
}

function varsOf(e: Expr): string[] {
  if (e.t === "var") return [e.name];
  if (e.t === "const") return [];
  if (e.t === "not") return varsOf(e.a);
  return e.args.flatMap(varsOf);
}

function TimingPanel({ circuit }: { circuit: Circuit }) {
  const [cycles, setCycles] = useState(8);
  const hasClock = circuit.components.some((c) => c.type === "CLOCK");
  const trace = useMemo(() => (hasClock ? timing(circuit, cycles) : null), [circuit, cycles, hasClock]);
  if (!trace) return <p className="muted">Add a clock to see a timing diagram. Try the 3-bit counter example.</p>;
  const rowH = 30;
  const left = 64;
  const stepW = 22;
  const W = left + trace.samples.length * stepW + 8;
  const H = trace.signals.length * rowH + 20;
  const y = (row: number, l: Level) => row * rowH + 8 + (l === 1 ? 0 : 18);
  return (
    <div>
      <label className="small">
        Cycles{" "}
        <select value={cycles} onChange={(e) => setCycles(Number(e.target.value))}>
          {[4, 8, 12, 16].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <div className="scroll">
        <svg width={W} height={H} role="img" aria-label="Timing diagram" className="timing">
          {trace.signals.map((s, row) => {
            let d = "";
            const xs: { x: number; l: Level }[] = trace.samples.map((sample, i) => ({ x: left + i * stepW, l: sample[row] }));
            xs.forEach((p, i) => {
              if (p.l === "X") return;
              const yy = y(row, p.l);
              const prev = xs[i - 1];
              if (!prev || prev.l === "X") d += `M${p.x},${yy}`;
              else if (prev.l !== p.l) d += `V${yy}`;
              d += `H${p.x + stepW}`;
            });
            return (
              <g key={s}>
                <text x={0} y={row * rowH + 22} className="sig-name">{s}</text>
                {xs.map((p, i) => p.l === "X" && <rect key={i} x={p.x} y={row * rowH + 8} width={stepW} height={18} className="x-band" />)}
                <path d={d} className={`wave ${s.startsWith("CLK") ? "clk" : ""}`} />
              </g>
            );
          })}
          {Array.from({ length: cycles }, (_, i) => (
            <line key={i} x1={left + i * 2 * stepW + stepW} x2={left + i * 2 * stepW + stepW} y1={0} y2={H - 12} className="edge-line" />
          ))}
        </svg>
      </div>
      <p className="muted small">Dotted lines mark rising clock edges. Flip-flops start at 0.</p>
    </div>
  );
}
