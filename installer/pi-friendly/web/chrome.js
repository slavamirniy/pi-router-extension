// Window chrome: the tab title follows the current action, the favicon is a
// coloured status circle. Nothing else is drawn in the tab icon.
export const FAVICON_COLORS = {
  idle: "#8b98ab",
  working: "#3b82f6",
  done: "#22c55e",
  error: "#ef4444",
  voice: "#f59e0b",
  loading: "#94a3b8",
};

export const TITLE_CHARS = 15;
const ACTIVE_VOICE = ["starting", "recording", "transcribing"];

export function windowStatus({ busy, compacting, voicePhase, loading, error, done } = {}) {
  if (error) return { kind: "error", label: "Ошибка" };
  if (compacting) return { kind: "working", label: "Сжимаю историю…" };
  if (ACTIVE_VOICE.includes(voicePhase)) return { kind: "voice", label: "Записываю…" };
  if (busy) return { kind: "working", label: "Работаю…" };
  if (loading) return { kind: "loading", label: "Загружаю…" };
  if (done) return { kind: "done", label: "Готово" };
  return { kind: "idle", label: "" };
}

// "Чат от «Первое сообщение»" is a generated fallback name; the tab shows the
// text itself, not the wrapper, and never more than 15 characters.
export function chatTitle(name, limit = TITLE_CHARS) {
  let value = String(name || "").replace(/\s+/g, " ").trim();
  const wrapped = value.match(/^Чат от «(.+)»$/i);
  if (wrapped) value = wrapped[1].trim();
  const chars = Array.from(value);
  if (chars.length <= limit) return value;
  return chars.slice(0, limit).join("").trimEnd() + "…";
}

export function windowTitle(status, chatName, fallback) {
  if (status?.label) return status.label;
  const name = chatTitle(chatName);
  if (name) return name;
  return String(fallback || "").replace(/\s+/g, " ").trim();
}