export const ATTACHMENT_START = "[[ATTACHMENTS]]";
export const ATTACHMENT_END = "[[/ATTACHMENTS]]";
const pattern = new RegExp(
  String.raw`\n*\[\[ATTACHMENTS\]\]\n([\s\S]*?)\n\[\[\/ATTACHMENTS\]\]\n*`,
  "g",
);

export function attachmentBlock(items) {
  if (!items.length) return "";
  return (
    ATTACHMENT_START +
    "\n" +
    items.map((item) => JSON.stringify({ name: item.name, path: item.path, ...(Number.isFinite(item.size) ? { size: item.size } : {}) })).join("\n") +
    "\n" +
    ATTACHMENT_END
  );
}

export function splitAttachments(text) {
  const items = [];
  const clean = String(text || "")
    .replace(pattern, (_, body) => {
      for (const line of String(body || "").split("\n")) {
        const raw = line.trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.path) {
            const item = {
              name: parsed.name || String(parsed.path).split(/[\/]/).pop() || "Файл",
              path: parsed.path,
            };
            if (Number.isFinite(parsed.size) && parsed.size >= 0) item.size = parsed.size;
            items.push(item);
          }
        } catch {}
      }
      return "\n\n";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean, attachments: items };
}

export function buildOutgoingText(text, items = []) {
  const visible = String(text || "").trim();
  const block = attachmentBlock(items);
  return block ? (visible ? `${visible}\n\n${block}` : block) : visible;
}

export function stripAttachments(text) {
  return splitAttachments(text).text;
}
