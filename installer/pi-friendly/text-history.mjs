// Old tool output is the other half of oversized requests: a single `read` or a
// chatty console command can carry hundreds of kilobytes and then travel with
// every later request. Keep the newest long outputs intact and shorten older
// ones to their first characters plus a short note about where they came from.

import { resolve } from "node:path";

export const DEFAULT_TEXT_HISTORY_LIMIT = 15;
export const DEFAULT_TEXT_HEAD_CHARS = 1000;

const BASH_TOOLS = new Set(["bash", "powershell", "shell"]);

export function textHistoryLimit(prefs) {
  return numberSetting("PI_FRIENDLY_TEXT_HISTORY", prefs?.textHistory, DEFAULT_TEXT_HISTORY_LIMIT, 0, 200);
}

export function textHeadChars(prefs) {
  return numberSetting("PI_FRIENDLY_TEXT_HEAD", prefs?.textHeadChars, DEFAULT_TEXT_HEAD_CHARS, 100, 100_000);
}

function numberSetting(variable, fallback, preset, min, max) {
  const env = String(process.env[variable] ?? "").trim();
  const raw = Number(env !== "" ? env : fallback);
  if (Number.isInteger(raw) && raw >= min && raw <= max) return raw;
  return preset;
}

function textBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block?.type === "text" && typeof block.text === "string");
}

function toolArguments(messages) {
  const calls = new Map();
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type === "toolCall" && typeof block.id === "string") calls.set(block.id, block.arguments || {});
    }
  }
  return calls;
}

function fullPath(value, cwd) {
  const raw = String(value || "").trim();
  if (!raw || !cwd) return raw;
  try {
    return resolve(String(cwd), raw);
  } catch {
    return raw;
  }
}

function command(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 200).join("");
}

function noteFor(message, args, cwd) {
  const tool = String(message.toolName || "").toLowerCase();
  if (message.role === "bashExecution" || BASH_TOOLS.has(tool)) {
    const text = command(args?.command || message.command);
    return text ? `выдача была сокращена, консольная команда: ${text}` : "выдача была сокращена";
  }
  const path = fullPath(args?.path || args?.file_path || args?.filePath, cwd);
  if (tool === "read") return path ? `выдача была сокращена, был прочитан файл ${path}` : "выдача была сокращена";
  if (tool === "write") return path ? `выдача была сокращена, был записан файл ${path}` : "выдача была сокращена";
  if (tool === "edit") return path ? `выдача была сокращена, был изменён файл ${path}` : "выдача была сокращена";
  return tool ? `выдача была сокращена (${message.toolName})` : "выдача была сокращена";
}

function shorten(text, note, headChars) {
  const head = Array.from(text).slice(0, headChars).join("");
  return `${head.trimEnd()}\n\n${note}`;
}

export function pruneOldToolTexts(messages, limit = DEFAULT_TEXT_HISTORY_LIMIT, headChars = DEFAULT_TEXT_HEAD_CHARS, cwd = "") {
  if (!Array.isArray(messages)) return messages;
  const keep = Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_TEXT_HISTORY_LIMIT;
  const head = Number.isInteger(headChars) && headChars > 0 ? headChars : DEFAULT_TEXT_HEAD_CHARS;
  const calls = toolArguments(messages);
  let budget = keep;
  let changed = false;
  const result = messages.slice();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "bashExecution") {
      const output = typeof message.output === "string" ? message.output : "";
      if (Array.from(output).length <= head) continue;
      if (budget > 0) {
        budget -= 1;
        continue;
      }
      result[index] = { ...message, output: shorten(output, noteFor(message, undefined, cwd), head) };
      changed = true;
      continue;
    }
    if (message.role !== "toolResult") continue;
    const content = message.content;
    const texts = textBlocks(content);
    if (!texts.length) continue;
    const full = texts.map((block) => block.text).join("\n");
    if (Array.from(full).length <= head) continue;
    if (budget > 0) {
      budget -= 1;
      continue;
    }
    const note = noteFor(message, calls.get(message.toolCallId), cwd);
    const others = Array.isArray(content) ? content.filter((block) => block?.type !== "text") : [];
    result[index] = { ...message, content: [{ type: "text", text: shorten(full, note, head) }, ...others] };
    changed = true;
  }
  return changed ? result : messages;
}