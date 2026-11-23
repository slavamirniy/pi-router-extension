// A finished assistant turn keeps only its final answer on screen. Thinking,
// tool calls and intermediate narration are folded into one expandable
// "work path"; notes and images stay visible.
export const VISIBLE_KINDS = new Set(["note", "images"]);

export function finalAnswerIndex(parts) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.kind === "answer" && String(part.text || "").trim()) return index;
  }
  return -1;
}

export function partitionAssistantParts(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const answer = finalAnswerIndex(list);
  const work = [];
  const extra = [];
  list.forEach((part, index) => {
    if (index === answer) return;
    if (VISIBLE_KINDS.has(part?.kind)) extra.push(index);
    else work.push(index);
  });
  return { answer, work, extra };
}

export function workPathTitle(count) {
  const total = Number.isInteger(count) && count > 0 ? count : 0;
  if (!total) return "Ход работы";
  const lastDigit = total % 10;
  const lastTwo = total % 100;
  const word =
    lastDigit === 1 && lastTwo !== 11
      ? "шаг"
      : lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 10 || lastTwo >= 20)
        ? "шага"
        : "шагов";
  return `Ход работы · ${total} ${word}`;
}

// A finished turn stays collapsed, except when the reader explicitly opened the
// work path or had already opened one of its steps (thinking, a tool, versions).
export function shouldOpenWorkPath({ answer = -1, nestedOpen = false, explicit } = {}) {
  if (explicit === true || explicit === false) return explicit;
  if (nestedOpen) return true;
  return answer < 0;
}
