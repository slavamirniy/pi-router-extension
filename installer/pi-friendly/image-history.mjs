// Keep request payloads small: images from old turns are not sent again.
// The LLM still sees that an image was there and keeps the surrounding text.
// The newest user message is never torn apart, even if it has more images than
// the limit: those are the references for the request that is being answered.

export const DEFAULT_IMAGE_HISTORY_LIMIT = 2;
export const IMAGE_PLACEHOLDER =
  "[Изображение не отправлено повторно: в истории остаются только последние изображения.]";
export const DUPLICATE_IMAGE_PLACEHOLDER =
  "[Это же изображение уже есть выше в разговоре и не отправлено повторно.]";

export function imageHistoryLimit(prefs) {
  const env = String(process.env.PI_FRIENDLY_IMAGE_LIMIT ?? "").trim();
  const raw = Number(env !== "" ? env : prefs?.imageHistory);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 50) return raw;
  return DEFAULT_IMAGE_HISTORY_LIMIT;
}

function countImages(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return 0;
  let count = 0;
  for (const block of content) if (block?.type === "image") count += 1;
  return count;
}

function newestUserIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

export function pruneOldImages(messages, keep = DEFAULT_IMAGE_HISTORY_LIMIT) {
  if (!Array.isArray(messages)) return messages;
  const limit = Number.isInteger(keep) && keep >= 0 ? keep : DEFAULT_IMAGE_HISTORY_LIMIT;
  const current = newestUserIndex(messages);
  if (current < 0) return messages;
  let budget = limit;
  let changedAny = false;
  const kept = new Set();
  const result = messages.slice();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    let contentChanged = false;
    const next = content.slice();
    for (let block = next.length - 1; block >= 0; block -= 1) {
      if (next[block]?.type !== "image") continue;
      const data = next[block].data;
      const duplicate = typeof data === "string" && kept.has(data);
      if (!duplicate && (index === current || budget > 0)) {
        if (typeof data === "string") kept.add(data);
        if (index !== current) budget -= 1;
        continue;
      }
      next[block] = { type: "text", text: duplicate ? DUPLICATE_IMAGE_PLACEHOLDER : IMAGE_PLACEHOLDER };
      contentChanged = true;
    }
    if (contentChanged) {
      result[index] = { ...message, content: next };
      changedAny = true;
    }
  }
  return changedAny ? result : messages;
}

export function countKeptImages(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((total, message) => total + countImages(message), 0);
}