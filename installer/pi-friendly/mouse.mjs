// Dialogs and the work dock share one mouse-mode lease. Closing a dialog must
// not disable the dock, or overwrite the terminal's saved original modes.
const terminals = new WeakMap();
export function acquireMouse(terminal) {
  let state = terminals.get(terminal);
  if (!state) {
    state = { count: 0 };
    terminals.set(terminal, state);
    terminal.write("\x1b[?1000s\x1b[?1006s\x1b[?1000h\x1b[?1006h");
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count === 0) {
      terminal.write("\x1b[?1000l\x1b[?1006l\x1b[?1000r\x1b[?1006r");
      terminals.delete(terminal);
    }
  };
}
