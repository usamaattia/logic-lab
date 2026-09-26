import { useCallback, useState } from "react";

/** Present value with undo/redo. `set(v, false)` updates without adding a history step. */
export function useHistory<T>(initial: T | (() => T), limit = 100) {
  const [state, setState] = useState(() => {
    const present = typeof initial === "function" ? (initial as () => T)() : initial;
    return { past: [] as T[], present, future: [] as T[], anchor: present };
  });

  const set = useCallback(
    (value: T, commit = true) =>
      setState((s) => {
        if (!commit) return { ...s, present: value };
        // one history step from the last committed value, however many uncommitted updates
        const past = [...s.past, s.anchor].slice(-limit);
        return { past, present: value, future: [], anchor: value };
      }),
    [limit],
  );
  const undo = useCallback(
    () =>
      setState((s) => {
        if (!s.past.length) return s;
        const prev = s.past[s.past.length - 1];
        return { past: s.past.slice(0, -1), present: prev, future: [s.anchor, ...s.future], anchor: prev };
      }),
    [],
  );
  const redo = useCallback(
    () =>
      setState((s) => {
        if (!s.future.length) return s;
        const [next, ...rest] = s.future;
        return { past: [...s.past, s.anchor], present: next, future: rest, anchor: next };
      }),
    [],
  );
  const reset = useCallback((value: T) => setState({ past: [], present: value, future: [], anchor: value }), []);

  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
