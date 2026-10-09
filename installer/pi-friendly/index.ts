import { createVoiceService } from './voice.mjs';
import { CustomEditor, SessionManager, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createProjectStore } from "./projects.mjs";
import { join } from "node:path";
import { installFriendly } from "./friendly.mjs";
export default function friendly(pi: ExtensionAPI) {
  const preferencePath = join(getAgentDir(), "friendly-ui.json");
  installFriendly(pi, { matchesKey, truncate: truncateToWidth, measure: visibleWidth,
    makeInput: () => new Input(),
    createVoice: callbacks => createVoiceService({root:join(getAgentDir(),'friendly-voice'),...callbacks}),
    makeEditor: (tui, theme, keys) => new CustomEditor(tui, theme, keys),
    listSessions: () => SessionManager.listAll(),
    projects: createProjectStore({root:join(homedir(),"Documents","AI DIY Projects"),registry:join(getAgentDir(),"friendly-projects.jsonl"),SessionManager}),
    loadPrefs: () => { try { return JSON.parse(readFileSync(preferencePath, "utf8")); } catch { return {}; } },
    savePrefs: prefs => writeFileSync(preferencePath, JSON.stringify(prefs), "utf8"),
    markdown: (text, width, palette) => {
      const color = value => s => `\x1b[38;2;${value}m${s}\x1b[39m`;
      const accent = color(palette.accent), muted = color(palette.muted);
      return new Markdown(text, 0, 0, {
        heading: accent, link: accent, linkUrl: muted, code: accent, codeBlock: s => s,
        codeBlockBorder: muted, quote: muted, quoteBorder: muted, hr: muted, listBullet: accent,
        bold: s => `\x1b[1m${s}\x1b[22m`, italic: s => `\x1b[3m${s}\x1b[23m`,
        strikethrough: s => s, underline: s => s,
      }).render(width);
    },
  });
}
