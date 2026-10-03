const KEY = "llmsrouter-progress";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const STATES = { waiting: "Ожидание", generating: "Генерация", retrying: "Сбой, повторяем", streaming: "Выдача ответа", completed: "Готово", failed: "Не удалось завершить", cancelled: "Отменено" };

// Model output must never be interpreted as terminal controls or extra UI rows.
export function cleanPreview(value, count = 50) {
  const safe = String(value ?? "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim();
  return Array.from(safe).slice(-count).join("");
}
export function formatTokens(value, estimated = false) {
  const n = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const text = n >= 1e6 ? `${(n / 1e6).toFixed(2)}м` : n >= 1000 ? `${(n / 1000).toFixed(2)}к` : String(n);
  return `${estimated ? "≈" : ""}${text} токенов`;
}
export function eventURL(baseURL, id) {
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Invalid router URL");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") + `/router/requests/${encodeURIComponent(id)}/events`;
  url.search = ""; url.hash = "";
  return url.href;
}

export function accountURL(baseURL) {
  return eventURL(baseURL, "placeholder").replace(/\/requests\/placeholder\/events$/, "/account");
}
const compact = (n) => formatTokens(n).replace(" токенов", "");
export function widgetRows(run, width = 100, theme, truncate = (s, n) => Array.from(s).slice(0, n).join(""), measure = s => Array.from(s).length) {
  const fg = (color, s) => theme?.fg ? theme.fg(color, s) : s;
  const s = run.snapshot, done = TERMINAL.has(s.state);
  if (done) return [];
  const seconds = Math.floor(Math.max(s.elapsed_ms ?? 0, (run.finished ?? run.now()) - run.started) / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const label = s.state === "retrying" ? "Повтор" : s.state === "waiting" ? "Ожидание" : "Генерация";
  const start = `${label} · ${time}`;
  const cost = Number.isSafeInteger(s.quota_tokens) ? `${s.quota_tokens_estimated ? "≈" : ""}${compact(s.quota_tokens)} квоты` : "квота —";
  const remaining = !run.ctx?.ui?.setStatus && run.account ? ` · ${balanceText(run)}` : "";
  const end = `${cost}${remaining}`;
  const room = Math.max(0, width - measure(start) - measure(end) - 6);
  let tail = cleanPreview(s.preview);
  while (measure(tail) > room && tail) tail = Array.from(tail).slice(1).join("");
  const middle = tail ? ` · ${fg("muted", tail)}` : "";
  return [truncate(`${fg("accent", start)}${middle} · ${fg("muted", end)}`, Math.max(1, width))];
}
export function balanceText(run) {
  if (!run.account) return undefined;
  const left = Math.max(0, run.account.token_limit - run.account.used);
  const [scale, suffix] = left >= 1e9 ? [1e9, " млрд"] : left >= 1e6 ? [1e6, " млн"] : left >= 1000 ? [1000, " тыс."] : [1, ""];
  // Truncate fractions so the displayed balance never rounds above the quota.
  const amount = scale === 1 ? left : Math.floor(left / (scale / 100)) / 100;
  const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount);
  return `Осталось ${run.accountStale ? "≈" : ""}${text}${suffix}`;
}

// Streaming parser supports UTF-8 splits, CRLF, multiline data, and heartbeats.
// Only the bounded current frame is held, never a transcript of previews.
export async function readStatuses(response, onEvent, signal) {
  if (!response.ok || !response.body) throw new Error("Status stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data = [], event = "";
  const dispatch = () => {
    if (event === "status" && data.length) {
      try { onEvent(JSON.parse(data.join("\n"))); } catch { /* malformed frame cannot affect generation */ }
    }
    data = []; event = "";
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 65536) throw new Error("Status frame too large");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) dispatch();
        else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
          if (data.join("\n").length > 65536) throw new Error("Status frame too large");
        }
      }
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function installRouterProgress(pi, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let current, candidate, visible = true, serial = 0;
  const failed = new Set();
  const signature = (m) => JSON.stringify([m.provider, m.model, m.timestamp]);
  function clear(ctx) { if (ctx?.hasUI) { ctx.ui.setWidget(KEY, undefined); ctx.ui.setStatus?.(KEY, undefined); ctx.ui.setWorkingVisible?.(true); } }
  function render(run) {
    try { renderUI(run); } catch { /* UI failures cannot interrupt pi or timer callbacks. */ }
  }
  function renderUI(run) {
    if (current !== run || !visible || !run.ctx.hasUI) return;
    const balance = balanceText(run);
    run.ctx.ui.setStatus?.(KEY, balance);
    if (TERMINAL.has(run.snapshot.state)) { run.ctx.ui.setWidget(KEY, undefined); return; }
    run.ctx.ui.setWidget(KEY, (_tui, theme) => ({ render: (width) => widgetRows(run, width, theme, options.truncate, options.measure), invalidate() {} }));
  }
  function stop(run) {
    if (!run) return;
    run.controller.abort();
    clearInterval(run.timer);
    clearInterval(run.accountTimer);
  }
  function apply(run, value) {
    if (current !== run || !value || value.request_id !== run.id || !Number.isSafeInteger(value.version) || value.version <= run.version || !Object.hasOwn(STATES, value.state)) return;
    const attempt = Number.isSafeInteger(value.attempt) && value.attempt >= 0 ? value.attempt : 0;
    const reset = value.reset || attempt !== run.snapshot.attempt;
    const coefficient = v => typeof v === "string" && /^\d{1,5}(?:\.\d{1,6})?$/.test(v) ? v : undefined;
    run.version = value.version;
    run.snapshot = {
      ...value, attempt,
      preview: TERMINAL.has(value.state) ? "" : cleanPreview(value.preview),
      output_tokens: Number.isSafeInteger(value.output_tokens) && value.output_tokens >= 0 ? value.output_tokens : reset ? 0 : run.snapshot.output_tokens,
      input_tokens: Number.isSafeInteger(value.input_tokens) && value.input_tokens >= 0 ? value.input_tokens : reset ? 0 : run.snapshot.input_tokens,
      input_coefficient: coefficient(value.input_coefficient), output_coefficient: coefficient(value.output_coefficient),
      elapsed_ms: Number.isSafeInteger(value.elapsed_ms) && value.elapsed_ms >= 0 ? value.elapsed_ms : 0,
      quota_tokens: Number.isSafeInteger(value.quota_tokens) && value.quota_tokens >= 0 ? value.quota_tokens : undefined,
      quota_tokens_estimated: value.quota_tokens_estimated !== false,
    };
    run.unavailable = false;
    render(run);
    if (TERMINAL.has(value.state)) stop(run);
  }
  async function account(run) {
    if (run.accountFetching || current !== run) return;
    run.accountFetching = true;
    const controller = new AbortController(); run.accountController = controller;
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetcher(run.accountURL, { headers: { Authorization: `Bearer ${run.key}` }, signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new Error("Account unavailable");
      const a = await response.json();
      if (!["token_limit", "used", "held", "available", "expires"].every(k => Number.isSafeInteger(a[k]) && a[k] >= 0) || !a.expires || a.expires > 8640000000000 || a.used > a.token_limit) throw new Error("Invalid account");
      if (current === run) { run.account = a; run.accountUnavailable = false; run.accountStale = false; }
    } catch { if (current === run) { run.accountUnavailable = true; run.accountStale = !!run.account; } }
    finally { clearTimeout(timeout); run.accountFetching = false; render(run); }
  }
  async function watch(run, url, key) {
    let failures = 0;
    while (current === run && !run.controller.signal.aborted) {
      try {
        // Redirects cannot forward a credential to a different host.
        const response = await fetcher(url, { headers: { Authorization: `Bearer ${key}`, Accept: "text/event-stream" }, signal: run.controller.signal, redirect: "error" });
        if ([401, 403, 404, 429].includes(response.status)) { run.unavailable = true; render(run); break; }
        await readStatuses(response, (value) => apply(run, value), run.controller.signal);
      } catch { /* status failure must not cancel or retry the model request */ }
      if (run.controller.signal.aborted || current !== run) break;
      run.unavailable = true; render(run);
      // Reconnection uses the same UUID; snapshots have monotonically increasing versions.
      await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); run.controller.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, Math.min(500 * 2 ** Math.min(failures++, 4), 8000));
        run.controller.signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
  pi.on("before_provider_headers", async (event, ctx) => {
    stop(current); current?.accountController?.abort(); clear(current?.ctx); current = undefined; candidate = undefined;
    const generation = ++serial;
    if (ctx.model?.api !== "openai-completions") return;
    let auth;
    try { auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model); } catch { return; }
    if (generation !== serial || !auth?.ok) return;
    const existingAuth = Object.entries(event.headers).find(([name, value]) => name.toLowerCase() === "authorization" && typeof value === "string")?.[1];
    const authHeader = Object.entries(auth.headers ?? {}).find(([name]) => name.toLowerCase() === "authorization")?.[1];
    const key = typeof authHeader === "string" && /^Bearer /i.test(authHeader) ? authHeader.slice(7) : auth.apiKey;
    if (!key) return;
    // Nested calls can use a different provider while ctx.model still names the
    // main model. Never forward another request's credential to this router.
    if (existingAuth && (!/^Bearer /i.test(existingAuth) || existingAuth.slice(7) !== key)) return;
    const baseURL = auth.baseUrl ?? ctx.model.baseUrl;
    try { accountURL(baseURL); } catch { return; }
    candidate = { ctx, key, baseURL, provider: ctx.model.provider, model: ctx.model.id, started: now() };
  });
  pi.on("after_provider_response", (event) => {
    const c = candidate; candidate = undefined;
    if (!c) return;
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const id = headers["x-request-id"];
    if (headers["x-router-events"] !== "v1" || typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return;
    const run = { ...c, id, now, url: eventURL(c.baseURL, id), accountURL: accountURL(c.baseURL), controller: new AbortController(), version: -1, snapshot: { state: "waiting", preview: "", attempt: 0, output_tokens: 0, output_tokens_estimated: true }, unavailable: false };
    current = run;
    if (run.ctx.hasUI) run.ctx.ui.setWorkingVisible?.(false);
    run.timer = setInterval(() => render(run), 1000);
    run.timer.unref?.();
    render(run);
    run.task = watch(run, run.url, run.key).catch(() => {});
    run.accountTask = account(run);
    run.accountTimer = setInterval(() => { void account(run); }, 10000); run.accountTimer.unref?.();
  });
  pi.on("message_end", async (event) => {
    const m = event.message;
    const run = current;
    if (m?.role !== "assistant" || !run || m.provider !== run.provider || m.model !== run.model) return;
    {
      stop(run);
      const bad = m.stopReason === "error" || m.stopReason === "aborted";
      if (!TERMINAL.has(run.snapshot.state)) {
        const controller = new AbortController(); run.finalController = controller;
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetcher(run.url, { headers: { Authorization: `Bearer ${run.key}`, Accept: "text/event-stream" }, signal: controller.signal, redirect: "error" });
          await readStatuses(response, v => { if (TERMINAL.has(v.state)) apply(run, v); }, controller.signal);
        } catch { /* never substitute SDK counts for the actual router debit */ }
        finally { clearTimeout(timeout); }
      }
      run.finished = now();
      run.snapshot = { ...run.snapshot, state: bad ? m.stopReason === "aborted" ? "cancelled" : "failed" : "completed", preview: "" };
      await run.accountTask; await account(run); render(run);
      if (run.ctx.hasUI && current === run) run.ctx.ui.setWorkingVisible?.(true);
    }
    if (m.stopReason === "error" || m.stopReason === "aborted") {
      if (m.timestamp != null) { failed.add(signature(m)); if (failed.size > 256) failed.delete(failed.values().next().value); }
      return { message: { ...m, content: [] } };
    }
  });
  pi.on("context", (event) => ({ messages: event.messages.filter((m) => !(m.role === "assistant" && failed.has(signature(m)) && ["error", "aborted"].includes(m.stopReason))) }));
  for (const event of ["session_shutdown", "session_switch", "session_start"]) {
    pi.on(event, (_event, ctx) => { ++serial; stop(current); current?.accountController?.abort(); current?.finalController?.abort(); clear(current?.ctx ?? ctx); current = undefined; candidate = undefined; failed.clear(); });
  }
  pi.on("agent_end", () => { if (current && !TERMINAL.has(current.snapshot.state)) { stop(current); current.snapshot = { ...current.snapshot, state: "cancelled", preview: "" }; render(current); } if (current?.ctx.hasUI) current.ctx.ui.setWorkingVisible?.(true); });
  pi.on("model_select", (_event, ctx) => { ++serial; stop(current); current?.accountController?.abort(); current?.finalController?.abort(); clear(current?.ctx ?? ctx); current = undefined; candidate = undefined; });
  pi.registerCommand("router-progress", {
    description: "Показать или скрыть прогресс LLMSRouter: /router-progress on|off",
    handler: async (args, ctx) => {
      visible = args.trim() === "off" ? false : args.trim() === "on" ? true : !visible;
      if (!visible) clear(ctx); else if (current) render(current);
      if (ctx.hasUI) ctx.ui.notify(visible ? "Прогресс роутера включён" : "Прогресс роутера скрыт", "info");
    },
  });
  // Exposed only to in-process tests, never written to pi history.
  return { getCurrent: () => current, stop: () => { ++serial; stop(current); current?.accountController?.abort(); current?.finalController?.abort(); clear(current?.ctx); current = undefined; candidate = undefined; } };
}
