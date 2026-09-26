import { useEffect, useState } from "react";
import type { Circuit } from "./logic/circuit";
import { print, type Expr } from "./logic/expr";
import { EXAMPLES } from "./logic/library";
import { decodeState, encodeState, store } from "./share";
import { ALGEBRA_DEFAULT, AlgebraTab, type AlgebraState } from "./ui/AlgebraTab";
import { CircuitTab } from "./ui/CircuitTab";
import { useHistory } from "./ui/history";

const EMBED = import.meta.env.VITE_EMBED === "1";
type Tab = "circuit" | "algebra";

interface Saved {
  tab?: Tab;
  circuit?: Circuit;
  algebra?: AlgebraState;
}

function initial(): Saved {
  const m = window.location.hash.match(/s=([A-Za-z0-9_-]+)/);
  const fromLink = m ? decodeState<Saved>(m[1]) : null;
  return fromLink ?? store.get<Saved>("logic-lab") ?? {};
}

export default function App() {
  const [boot] = useState(initial);
  const [tab, setTab] = useState<Tab>(boot.tab ?? "circuit");
  const history = useHistory<Circuit>(() => boot.circuit ?? EXAMPLES.find((e) => e.id === "full-adder")!.circuit());
  const [algebra, setAlgebra] = useState<AlgebraState>(boot.algebra ?? ALGEBRA_DEFAULT);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");

  useEffect(() => {
    const id = window.setTimeout(() => store.set("logic-lab", { tab, circuit: history.value, algebra }), 400);
    return () => window.clearTimeout(id);
  }, [tab, history.value, algebra]);

  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const share = async () => {
    const url = `${window.location.href.split("#")[0]}#s=${encodeState({ tab, circuit: history.value, algebra })}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.history.replaceState(null, "", url);
    }
  };

  const openCircuit = (c: Circuit) => {
    history.set(c, true);
    setTab("circuit");
  };
  const openInAlgebra = (e: Expr) => {
    setAlgebra({ text: print(e), table: null });
    setTab("algebra");
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M3,5 H12 A9,9 0 0 1 12,23 H3 Z" className="logo-gate" />
            <circle cx="24" cy="14" r="3" className="logo-dot" />
          </svg>
          <div>
            <h1>Logic Lab</h1>
            <p>Build and simulate digital circuits, and simplify Boolean functions.</p>
          </div>
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          <button role="tab" aria-selected={tab === "circuit"} onClick={() => setTab("circuit")}>Circuit</button>
          <button role="tab" aria-selected={tab === "algebra"} onClick={() => setTab("algebra")}>Boolean algebra</button>
        </nav>
        <div className="top-actions">
          {!EMBED && <button onClick={share}>{copied ? "Link copied" : "Copy link"}</button>}
          <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} aria-label="Colour theme">
            <option value="auto">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </header>
      <main>
        {tab === "circuit" ? (
          <CircuitTab history={history} embed={EMBED} openInAlgebra={openInAlgebra} />
        ) : (
          <AlgebraTab state={algebra} setState={setAlgebra} openCircuit={openCircuit} />
        )}
      </main>
    </div>
  );
}
