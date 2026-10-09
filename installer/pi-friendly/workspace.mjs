import { clean, mouseEvent } from "./menu.mjs";
import { acquireMouse } from "./mouse.mjs";
import { createSurface } from "./surface.mjs";

// Compose the existing editor through its public interface. Unknown methods and
// properties remain delegated, including image paste, history and app actions.
export function createWorkspace({ delegate, tui, theme, rendering, ctx, actions, footerHeight = () => 1, slashEnabled = true, viewState = () => ({}), cleanView = false }) {
  const { truncate, measure, matchesKey } = rendering;
  let technical = false, heldFrame;
  const transitionKey=Symbol.for('pi-friendly.transition');
  const transitions=globalThis[transitionKey]??=new Map();
  function freezeForTransition(){
    transitions.get(tui)?.();
    const rows=heldFrame?.rows?.length?heldFrame.rows:surface.render(tui.terminal.columns);
    const shield=tui.showOverlay({invalidate(){},render:width=>rows.map(row=>rendering.truncate(row,width,''))},{row:0,col:0,width:'100%',maxHeight:'100%',nonCapturing:true});
    // The host removes the top overlay during resetExtensionUI; keep the shield below it.
    const cap=tui.showOverlay({invalidate(){},render:()=>[]},{nonCapturing:true});
    const release=()=>{clearTimeout(timer);shield.hide();cap.hide();if(transitions.get(tui)===release)transitions.delete(tui);tui.requestRender();};
    const timer=setTimeout(release,15000);timer.unref?.();transitions.set(tui,release);
  }
  let proxy, provider, suggestions = [], selected = 0, query = "", suppressed = "", request, disposed = false;
  let topTargets = [], listTargets = [], topSize = "", listSize = "";
  const releaseMouse = acquireMouse(tui.terminal);
  const focused = () => !disposed && tui.getFocusedComponent() === proxy;
  const size = () => `${tui.terminal.columns}:${tui.terminal.rows}`;
  const slash = () => /^\/[^\s]*$/.test(delegate.getText());
  const listCount = () => Math.max(0, Math.min(5, tui.terminal.rows - footerHeight() - 9, suggestions.length));
  const listHeight = () => focused() && suggestions.length && slash() ? listCount() + 2 : 0;
  const clear = () => { request?.abort(); suggestions = []; selected = 0; tui.requestRender(); };
  async function refresh() {
    const text = delegate.getText();
    if (!slashEnabled || !provider || !slash() || text === suppressed) { clear(); return; }
    request?.abort(); const current = request = new AbortController();
    query = text;
    try {
      const result = await provider.getSuggestions([text], 0, text.length, { signal: current.signal });
      if (disposed || current.signal.aborted || delegate.getText() !== text) return;
      suggestions = result?.prefix?.startsWith("/") ? result.items : [];
      selected = Math.min(selected, Math.max(0, suggestions.length - 1));
      tui.requestRender();
    } catch { if (!current.signal.aborted) clear(); }
  }
  function complete(item) {
    if (!item || !slash() || delegate.getText() !== query) return;
    const result = provider.applyCompletion([query], 0, query.length, item, query);
    clear(); delegate.setText(result.lines.join("\n"));
    suppressed = delegate.getText(); tui.requestRender();
  }
  async function executeCommand(text){
    if(disposed)throw new Error('Окно чата уже закрыто.');
    if(typeof delegate.onSubmit!=='function')throw new Error('Обработчик команд ещё не готов. Попробуйте снова.');
    clear();suppressed=text;
    // Internal navigation must not go through editor completion or the voice send guard.
    await delegate.onSubmit(text);
  }
  function submit() {
    if (!ctx.isIdle() || !delegate.getText().trim() || ['starting','recording','transcribing'].includes(viewState().voice?.phase)) return;
    if(viewState().needsProject && !delegate.getText().startsWith("/")){void actions.newChat();return;}
    clear(); suppressed = delegate.getText();
    delegate.handleInput("\r"); // Host submission: commands, pasted text and images retain native semantics.
    tui.requestRender();
  }
  const toolbar = {
    invalidate() {},
    render(width) {
      topTargets = []; topSize = size();
      const buttons = [
        { label: technical ? "Вернуться в чат" : "Меню", run: technical ? () => { technical = false; tui.requestRender(); } : actions.menu },
        { label: "Модель", run: actions.model },
        { label: ctx.isIdle() ? (delegate.getText().startsWith("/") ? "Выполнить" : "Отправить") : "Остановить", run: ctx.isIdle() ? submit : () => ctx.abort(), primary: true, disabled: ctx.isIdle() && !delegate.getText().trim() },
      ];
      let row = " ";
      // Small windows keep menu and send; all other actions remain in slash commands.
      const visible = width < 42 ? [buttons[0], buttons.at(-1)] : buttons;
      for (const button of visible) {
        const label = ` ${button.label} `;
        const start = measure(row), end = start + measure(label);
        if (end > width) break;
        const text = button.disabled ? theme.fg("dim", label) : button.primary ? theme.fg("accent", theme.bold(label)) : label;
        row += theme.bg(button.primary && !button.disabled ? "selectedBg" : "userMessageBg", text) + " ";
        if (!button.disabled) topTargets.push({ start, end, run: button.run });
      }
      return [truncate(row, width, ""), theme.fg("borderMuted", "─".repeat(width))];
    },
  };
  const dropdown = {
    invalidate() {},
    render(width) {
      listSize = size(); listTargets = [];
      const count = listCount();
      if (!count) return [];
      const start = Math.max(0, selected - count + 1);
      const rows = [theme.fg("muted", truncate(` Команды · ${selected + 1}/${suggestions.length} · нажмите для выбора`, width, ""))];
      for (let index = start; index < Math.min(start + count, suggestions.length); index++) {
        const item = suggestions[index];
        const label = truncate(` ${index === selected ? "›" : " "} ${clean(item.label)}  ${clean(item.description)}`, width, "");
        rows.push(theme.bg(index === selected ? "selectedBg" : "userMessageBg", label + " ".repeat(Math.max(0, width - measure(label)))));
        listTargets.push({ row: rows.length - 1, item });
      }
      rows.push(theme.fg("muted", truncate(" Выберите команду, затем нажмите «Выполнить»", width, "")));
      return rows;
    },
  };
  const surface = createSurface({ tui, delegate, rendering, ctx,
    state: () => ({ ...viewState(), suggestions: slash() ? suggestions : [], selected }),
    actions: { ...actions, submit, complete, technical: () => { technical = true; tui.requestRender(); }, more: actions.more || actions.menu },
  });
  const surfaceHandle = tui.showOverlay({invalidate:()=>surface.invalidate(),render:width=>{const rows=heldFrame && heldFrame.width===width && heldFrame.rows.length===tui.terminal.rows ? heldFrame.rows : surface.render(width);const release=transitions.get(tui);if(release)queueMicrotask(release);return rows;}}, { row: 0, col: 0, width: "100%", maxHeight: "100%", nonCapturing: true, visible: () => cleanView && !technical && focused() });
  const topHandle = tui.showOverlay(toolbar, { row: 0, col: 0, width: "100%", nonCapturing: true, visible: () => (!cleanView || technical) && focused() });
  // The host footer is below the editor. Reserve dropdown rows in editor.render
  // so this overlay cannot hide the user's input or the router status.
  let dropdownHandle;
  let lastFooter = -1;
  function placeDropdown() {
    const footer = footerHeight();
    if (footer === lastFooter) return;
    dropdownHandle?.hide(); lastFooter = footer;
    dropdownHandle = tui.showOverlay(dropdown, { anchor: "bottom-left", offsetY: -footer, width: "100%", nonCapturing: true, visible: () => (!cleanView || technical) && Boolean(listHeight()) });
  }
  const removeInput = tui.addInputListener(data => {
    const mouse = mouseEvent(data);
    if (!mouse || !focused()) return undefined;
    if (cleanView && !technical) { surface.onMouse(data); return { consume: true }; }
    if (mouse.press && size() === topSize && mouse.y === 0 && mouse.button === 0) {
      const hit = topTargets.find(t => mouse.x >= t.start && mouse.x < t.end);
      if (hit) void hit.run();
    } else if (mouse.press && listHeight() && size() === listSize) {
      const top = tui.terminal.rows - footerHeight() - listHeight();
      if (mouse.y >= top && mouse.y < top + listHeight()) {
        if (mouse.button === 64 || mouse.button === 65) selected = Math.max(0, Math.min(suggestions.length - 1, selected + (mouse.button === 64 ? -1 : 1)));
        else if (mouse.button === 0) complete(listTargets.find(t => t.row === mouse.y - top)?.item);
      }
    }
    tui.requestRender();
    return { consume: true }; // Never insert a mouse escape sequence into the prompt.
  });
  const overrides = {
    render(width) {
      placeDropdown();
      return [...delegate.render(width), ...Array(listHeight()).fill("")];
    },
    handleInput(data) {
      if(matchesKey(data,'enter')&&['starting','recording','transcribing'].includes(viewState().voice?.phase)){
        if(viewState().voice?.phase==='recording')actions.voice?.();
        return;
      }
      if (suggestions.length && slash()) {
        if (matchesKey(data, "down") || matchesKey(data, "up")) {
          selected = (selected + (matchesKey(data, "down") ? 1 : -1) + suggestions.length) % suggestions.length;
          tui.requestRender(); return;
        }
        if (matchesKey(data, "enter") || matchesKey(data, "tab")) { complete(suggestions[selected]); return; }
        if (matchesKey(data, "escape")) { suppressed = delegate.getText(); clear(); return; }
      }
      if(viewState().needsProject && matchesKey(data,"enter") && !delegate.getText().startsWith("/")){void actions.newChat();return;}
      delegate.handleInput(data); void refresh();
    },
    setText(text) { delegate.setText(text); suppressed = ""; void refresh(); },
    setAutocompleteProvider(next) {
      provider = next;
      delegate.setAutocompleteProvider?.(new Proxy(next, { get(target, key) {
        if (key === "getSuggestions") return (lines, line, col, options) => slashEnabled && /^\/[^\s]*$/.test(lines.join("\n")) ? Promise.resolve(null) : target.getSuggestions(lines, line, col, options);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } }));
      void refresh();
    },
  };
  proxy = new Proxy(delegate, {
    get(target, key) { if (key in overrides) return overrides[key]; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; },
    set(target, key, value) { return Reflect.set(target, key, value); },
  });
  return { editor: proxy, submit, executeCommand, refresh, freezeForTransition, renderSurface: width => surface.render(width), sidebarMouse: data => surface.onMouse(data), sidebarNavigate: data => surface.navigate(data), clearHeldFrame: () => {heldFrame=undefined;}, holdFrame: rows => {const held={rows:rows??[],width:tui.terminal.columns};heldFrame=held;return ()=>{if(heldFrame===held)heldFrame=undefined;tui.requestRender();};}, getCommands: async () => (await provider?.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal }))?.items ?? [], redraw: () => tui.requestRender(), dispose() {
    if (disposed) return;
    disposed = true; request?.abort(); surfaceHandle.hide(); topHandle.hide(); dropdownHandle?.hide(); removeInput(); releaseMouse();
  } };
}
