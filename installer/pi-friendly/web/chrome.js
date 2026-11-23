// Window chrome: page title and favicon follow what the app is doing.
export const FAVICON_COLORS = {
  idle: null,
  working: "#3b82f6",
  done: "#22c55e",
  error: "#ef4444",
  voice: "#f59e0b",
  loading: "#94a3b8",
};

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

export function windowTitle(status, chatName) {
  if (status?.label) return `${status.label} — AI DIY`;
  const name = String(chatName || "").trim();
  return name ? `${name} — AI DIY` : "AI DIY";
}