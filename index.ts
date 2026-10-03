import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { installRouterProgress } from "./progress.mjs";
import { installModelRefresh } from "./models.mjs";
import { safeExtensionAPI } from "./safety.mjs";

export default function routerProgress(pi: ExtensionAPI) {
  const safePi = safeExtensionAPI(pi);
  installModelRefresh(safePi, { loadConfigured: async () => {
    try { return JSON.parse(await readFile(join(getAgentDir(), "models.json"), "utf8")).providers ?? {}; }
    catch { return {}; }
  } });
  installRouterProgress(safePi, { truncate: truncateToWidth, measure: visibleWidth });
}
