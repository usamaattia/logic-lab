import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Circuit, Component, Level, PinRef, Simulator } from "../logic/circuit";
import { labelOf, seg7Value } from "../logic/circuit";
import { gatePath, geom, INVERTING, pinPos, SEG_PATTERNS } from "./geometry";

export type Selection = { kind: "comp" | "wire"; id: string } | null;

export interface View {
  x: number;
  y: number;
  scale: number;
}

interface Props {
  circuit: Circuit;
  sim: Simulator;
  simVersion: number;
  onChange: (c: Circuit, commit: boolean) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  view: View;
  onView: (v: View) => void;
}

type Drag =
  | { kind: "comp"; id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean; before: Circuit }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "wire"; from: PinRef & { dir: "in" | "out" }; x: number; y: number; moved: boolean }
  | null;

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export const levelClass = (l: Level) => (l === 1 ? "hi" : l === 0 ? "lo" : "x");

export function wirePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  if (b.x >= a.x + 20) {
    const mx = snap((a.x + b.x) / 2);
    return `M${a.x},${a.y} H${mx} V${b.y} H${b.x}`;
  }
  // feedback: loop out to the right, over/under, and back in from the left
  const dy = b.y >= a.y ? 1 : -1;
  const outY = Math.abs(b.y - a.y) < 30 ? Math.max(a.y, b.y) + 40 * dy : (a.y + b.y) / 2;
  return `M${a.x},${a.y} H${a.x + 16} V${outY} H${b.x - 16} V${b.y} H${b.x}`;
}

export function Editor({ circuit, sim, simVersion, onChange, selection, onSelect, view, onView }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [pending, setPending] = useState<(PinRef & { dir: "in" | "out" }) | null>(null);
  const [size, setSize] = useState({ w: 900, h: 520 });
  void simVersion;

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    // clientWidth is 0 for SVG elements in some browsers: measure the box instead
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = svg.current!.getBoundingClientRect();
      return { x: view.x + (e.clientX - r.left) / view.scale, y: view.y + (e.clientY - r.top) / view.scale };
    },
    [view],
  );

  const byId = new Map(circuit.components.map((c) => [c.id, c]));

  const connect = (a: PinRef & { dir: "in" | "out" }, b: PinRef & { dir: "in" | "out" }) => {
    if (a.dir === b.dir) return;
    const from = a.dir === "out" ? a : b;
    const to = a.dir === "in" ? a : b;
    // an input has one driver: a new wire replaces the old one
    const wires = circuit.wires.filter((w) => !(w.to.id === to.id && w.to.pin === to.pin));
    wires.push({ id: `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, from: { id: from.id, pin: from.pin }, to: { id: to.id, pin: to.pin } });
    onChange({ ...circuit, wires }, true);
  };

  const pinAt = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)?.closest("[data-pin]");
    if (!el) return null;
    const [id, dir, pin] = el.getAttribute("data-pin")!.split("|");
    return { id, dir: dir as "in" | "out", pin: Number(pin) };
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const pinEl = target.closest("[data-pin]");
    const compEl = target.closest("[data-comp]");
    const wireEl = target.closest("[data-wire]");
    const p = toWorld(e);
    svg.current!.setPointerCapture(e.pointerId);
    if (pinEl) {
      const [id, dir, pin] = pinEl.getAttribute("data-pin")!.split("|");
      const ref = { id, dir: dir as "in" | "out", pin: Number(pin) };
      if (pending) {
        connect(pending, ref);
        setPending(null);
        return;
      }
      setDrag({ kind: "wire", from: ref, x: p.x, y: p.y, moved: false });
      return;
    }
    if (compEl) {
      const c = byId.get(compEl.getAttribute("data-comp")!)!;
      setDrag({ kind: "comp", id: c.id, dx: p.x - c.x, dy: p.y - c.y, startX: e.clientX, startY: e.clientY, moved: false, before: circuit });
      return;
    }
    if (wireEl) {
      onSelect({ kind: "wire", id: wireEl.getAttribute("data-wire")! });
      setPending(null);
      return;
    }
    setPending(null);
    onSelect(null);
    setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === "comp") {
      const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4;
      if (!moved) return;
      const p = toWorld(e);
      const x = snap(p.x - drag.dx);
      const y = snap(p.y - drag.dy);
      const c = byId.get(drag.id)!;
      if (c.x !== x || c.y !== y)
        onChange({ ...circuit, components: circuit.components.map((k) => (k.id === drag.id ? { ...k, x, y } : k)) }, false);
      if (!drag.moved) setDrag({ ...drag, moved: true });
    } else if (drag.kind === "pan") {
      onView({ ...view, x: drag.vx - (e.clientX - drag.sx) / view.scale, y: drag.vy - (e.clientY - drag.sy) / view.scale });
      if (!drag.moved) setDrag({ ...drag, moved: true });
    } else {
      const p = toWorld(e);
      setDrag({ ...drag, x: p.x, y: p.y, moved: drag.moved || Math.hypot(p.x - drag.x, p.y - drag.y) > 3 });
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === "comp") {
      const c = byId.get(drag.id)!;
      if (drag.moved) {
        // commit the move as one undo step
        onChange(circuit, true);
      } else if (c.type === "INPUT") {
        onChange({ ...circuit, components: circuit.components.map((k) => (k.id === c.id ? { ...k, value: k.value ? 0 : 1 } : k)) }, true);
        onSelect({ kind: "comp", id: c.id });
      } else {
        onSelect({ kind: "comp", id: c.id });
      }
    } else if (drag.kind === "wire") {
      const target = pinAt(e.clientX, e.clientY);
      if (target && (target.id !== drag.from.id || target.dir !== drag.from.dir)) connect(drag.from, target);
      else if (!drag.moved) setPending(drag.from); // tap a pin, then tap another
    }
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const p = toWorld(e);
    const scale = Math.min(2.5, Math.max(0.3, view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const r = svg.current!.getBoundingClientRect();
    onView({ scale, x: p.x - (e.clientX - r.left) / scale, y: p.y - (e.clientY - r.top) / scale });
  };

  const vb = `${view.x} ${view.y} ${size.w / view.scale} ${size.h / view.scale}`;
  const oscillating = new Set<string>();

  return (
    <svg
      ref={svg}
      className="editor"
      viewBox={vb}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      role="application"
      aria-label="Circuit editor"
      style={{ touchAction: "none" }}
    >
      <defs>
        <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
          <circle cx={0.5} cy={0.5} r={0.9} fill="var(--grid)" />
        </pattern>
      </defs>
      <rect x={view.x - 10} y={view.y - 10} width={size.w / view.scale + 20} height={size.h / view.scale + 20} fill="url(#grid)" />

      {circuit.wires.map((w) => {
        const a = byId.get(w.from.id);
        const b = byId.get(w.to.id);
        if (!a || !b) return null;
        const level = sim.output(w.from.id, w.from.pin);
        const d = wirePath(pinPos(a, "out", w.from.pin), pinPos(b, "in", w.to.pin));
        const sel = selection?.kind === "wire" && selection.id === w.id;
        return (
          <g key={w.id} data-wire={w.id}>
            <path d={d} className="wire-hit" />
            <path d={d} className={`wire ${levelClass(level)} ${sel ? "selected" : ""} ${oscillating.has(w.from.id) ? "osc" : ""}`} />
          </g>
        );
      })}

      {circuit.components.map((c) => (
        <Part key={c.id} c={c} sim={sim} selected={selection?.kind === "comp" && selection.id === c.id} pending={pending} />
      ))}

      {drag?.kind === "wire" && drag.moved && (() => {
        const c = byId.get(drag.from.id)!;
        const p = pinPos(c, drag.from.dir, drag.from.pin);
        const d = drag.from.dir === "out" ? wirePath(p, { x: drag.x, y: drag.y }) : wirePath({ x: drag.x, y: drag.y }, p);
        return <path d={d} className="wire preview" />;
      })()}
    </svg>
  );
}

function Part({ c, sim, selected, pending }: { c: Component; sim: Simulator; selected: boolean; pending: (PinRef & { dir: string }) | null }) {
  const g = geom(c);
  const label = c.label?.trim();
  const outLevel = g.outs.length ? sim.output(c.id, 0) : sim.input(c, 0);
  return (
    <g transform={`translate(${c.x},${c.y})`} className={`part ${selected ? "selected" : ""}`}>
      <g data-comp={c.id} className="body">
        <Body c={c} w={g.w} h={g.h} sim={sim} level={outLevel} />
      </g>
      {g.ins.map((p, i) => {
        const l = sim.input(c, i);
        const target = pending && pending.dir === "out";
        return (
          <g key={`i${i}`}>
            <line x1={p.x} y1={p.y} x2={0} y2={p.y} className={`stub ${levelClass(l)}`} />
            <circle cx={p.x} cy={p.y} r={9} className="pin-hit" data-pin={`${c.id}|in|${i}`} />
            <circle cx={p.x} cy={p.y} r={3.5} className={`pin ${target ? "target" : ""}`} pointerEvents="none" />
            {(c.type === "DFF" || c.type === "JKFF" || c.type === "TFF" || c.type === "SEG7") && (
              p.name === "CLK"
                ? <path d={`M0,${p.y - 6} L8,${p.y} L0,${p.y + 6}`} className="clk-mark" pointerEvents="none" />
                : <text x={4} y={p.y + 4} className="pin-name" pointerEvents="none">{p.name}</text>
            )}
          </g>
        );
      })}
      {g.outs.map((p, i) => {
        const l = sim.output(c.id, i);
        const isPending = pending && pending.id === c.id && pending.dir === "out" && pending.pin === i;
        const target = pending && pending.dir === "in";
        return (
          <g key={`o${i}`}>
            <line x1={g.w} y1={p.y} x2={p.x} y2={p.y} className={`stub ${levelClass(l)}`} />
            <circle cx={p.x} cy={p.y} r={9} className="pin-hit" data-pin={`${c.id}|out|${i}`} />
            <circle cx={p.x} cy={p.y} r={3.5} className={`pin ${isPending ? "pending" : ""} ${target ? "target" : ""}`} pointerEvents="none" />
            {(c.type === "DFF" || c.type === "JKFF" || c.type === "TFF") && (
              <text x={g.w - 4} y={p.y + 4} textAnchor="end" className="pin-name" pointerEvents="none">{p.name}</text>
            )}
          </g>
        );
      })}
      {label && (c.type === "INPUT" || c.type === "CLOCK") && (
        <text x={-16} y={g.h / 2 + 4} textAnchor="end" className="part-label" pointerEvents="none">{label}</text>
      )}
      {label && c.type === "OUTPUT" && (
        <text x={g.w + 8} y={g.h / 2 + 4} className="part-label" pointerEvents="none">{label}</text>
      )}
      {label && ["DFF", "JKFF", "TFF"].includes(c.type) && (
        <text x={g.w / 2} y={-6} textAnchor="middle" className="part-label" pointerEvents="none">{label}</text>
      )}
    </g>
  );
}

function Body({ c, w, h, sim, level }: { c: Component; w: number; h: number; sim: Simulator; level: Level }) {
  switch (c.type) {
    case "INPUT":
      return (
        <>
          <rect width={w} height={h} rx={6} className={`switch ${levelClass(c.value ?? 0)}`} />
          <rect x={c.value ? w - 22 : 4} y={4} width={18} height={h - 8} rx={4} className="knob" />
          <text x={c.value ? 12 : w - 12} y={h / 2 + 4} textAnchor="middle" className="switch-text">{c.value ?? 0}</text>
          <title>{`${labelOf(c)}: click to switch`}</title>
        </>
      );
    case "CLOCK":
      return (
        <>
          <rect width={w} height={h} rx={6} className={`clock ${levelClass(level)}`} />
          <path d={`M8,${h - 8} H16 V8 H26 V${h - 8} H34 V8 H40`} className="clock-wave" />
        </>
      );
    case "CONST0": case "CONST1":
      return (
        <>
          <rect width={w} height={h} rx={4} className="const" />
          <text x={w / 2} y={h / 2 + 5} textAnchor="middle" className="const-text">{c.type === "CONST1" ? "1" : "0"}</text>
        </>
      );
    case "OUTPUT":
      return (
        <>
          <circle cx={w / 2} cy={h / 2} r={h / 2} className={`led ${levelClass(level)}`} />
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" className="led-text">{level}</text>
        </>
      );
    case "DFF": case "JKFF": case "TFF":
      return (
        <>
          <rect width={w} height={h} rx={4} className="gate" />
          <text x={w / 2} y={h - 8} textAnchor="middle" className="ff-name">{c.type === "DFF" ? "D" : c.type === "JKFF" ? "JK" : "T"}</text>
        </>
      );
    case "SEG7": {
      const v = seg7Value(sim, c);
      const on = v === null ? "" : SEG_PATTERNS[v];
      const x0 = 18, y0 = 14, sw = 30, sh = 34;
      const segs: Record<string, string> = {
        a: `M${x0 + 3},${y0} H${x0 + sw - 3}`,
        b: `M${x0 + sw},${y0 + 3} V${y0 + sh - 3}`,
        c: `M${x0 + sw},${y0 + sh + 3} V${y0 + 2 * sh - 3}`,
        d: `M${x0 + 3},${y0 + 2 * sh} H${x0 + sw - 3}`,
        e: `M${x0},${y0 + sh + 3} V${y0 + 2 * sh - 3}`,
        f: `M${x0},${y0 + 3} V${y0 + sh - 3}`,
        g: `M${x0 + 3},${y0 + sh} H${x0 + sw - 3}`,
      };
      return (
        <>
          <rect width={w} height={h} rx={6} className="seg-body" />
          {Object.entries(segs).map(([k, d]) => (
            <path key={k} d={d} className={`seg ${on.includes(k) ? "on" : ""}`} />
          ))}
          <title>{v === null ? "unknown input" : `shows ${v.toString(16).toUpperCase()} (${v})`}</title>
        </>
      );
    }
    default: {
      const bodyW = INVERTING.has(c.type) ? w - 8 : w;
      return (
        <>
          <path d={gatePath(c.type, w, h)} className="gate" />
          {c.type.startsWith("X") && <path d={`M0,0 Q${bodyW * 0.28},${h / 2} 0,${h}`} className="gate-line" />}
          {INVERTING.has(c.type) && <circle cx={bodyW + 4} cy={h / 2} r={4} className="gate bubble" />}
          <title>{c.type}</title>
        </>
      );
    }
  }
}
