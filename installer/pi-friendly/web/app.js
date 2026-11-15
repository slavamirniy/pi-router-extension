import { createBillingUI } from "./billing-ui.js";
import { createVersionManager } from "./message-versions.js";
import { splitAttachments, buildOutgoingText } from "./attachments.js";

const billingUI = createBillingUI();
const versionManager = createVersionManager();
const $ = (id) => document.getElementById(id);

/* ============================== icons ============================== */

const paths = {
  plus: "M12 5v14M5 12h14",
  folder:
    "M3 7V5a2 2 0 0 1 2-2h4l3 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 0h9",
  wallet:
    "M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6m18 7h-5v4h5",
  moon: "M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5",
  exit: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
  search: "M21 21l-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M5 12h14M14 7l5 5-5 5",
  "arrow-up": "M12 19V5m-6 6 6-6 6 6",
  "chevron-down": "m7 10 5 5 5-5",
  "chevron-right": "m9 6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  copy: "M9 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Zm6-4H5a2 2 0 0 0-2 2v10",
  edit: "m11 4 10 10-10 1-1-10 1-1Zm0 0L7 8m8 8-4 4",
  branch:
    "M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 6a9 9 0 0 1-9 9",
  prev: "m15 18-6-6 6-6",
  next: "m9 18 6-6-6-6",
  attach:
    "m20 11-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-3 0h6",
  stop: "M7 7h10v10H7z",
  refresh: "M20 7v-4l-4 1 M20 7a8 8 0 1 0 1 9",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6",
  home: "M3 11 12 3l9 8M5 10v11h14V10",
  desktop: "M3 4h18v12H3zM8 20h8M12 16v4",
  download: "M12 3v12m-5-5 5 5 5-5M4 21h16",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  back: "M19 12H5m6-6-6 6 6 6",
  image: "M3 5h18v14H3zM8.5 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M21 15l-5-5L5 19",
  warning: "M12 3 2 21h20L12 3Zm0 6v5m0 4h.01",
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] || paths.file);
  svg.append(path);
  return svg;
}

function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll("[data-icon]")) {
    node.replaceChildren(icon(node.dataset.icon));
  }
}

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

/* ============================== state ============================== */

let page = "projects";
let projectId = null;
let catalog = [];
let catalogLoading = true;
let catalogError = "";
let state = {};
let source;
let connected = false;
let booting = true;
let pending = 0;
let operationLabel = "";
let uploading = false;
let editingIndex = null;
let openTimer;
let openToken = 0;
let pendingOpenId = null;
let openPrevious = null;
let queueCollapsed = false;
let recentProjectOpenId = null;
let recentSectionCollapsed = false;
let recentSectionTouched = false;
let renderedBranches = "";
let projectPage = 1;
let chatPage = 1;
const PROJECT_PAGE_SIZE = 10;
const CHAT_PAGE_SIZE = 10;
let editingQueueIndex = null;
let queueEditDraft = "";
let queueEditAttachments = [];
let attachments = [];
let pendingChatDelete = null;
let pendingArchivedDelete = null;
let pendingImageDelete = null;
let imageImages = [];
let imageGalleryScope = "chat";
let imageGallerySelected = null;
let imageLightboxImage = null;
let lightboxImages = [];
let lightboxIndex = 0;
let imageStudioSource = null;
let imageComposeOpen = false;
let imagePanelOpen = false;
let imageWorkspaceChatId = null;
let imageSourceUploading = false;
let panelRefs = [];
let galleryRendered = 0;
const GALLERY_BATCH = 12;
let draggingImageCard = null;
let imageJobs = [];
let imageProgressTimer = null;
let voiceTarget = "chat";
let imageRefreshPending = false;
let imageRefreshQueued = false;
try {
  queueCollapsed = localStorage.getItem("pf-queue-collapsed") === "1";
} catch {}
let searchValue = "";
let searchOpen = false;
let renderedSignature = "";
let queueSignature = "";
let lastChat;
let questionId;
let dictationId;
let modelList = [];
let modelsLoaded = false;
let modelsLoading = false;
let modelsError = "";
let modelRetryAfter = 0;
let modelSwitching = false;
let clockBase = 0;
let clockAt = 0;
let clockRequest;
let reconnectAttempts = 0;
let reconnectTimer;
let hintTimer;
let progressValue = 0;
let progressTimer;
let progressHideTimer;
let progressActive = false;
let chatClockTimer = null;
const modelMenu = el("div", null, "model-menu");
modelMenu.id = "model-menu";
modelMenu.setAttribute("popover", "auto");
modelMenu.setAttribute("role", "dialog");
modelMenu.setAttribute("aria-label", "Выбор модели");
document.body.append(modelMenu);

const draftKey = (id) => "pf-draft-" + (id || "new");
function saved(id) {
  try {
    return localStorage.getItem(draftKey(id)) || "";
  } catch {
    return "";
  }
}
function store(id, text) {
  try {
    localStorage.setItem(draftKey(id), text);
  } catch {}
}

/* ============================== utilities ============================== */

function plural(n, one, few, many) {
  const mod = n % 100;
  return (
    n +
    " " +
    (mod >= 11 && mod <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many)
  );
}
function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function projectOf(id) {
  return catalog.find((project) => project.id === id);
}
function activeProjectId() {
  return projectId || state.active?.projectId || null;
}
function branchList() {
  return projectOf(activeProjectId())?.chats || [];
}
function queueOf() {
  return state.queue || { steering: [], followUp: [] };
}

function showHint(text, error = false) {
  clearTimeout(hintTimer);
  $("ui-hint").textContent = text || "";
  $("ui-hint").hidden = !text;
  $("ui-hint").classList.toggle("error", Boolean(error));
  hintTimer = setTimeout(() => {
    $("ui-hint").hidden = true;
  }, error ? 8000 : 5000);
}
function showError(text) {
  if ($("error-text").textContent !== (text || "")) $("error").open = false;
  $("error-text").textContent = text || "";
  $("error").hidden = !text;
}

function beginTask(label) {
  pending += 1;
  if (label) operationLabel = label;
  renderProgress();
}
function endTask() {
  pending = Math.max(0, pending - 1);
  if (!pending) operationLabel = "";
  renderProgress();
  renderStatus();
}
function run(label, fn) {
  return (async () => {
    beginTask(label);
    try {
      return await fn();
    } catch (error) {
      showHint(error.message || "Не удалось выполнить действие.", true);
      return undefined;
    } finally {
      endTask();
    }
  })();
}

async function api(path, data, timeout = 30000) {
  const controller = new AbortController();
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), Math.min(timeout, 0x7fffffff)) : null;
  try {
    const response = await fetch("/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal,
    });
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error("Сервер вернул некорректный ответ.");
    }
    if (!response.ok) {
      const error = new Error(value.error || "Не удалось выполнить действие.");
      error.status = response.status;
      error.code = value.code;
      throw error;
    }
    return value;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error(timeout > 0 ? `pi не ответил за ${Math.round(timeout / 1000)} с. Попробуйте ещё раз.` : "Запрос прерван.");
    if (!navigator.onLine) throw new Error("Нет сети. Проверьте подключение.");
    if (/Failed to fetch|NetworkError|load failed/i.test(error.message))
      throw new Error("Нет соединения с pi. Убедитесь, что программа запущена.");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function canSwitch() {
  if (
    state.busy ||
    state.loading ||
    uploading ||
    ["starting", "recording", "transcribing"].includes(state.voice?.phase)
  ) {
    showHint("Дождитесь завершения действия или остановите ответ.", true);
    return false;
  }
  return true;
}

function paintProgress(value) {
  const span = $("progress-bar").querySelector("span");
  if (span) span.style.width = value + "%";
}
function startProgress() {
  if (progressActive) return;
  clearTimeout(progressHideTimer);
  progressActive = true;
  if (progressValue >= 100) progressValue = 6;
  progressValue = Math.max(progressValue, 6);
  $("progress-bar").hidden = false;
  $("progress-bar").classList.remove("done");
  paintProgress(progressValue);
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (!progressActive) return;
    // Move quickly at first, then slow down near the end.
    progressValue = Math.min(92, progressValue + Math.max(0.7, (92 - progressValue) * 0.07));
    paintProgress(progressValue);
  }, 180);
}
function stopProgress() {
  if (!progressActive) {
    $("progress-bar").hidden = true;
    return;
  }
  progressActive = false;
  clearInterval(progressTimer);
  progressValue = 100;
  $("progress-bar").classList.add("done");
  paintProgress(100);
  clearTimeout(progressHideTimer);
  progressHideTimer = setTimeout(() => {
    if (progressActive) return;
    $("progress-bar").hidden = true;
    $("progress-bar").classList.remove("done");
    progressValue = 0;
    paintProgress(0);
  }, 220);
}
function renderProgress() {
  const active = Boolean(pending || booting || state.loading || uploading);
  if (active) startProgress();
  else stopProgress();
}

/* ============================== markdown ============================== */

function appendMarkdownLink(parent, label, href) {
  const link = el("a", label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  parent.append(link);
}

function trimLinkTail(value) {
  let href = value;
  let tail = "";
  while (/[.,;:!?]$/.test(href)) {
    tail = href.slice(-1) + tail;
    href = href.slice(0, -1);
  }
  while (href.endsWith(")") && (href.match(/\(/g) || []).length < (href.match(/\)/g) || []).length) {
    tail = ")" + tail;
    href = href.slice(0, -1);
  }
  return { href, tail };
}

function inlineMarkdown(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"'`]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("`")) {
      const inner = token.slice(1, -1);
      if (/^https?:\/\//i.test(inner)) appendMarkdownLink(parent, inner, inner);
      else parent.append(el("code", inner));
    } else if (token.startsWith("**")) {
      parent.append(el("strong", token.slice(2, -2)));
    } else if (token.startsWith("[")) {
      const parsed = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (parsed) appendMarkdownLink(parent, parsed[1], parsed[2]);
    } else {
      const { href, tail } = trimLinkTail(token);
      appendMarkdownLink(parent, href, href);
      if (tail) parent.append(document.createTextNode(tail));
    }
    last = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(last)));
}

function markdown(parent, text) {
  let code = null;
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (!paragraph.length) return;
    const p = el("p");
    inlineMarkdown(p, paragraph.join("\n"));
    parent.append(p);
    paragraph = [];
  };
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("```")) {
      flush();
      list = null;
      if (code) {
        parent.append(code);
        code = null;
      } else {
        code = el("pre");
        code.textContent = "";
      }
      continue;
    }
    if (code) {
      code.textContent += line + "\n";
      continue;
    }
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    const item = /^\s*(?:([-*+])|\d+[.)])\s+(.*)/.exec(line);
    if (heading) {
      flush();
      list = null;
      const node = el("h" + Math.min(4, heading[1].length + 1));
      inlineMarkdown(node, heading[2]);
      parent.append(node);
      continue;
    }
    if (item) {
      flush();
      const tag = item[1] ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = el(tag);
        if (tag === "ol") list.start = parseInt(line, 10) || 1;
        parent.append(list);
      }
      const li = el("li");
      inlineMarkdown(li, item[2]);
      list.append(li);
      continue;
    }
    list = null;
    paragraph.push(line);
  }
  flush();
  if (code) parent.append(code);
}

/* ============================== boot / events ============================== */

async function loadCatalog() {
  catalogLoading = true;
  renderProgress();
  let failure;
  try {
    const data = await api("catalog", undefined, 30000);
    catalog = data.projects || [];
    catalogError = "";
  } catch (error) {
    catalogError = error.message;
    failure = error;
  } finally {
    catalogLoading = false;
    renderProgress();
  }
  if (page === "projects" || page === "chats") {
    const search = $("list-search");
    if (!search || document.activeElement !== search) renderRoute();
  } else {
    renderBranches();
  }
  if (failure) throw failure;
}

function connectEvents() {
  clearTimeout(reconnectTimer);
  if (source) source.close();
  source = new EventSource("/api/events");
  source.onopen = () => {
    connected = true;
    reconnectAttempts = 0;
    booting = false;
    renderConnection();
    renderProgress();
    renderStatus();
  };
  source.onmessage = (event) => {
    let next;
    try {
      next = JSON.parse(event.data);
    } catch {
      return;
    }
    applyState(next);
  };
  source.onerror = () => {
    connected = false;
    reconnectAttempts += 1;
    renderConnection();
    renderStatus();
    if (reconnectAttempts >= 2) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectEvents, 2500);
    }
  };
}

function renderConnection() {
  const node = $("connection");
  node.hidden = connected;
  node.classList.toggle("offline", !connected);
  node.classList.toggle("error", !connected && reconnectAttempts > 4);
  if (connected) return;
  node.replaceChildren(
    el("span", null, "dot"),
    document.createTextNode(
      reconnectAttempts
        ? reconnectAttempts > 4
          ? "Нет связи с pi"
          : "Переподключение…"
        : "Подключение…",
    ),
  );
}

async function boot() {
  hydrateIcons();
  wireChrome();
  renderRoute();
  renderProgress();
  beginTask("Подключаюсь к pi…");
  try {
    const token = location.hash.slice(1);
    if (token) {
      await api("auth", { token }, 15000);
      history.replaceState(null, "", location.pathname);
    }
    await loadCatalog();
  } catch (error) {
    catalogError = error.message;
    showHint(error.message, true);
    renderRoute();
  } finally {
    booting = false;
    endTask();
  }
  connectEvents();
}

/* ============================== chrome ============================== */

function wireChrome() {
  $("nav-projects").onclick = () => {
    if (page !== "chat" && state.active) returnToChat();
    else navigate("projects");
  };
  $("return-chat").onclick = () => returnToChat();
  $("recent-section-toggle").onclick = (event) => {
    event.stopPropagation();
    recentSectionTouched = true;
    recentSectionCollapsed = !recentSectionCollapsed;
    if (recentSectionCollapsed) recentProjectOpenId = null;
    renderBranches();
  };
  setTimeout(() => {
    if (recentSectionTouched || recentSectionCollapsed || !state.active) return;
    recentSectionCollapsed = true;
    recentProjectOpenId = null;
    renderBranches();
  }, 4500);
  $("theme").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("exit").onclick = () => {
    if (!$("exit").disabled) $("exit-dialog").showModal();
  };
  $("cancel-exit").onclick = () => $("exit-dialog").close();
  $("confirm-exit").onclick = () =>
    run("Завершаю работу…", async () => {
      await api("close", {}, 15000);
      source?.close();
      connected = false;
      $("exit-dialog").close();
      $("connection").textContent = "Работа завершена";
      $("connection").hidden = false;
      renderStatus();
      showHint("pi завершён. Вкладку можно закрыть.");
      setTimeout(() => window.close(), 250);
    });
  $("billing-open").setAttribute("aria-label", "Баланс и пополнение");
  const brand = document.querySelector(".brand");
  brand.onclick = (event) => {
    event.preventDefault();
    navigate("projects");
  };
  $("image-open").onclick = () => openImagePanel();
  $("image-gallery-open").onclick = () => openImagePanel();
  $("image-compose-back").onclick = () => closeImageCompose();
  $("image-compose-gallery").onclick = () => {
    closeImageCompose();
    openImagePanel();
  };
  $("image-ref-add").onclick = (event) => {
    event.stopPropagation();
    toggleSourceMenu();
  };
  $("image-source-pc").onclick = () => {
    closeSourceMenu();
    $("image-file-input").click();
  };
  $("image-source-generated").onclick = async () => {
    await refreshImageLibrary();
    renderSourceMenuGallery();
  };
  $("image-file-input").onchange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadImageSource(file, "compose");
  };
  const resizeImagePrompt = () => {
    const area = $("image-prompt");
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
  };
  $("image-prompt").oninput = () => {
    resizeImagePrompt();
    updateImageGenerateButton();
  };
  $("image-prompt").onkeydown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!$("image-generate").disabled) generateImages();
  };
  $("image-generate").onclick = () => generateImages();
  $("panel-prompt-form").onsubmit = (event) => {
    event.preventDefault();
    if (!$("panel-generate").disabled) generatePanelImage();
  };
  $("panel-prompt").oninput = () => {
    const area = $("panel-prompt");
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
    updatePanelGenerateButton();
  };
  $("panel-prompt").onkeydown = (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!$("panel-generate").disabled) generatePanelImage();
  };
  $("panel-ref-add").onclick = () => $("panel-file-input").click();
  $("panel-file-input").onchange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadImageSource(file, "panel");
  };
  $("gallery-close").onclick = () => closeImagePanel();
  $("gallery-chat").onclick = () => {
    imageGalleryScope = "chat";
    imageGallerySelected = null;
    renderGallery({ reset: true });
  };
  $("gallery-project").onclick = () => {
    imageGalleryScope = "project";
    imageGallerySelected = null;
    renderGallery({ reset: true });
  };
  $("gallery-back").onclick = () => showGalleryGrid();
  $("gallery-edit").onclick = () => {
    if (!imageGallerySelected) return;
    const source = imageGallerySelected;
    closeImageLightbox();
    openImagePanel();
    panelRefs = normalizeImageSource(source) ? [normalizeImageSource(source)] : [];
    renderPanelRefs();
    $("panel-prompt").focus();
  };
  $("gallery-copy").onclick = () => {
    if (imageGallerySelected) copyText(imageGallerySelected.path);
  };
  document.addEventListener("click", (event) => {
    if ($("image-source-menu").hidden) return;
    if (event.target.closest(".image-ref-add-wrap")) return;
    closeSourceMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("image-source-menu").hidden) closeSourceMenu();
  });
  const imageDropData = (event) => {
    const path = event.dataTransfer.getData("application/x-pf-image") || event.dataTransfer.getData("text/plain");
    if (!path) return null;
    return imageImages.find((image) => image.path === path) || { path, name: imageName(path) };
  };
  const showPanelDropHint = () => {
    const hint = $("panel-drop-hint");
    if (hint) hint.hidden = false;
  };
  const hidePanelDropHint = () => {
    const hint = $("panel-drop-hint");
    if (hint) hint.hidden = true;
  };
  const wireImageDrop = (zone, target) => {
    if (!zone) return;
    const highlight = () => $("panel-refs-drop")?.classList.add("drop-target");
    const clear = () => $("panel-refs-drop")?.classList.remove("drop-target");
    const reveal = () => {
      if (target === "panel") showPanelDropHint();
    };
    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      event.stopPropagation();
      $("drop-overlay").hidden = true;
      reveal();
      highlight();
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      reveal();
      highlight();
    });
    zone.addEventListener("dragleave", (event) => {
      if (zone.contains(event.relatedTarget)) return;
      clear();
      if (target === "panel" && !$("image-panel").contains(event.relatedTarget)) hidePanelDropHint();
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      $("drop-overlay").hidden = true;
      clear();
      if (target === "panel") hidePanelDropHint();
      const file = [...(event.dataTransfer.files || [])].find((item) => /^image\/(png|jpeg)/.test(item.type));
      if (file) {
        uploadImageSource(file, target);
        return;
      }
      const image = imageDropData(event);
      if (image) {
        if (target === "panel") addPanelRef(image);
        else setImageSource(image);
      }
    });
  };
  wireImageDrop($("panel-refs-drop"), "panel");
  wireImageDrop($("panel-prompt-form"), "panel");
  wireImageDrop(document.querySelector(".compose-ref-row"), "compose");
  const panel = $("image-panel");
  const panelDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    $("drop-overlay").hidden = true;
    showPanelDropHint();
  };
  panel.addEventListener("dragenter", panelDragOver);
  panel.addEventListener("dragover", panelDragOver);
  panel.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) return;
    hidePanelDropHint();
  });
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    $("drop-overlay").hidden = true;
    hidePanelDropHint();
    const file = [...(event.dataTransfer.files || [])].find((item) => /^image\/(png|jpeg)/.test(item.type));
    if (file) {
      uploadImageSource(file, "panel");
      return;
    }
    const image = imageDropData(event);
    if (image) {
      const targetCard = event.target.closest?.(".gallery-card") || null;
      if (targetCard && targetCard === draggingImageCard) return;
      addPanelRef(image);
    }
  });
  $("gallery-grid").onscroll = () => {
    const grid = $("gallery-grid");
    if (!imagePanelOpen || imageGallerySelected || grid.hidden) return;
    if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 160) appendGalleryBatch();
  };
  $("lightbox-close").onclick = () => closeImageLightbox();
  $("lightbox-prev").onclick = (event) => {
    event.stopPropagation();
    showLightboxAt(lightboxIndex - 1);
  };
  $("lightbox-next").onclick = (event) => {
    event.stopPropagation();
    showLightboxAt(lightboxIndex + 1);
  };
  $("lightbox-stage").onclick = (event) => {
    if (event.target === $("lightbox-stage")) closeImageLightbox();
  };
  $("image-lightbox").onclick = (event) => {
    if (event.target === $("image-lightbox")) closeImageLightbox();
  };
  $("lightbox-copy").onclick = () => {
    if (imageLightboxImage) copyText(imageLightboxImage.path);
  };
  $("lightbox-edit").onclick = () => {
    if (!imageLightboxImage) return;
    const image = imageLightboxImage;
    closeImageLightbox();
    openImagePanel();
    const ref = normalizeImageSource(image);
    panelRefs = ref ? [ref] : [];
    renderPanelRefs();
    $("panel-prompt").focus();
  };
  $("lightbox-delete").onclick = () => {
    if (!imageLightboxImage) return;
    pendingImageDelete = { project: activeProjectId(), image: imageLightboxImage };
    pendingChatDelete = null;
    pendingArchivedDelete = null;
    $("chat-confirm-title").textContent = "Удалить изображение?";
    $("chat-confirm-text").textContent = `«${imageName(imageLightboxImage.path)}» будет удалено из проекта.`;
    $("chat-confirm").showModal();
  };
  $("gallery-delete").onclick = () => {
    if (!imageGallerySelected) return;
    pendingImageDelete = { project: activeProjectId(), image: imageGallerySelected };
    pendingChatDelete = null;
    pendingArchivedDelete = null;
    $("chat-confirm-title").textContent = "Удалить изображение?";
    $("chat-confirm-text").textContent = `«${imageName(imageGallerySelected.path)}» будет удалено из проекта.`;
    $("chat-confirm").showModal();
  };
  $("composer").onsubmit = (event) => {
    event.preventDefault();
    const text = $("draft").value;
    if (!text.trim() && !attachments.length) return;
    if (state.busy) queueMessage(text);
    else sendMessage(text);
  };
  $("draft").oninput = () => {
    store(state.active?.id, $("draft").value);
    autoGrow();
    renderStatus();
  };
  $("draft").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (state.voice?.phase === "recording")
        run("Завершаю запись…", () => api("voice", { chat: state.active?.id }, 20000));
      else if (state.busy) queueMessage($("draft").value);
      else $("composer").requestSubmit();
    }
  };
  $("send").onclick = (event) => {
    event.preventDefault();
    if (state.busy) abortGeneration();
    else $("composer").requestSubmit();
  };
  $("model-select").onclick = () => {
    positionModels();
    modelMenu.togglePopover();
  };
  modelMenu.addEventListener("toggle", () => {
    $("model-select").setAttribute("aria-expanded", String(modelMenu.matches(":popover-open")));
    if (modelMenu.matches(":popover-open")) loadModels();
  });
  $("attach").onclick = () => {
    if (!$("attach").disabled) pickAttachments();
  };
  const toggleVoice = (target) => {
    voiceTarget = target;
    return run("Переключаю микрофон…", async () => {
      if (["installing", "downloading", "loading"].includes(state.voice?.phase)) {
        $("voice-setup").classList.add("highlight");
        setTimeout(() => $("voice-setup").classList.remove("highlight"), 2500);
        throw new Error("Дождитесь загрузки голосовой модели.");
      }
      await api("voice", { chat: state.active?.id }, 20000);
    });
  };
  $("mic").onclick = () => toggleVoice("chat");
  $("panel-mic").onclick = () => toggleVoice("panel");
  const collapseRecent = (target) => {
    if (!recentProjectOpenId) return;
    if (target && $("recent-projects").contains(target)) return;
    recentProjectOpenId = null;
    renderBranches();
  };
  document.addEventListener("click", (event) => collapseRecent(event.target));
  document.addEventListener("focusin", (event) => {
    if (event.target === document.body) return;
    collapseRecent(event.target);
  });
  document.addEventListener("pointerdown", (event) => collapseRecent(event.target), true);
  document.addEventListener("keydown", (event) => {
    if (!$("image-lightbox").hidden) {
      if (event.key === "Escape") closeImageLightbox();
      else if (event.key === "ArrowLeft") showLightboxAt(lightboxIndex - 1);
      else if (event.key === "ArrowRight") showLightboxAt(lightboxIndex + 1);
      else return;
      event.preventDefault();
      return;
    }
    if (
      event.key === "Escape" &&
      state.busy &&
      !$("draft").value.trim() &&
      !state.questions?.length &&
      !document.querySelector("dialog[open]")
    ) {
      abortGeneration();
    }
  });
  window.addEventListener("resize", () => {
    if (modelMenu.matches(":popover-open")) positionModels();
  });
  window.addEventListener("beforeunload", () => store(state.active?.id, $("draft").value));

  $("folder-path-form").onsubmit = (event) => {
    event.preventDefault();
    browseFolders($("folder-path").value);
  };
  $("open-archive").onclick = () => openArchive();
  $("archive-close").onclick = () => $("archive-dialog").close();
  $("archive-cancel").onclick = () => $("archive-dialog").close();
  $("chat-confirm-cancel").onclick = () => {
    $("chat-confirm").close();
    pendingChatDelete = null;
    pendingArchivedDelete = null;
    pendingImageDelete = null;
  };
  $("chat-confirm-ok").onclick = () => confirmDeleteChat();
  $("chat-confirm").addEventListener("close", () => {
    pendingChatDelete = null;
    pendingArchivedDelete = null;
    pendingImageDelete = null;
  });
  $("folder-close").onclick = () => $("folder-dialog").close();
  $("folder-cancel").onclick = () => $("folder-dialog").close();
  $("folder-choose").onclick = () => chooseFolder();
  $("folder-dialog").addEventListener("close", () => {
    browserRequest += 1;
    browserChosen = null;
  });

  try {
    setTheme(localStorage.getItem("pf-theme") || "light", false);
  } catch {
    setTheme("light", false);
  }
  renderAttachments();
  wireDropZone();
}

function setTheme(value, persist = true) {
  document.documentElement.dataset.theme = value;
  const dark = value === "dark";
  $("theme").replaceChildren(icon(dark ? "sun" : "moon"));
  $("theme").title = dark ? "Светлая тема" : "Тёмная тема";
  $("theme").setAttribute("aria-label", $("theme").title);
  if (persist) {
    try {
      localStorage.setItem("pf-theme", value);
    } catch {}
  }
}

/* ============================== navigation ============================== */

function navigate(target) {
  if (pending && target === "projects" && state.loading) return;
  store(state.active?.id, $("draft").value);
  searchValue = "";
  searchOpen = false;
  if (target === "projects") {
    projectId = null;
    projectPage = 1;
    page = "projects";
    renderRoute();
    loadCatalog().catch(() => {});
    return;
  }
  if (target === "new") return newBranch();
  page = target;
  renderRoute();
}

function openProject(project) {
  projectId = project.id;
  recentSectionCollapsed = true;
  recentProjectOpenId = null;
  chatPage = 1;
  page = "chats";
  searchValue = "";
  searchOpen = false;
  renderRoute();
  api("open-project", { project: project.id }, 30000).catch(() => {});
}

function openBranch(chat) {
  if (state.busy) {
    showHint("Остановите ответ, чтобы переключить чат.", true);
    return;
  }
  recentSectionCollapsed = true;
  recentProjectOpenId = null;
  if (!pendingOpenId) openPrevious = { page, state };
  const previous = openPrevious;
  const token = ++openToken;
  pendingOpenId = chat.id;
  clearTimeout(openTimer);
  store(state.active?.id, $("draft").value);

  const project = projectOf(activeProjectId());
  page = "chat";
  editingIndex = null;
  renderedSignature = "";
  state = {
    ...state,
    active: {
      id: chat.id,
      projectId: project?.id || activeProjectId(),
      projectName: project?.name || state.active?.projectName || "",
      name: chat.name || "Чат",
      sessionId: chat.sessionId,
      host: false,
      readOnly: false,
      named: Boolean(chat.named),
      ready: false,
    },
    loading: true,
    messages: [],
    error: null,
  };
  $("draft").value = saved(chat.id);
  autoGrow();
  renderRoute();
  void refreshImageLibrary();

  // Fast path: file history is returned without starting pi.
  api("history", { chat: chat.id }, 15000)
    .then((result) => {
      if (token !== openToken) return;
      state = { ...state, loading: false, messages: result.messages || [], ready: false };
      renderChat();
    })
    .catch(() => {});

  openTimer = setTimeout(() => {
    if (token !== openToken) return;
    api("open", { id: chat.id, fast: true }, 45000)
      .then((next) => {
        if (token !== openToken) return;
        applyState(next);
        pendingOpenId = null;
        openPrevious = null;
        page = "chat";
        editingIndex = null;
        loadCatalog().catch(() => {});
        renderRoute();
        $("draft").focus();
      })
      .catch((error) => {
        if (token !== openToken) return;
        pendingOpenId = null;
        openPrevious = null;
        if (previous) {
          state = previous.state;
          page = previous.page;
        }
        renderRoute();
        showHint(error.message, true);
      });
  }, 150);
}

function newBranch() {
  const target = activeProjectId();
  if (!target) {
    showHint("Сначала выберите проект.");
    return;
  }
  if (!canSwitch()) return;
  recentSectionCollapsed = true;
  recentProjectOpenId = null;
  run("Создаю чат…", async () => {
    const next = await api("new-chat", { project: target, fast: true }, 45000);
    applyState(next);
    page = "chat";
    projectId = next.active?.projectId || target;
    editingIndex = null;
    $("draft").value = "";
    store(next.active?.id, "");
    loadCatalog().catch(() => {});
    renderRoute();
    autoGrow();
    $("draft").focus();
    showHint("Новый чат создан.");
  });
}

function openCreateProject() {
  if (!canSwitch()) return;
  page = "create";
  renderRoute();
}

async function openFolderDialog() {
  if (!canSwitch()) return;
  browserChosen = null;
  $("folder-choose").disabled = true;
  $("folder-dialog").showModal();
  await browseFolders(browserPath);
}

/* ============================== branches ============================== */

function returnToChat() {
  if (!state.active) return;
  const project = projectOf(state.active.projectId);
  if (project) projectId = project.id;
  page = "chat";
  renderRoute();
}

function renderReturnChat() {
  const separate = $("return-chat");
  separate.hidden = true;
  const nav = $("nav-projects");
  if (!nav) return;
  const returning = Boolean(state.active) && page !== "chat";
  nav.classList.toggle("returning", returning);
  const iconBox = nav.querySelector(".nav-icon");
  const text = nav.querySelector(".nav-text");
  if (iconBox) iconBox.replaceChildren(icon(returning ? "back" : "folder"));
  if (text) text.textContent = returning ? "Вернуться в чат" : "Проекты";
  nav.title = returning ? `Вернуться к чату: ${state.active.name || "текущий чат"}` : "Проекты";
  nav.setAttribute("aria-label", nav.title);
}

function renderRecentProjects() {
  const panel = $("recent-projects");
  const list = $("recent-project-list");
  const currentId = activeProjectId();
  const current = projectOf(currentId);
  let projects = current
    ? catalog.filter((project) => project.id !== currentId).slice(0, 3)
    : catalog.slice(0, 3);
  const openProjectEntry = catalog.find((project) => project.id === recentProjectOpenId) || null;
  if (openProjectEntry && openProjectEntry.id !== currentId && !projects.some((project) => project.id === openProjectEntry.id)) {
    projects = [...projects, openProjectEntry];
  }
  panel.hidden = false;
  const toggle = $("recent-section-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!recentSectionCollapsed));
    toggle.classList.toggle("collapsed", recentSectionCollapsed);
  }
  list.hidden = recentSectionCollapsed;
  list.replaceChildren();
  const create = el("button", null, "recent-project recent-create");
  create.type = "button";
  create.title = "Создать новый проект";
  create.append(icon("plus"), el("span", "Создать проект", "recent-project-name"));
  create.onclick = () => openCreateProject();
  list.append(create);
  if (!projects.length) return;

  const chatButton = (project, chat) => {
    const row = el("button", null, "recent-chat" + (chat.id === state.active?.id ? " active" : ""));
    row.type = "button";
    row.title = chat.name || "Чат";
    row.append(icon("branch"), el("span", chat.name || "Новый чат", "recent-chat-name"));
    row.onclick = (event) => {
      event.stopPropagation();
      projectId = project.id;
      recentProjectOpenId = project.id;
      openBranch(chat);
    };
    return row;
  };

  const projectBlock = (project) => {
    const block = el("div", null, "recent-project-block");
    const expanded = recentProjectOpenId === project.id;
    const active = project.id === currentId;
    const row = el("button", null, "recent-project" + (active ? " active" : "") + (expanded ? " expanded" : ""));
    row.type = "button";
    row.title = project.name;
    row.append(icon("folder"), el("span", project.name, "recent-project-name"), icon("chevron-down"));
    row.lastChild.classList.add("recent-chevron");
    row.onclick = (event) => {
      event.stopPropagation();
      recentSectionTouched = true;
      recentProjectOpenId = recentProjectOpenId === project.id ? null : project.id;
      renderBranches();
    };
    block.append(row);
    if (!expanded) return block;

    const nested = el("div", null, "recent-chats");
    const add = el("button", null, "recent-chat recent-chat-create");
    add.type = "button";
    add.title = "Создать чат в проекте";
    add.append(icon("plus"), el("span", "Создать чат", "recent-chat-name"));
    add.onclick = (event) => {
      event.stopPropagation();
      projectId = project.id;
      recentProjectOpenId = project.id;
      newBranch();
    };
    nested.append(add);

    const chats = [...(project.chats || [])]
      .sort((a, b) => Number(b.modified || 0) - Number(a.modified || 0))
      .slice(0, 3);
    if (!chats.length) nested.append(el("div", "Пока нет чатов", "recent-chats-empty"));
    for (const chat of chats) nested.append(chatButton(project, chat));

    const all = el("button", null, "recent-chat recent-chat-all");
    all.type = "button";
    all.title = "Все чаты проекта";
    all.append(el("span", "Все чаты", "recent-chat-name"), icon("arrow"));
    all.onclick = (event) => {
      event.stopPropagation();
      recentProjectOpenId = null;
      openProject(project);
    };
    nested.append(all);
    block.append(nested);
    return block;
  };

  for (const project of projects) list.append(projectBlock(project));
}
function renderBranches() {
  const project = projectOf(activeProjectId());
  const signature = JSON.stringify([
    page,
    project?.id || null,
    project?.name || null,
    (project?.chats || []).map((chat) => [chat.id, chat.name, chat.count, chat.terminal]),
    catalog.map((item) => [item.id, item.name]),
    state.active?.id || null,
    state.active?.name || null,
    Boolean(state.busy),
    recentProjectOpenId,
    recentSectionCollapsed,
  ]);
  if (signature === renderedBranches) return;
  renderedBranches = signature;
  renderReturnChat();
  renderRecentProjects();
  const panel = $("branches-panel");
  if (!project) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const list = $("branch-list");
  list.replaceChildren();
  const create = el("button", null, "branch-row branch-create");
  create.type = "button";
  create.title = "Создать новый чат";
  create.disabled = Boolean(state.busy);
  create.append(icon("plus"), el("span", "Создать чат", "branch-name"));
  create.onclick = () => newBranch();
  list.append(create);
  for (const chat of project.chats || []) {
    const active = chat.id === state.active?.id;
    const row = el("div", null, "branch-row has-actions" + (active ? " active" : ""));
    row.setAttribute("role", "listitem");
    const open = el("button", null, "branch-open");
    open.type = "button";
    open.disabled = Boolean(state.busy) && !active;
    open.title = open.disabled
      ? "Остановите ответ, чтобы переключить чат"
      : chat.name || "Чат";
    const branchIcon = icon("branch");
    branchIcon.classList.add("branch-icon");
    const copy = el("span", null, "branch-copy");
    copy.append(el("span", chat.name || "Новый чат", "branch-name"));
    open.append(branchIcon, copy);
    open.onclick = () => {
      if (active) {
        if (page !== "chat") {
          page = "chat";
          renderRoute();
        }
        return;
      }
      openBranch(chat);
    };
    const actions = el("div", null, "branch-actions");
    const archive = iconAction("archive", "Архивировать", () => archiveChat(chat), "branch-action");
    archive.disabled = Boolean(state.busy) || chat.terminal;
    const remove = iconAction("trash", "Удалить", () => deleteChat(chat), "branch-action danger");
    remove.disabled = Boolean(state.busy) || chat.terminal;
    actions.append(archive, remove);
    row.append(open, actions);
    list.append(row);
  }
}

function archiveChat(chat) {
  if (state.busy) {
    showHint("Сначала остановите ответ.", true);
    return;
  }
  const projectIdBefore = activeProjectId();
  const wasActive = chat.id === state.active?.id;
  run("Архивирую чат…", async () => {
    const result = await api("archive-chat", { chat: chat.id }, 30000);
    catalog = result.projects || catalog;
    if (wasActive) {
      state = { ...state, active: null, messages: [], busy: false };
      projectId = projectIdBefore;
      page = "chats";
    }
    renderRoute();
    showHint("Чат перемещён в архив.");
  });
}

function deleteChat(chat) {
  if (state.busy) {
    showHint("Сначала остановите ответ.", true);
    return;
  }
  pendingChatDelete = chat;
  pendingArchivedDelete = null;
  pendingImageDelete = null;
  $("chat-confirm-title").textContent = "Удалить чат?";
  $("chat-confirm-text").textContent = `«${chat.name || "Чат"}» будет удалён вместе с файлом переписки. Это действие нельзя отменить.`;
  $("chat-confirm").showModal();
}

function confirmDeleteChat() {
  if (pendingImageDelete) {
    const item = pendingImageDelete;
    pendingImageDelete = null;
    $("chat-confirm").close();
    run("Удаляю изображение…", async () => {
      await api("image-delete", { project: item.project, path: item.image.path }, 30000);
      imageGallerySelected = null;
      closeImageLightbox();
      await refreshImageLibrary();
      renderGallery();
      showHint("Изображение удалено.");
    });
    return;
  }
  if (pendingArchivedDelete) {
    const archived = pendingArchivedDelete;
    pendingArchivedDelete = null;
    $("chat-confirm").close();
    run("Удаляю из архива…", async () => {
      await api("delete-archived", { project: archived.project, id: archived.id }, 30000);
      await loadArchived(archived.project);
      showHint("Чат удалён из архива.");
    });
    return;
  }
  const chat = pendingChatDelete;
  if (!chat) return;
  $("chat-confirm").close();
  pendingChatDelete = null;
  const projectIdBefore = activeProjectId();
  const wasActive = chat.id === state.active?.id;
  run("Удаляю чат…", async () => {
    const result = await api("delete-chat", { chat: chat.id }, 30000);
    catalog = result.projects || catalog;
    if (wasActive) {
      state = { ...state, active: null, messages: [], busy: false };
      projectId = projectIdBefore;
      page = "chats";
    }
    renderRoute();
    showHint("Чат удалён.");
  });
}

function openArchive() {
  const project = activeProjectId();
  if (!project) {
    showHint("Сначала выберите проект.", true);
    return;
  }
  $("archive-dialog").showModal();
  loadArchived(project);
}

async function loadArchived(project) {
  const status = $("archive-status");
  const list = $("archive-list");
  status.textContent = "Загружаю архив…";
  list.replaceChildren();
  try {
    const result = await api("archived", { project }, 30000);
    renderArchived(result.chats || [], project);
  } catch (error) {
    status.textContent = error.message;
  }
}

function renderArchived(chats, project) {
  const status = $("archive-status");
  const list = $("archive-list");
  status.textContent = chats.length
    ? "Восстановите чат или удалите его из архива."
    : "Архив пуст.";
  list.replaceChildren();
  for (const chat of chats) {
    const row = el("div", null, "archive-row");
    const iconBox = el("span", null, "archive-icon");
    iconBox.append(icon("archive"));
    const copy = el("span", null, "archive-copy");
    copy.append(el("strong", chat.name || "Чат", "archive-name"));
    copy.append(
      el(
        "span",
        `${plural(chat.count || 0, "сообщение", "сообщения", "сообщений")} · ${dateLabel(chat.modified)}`,
        "archive-meta",
      ),
    );
    const actions = el("div", null, "archive-actions");
    actions.append(
      iconAction("refresh", "Восстановить чат", () => restoreArchived(project, chat.id), "archive-action"),
      iconAction("trash", "Удалить из архива", () => {
        pendingArchivedDelete = { id: chat.id, name: chat.name, project };
        pendingChatDelete = null;
        pendingImageDelete = null;
        $("chat-confirm-title").textContent = "Удалить из архива?";
        $("chat-confirm-text").textContent = `«${chat.name || "Чат"}» будет удалён из архива навсегда.`;
        $("chat-confirm").showModal();
      }, "archive-action danger"),
    );
    row.append(iconBox, copy, actions);
    list.append(row);
  }
}

function restoreArchived(project, id) {
  run("Восстанавливаю чат…", async () => {
    await api("restore-archived", { project, id }, 30000);
    await loadCatalog();
    await loadArchived(project);
    renderRoute();
    showHint("Чат восстановлен.");
  });
}

/* ============================== page rendering ============================== */

function setBreadcrumb(title) {
  $("breadcrumb").textContent = title;
}

function renderRoute() {
  if (page === "chat" && !state.active) page = "chats";
  if (page !== "projects" && page !== "chats") hideFloatingPager();
  updateImageBadge();
  const chatPage = page === "chat" && state.active;
  $("page").hidden = chatPage;
  renderImageWorkspace(chatPage);
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.nav === "projects" && ["projects", "chats", "create"].includes(page),
    );
  });
  renderBranches();
  if (chatPage) {
    const project = projectOf(state.active.projectId || projectId);
    setBreadcrumb(state.active.name || "Чат");
    renderChat();
    return;
  }
  if (page === "create") {
    setBreadcrumb("Новый проект");
    renderCreatePage();
    return;
  }
  if (page === "chats") {
    const project = projectOf(projectId);
    setBreadcrumb(project?.name || "Проект");
    renderChatsPage(project);
    return;
  }
  setBreadcrumb("Проекты");
  renderProjectsPage();
}

function pageShell(title, subtitle, toolbar) {
  const root = el("div", null, "page-inner");
  const head = el("div", null, "page-head");
  const copy = el("div");
  copy.append(el("h1", title));
  if (subtitle) copy.append(el("p", subtitle, "page-sub"));
  head.append(copy);
  root.append(head);
  if (toolbar) root.append(toolbar);
  $("page").replaceChildren(root);
  return root;
}

function searchField(placeholder, onInput) {
  const input = el("input", null, "search");
  input.type = "search";
  input.id = "list-search";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  input.value = searchValue;
  input.oninput = () => {
    searchValue = input.value;
    onInput(input.value);
  };
  input.onkeydown = (event) => {
    if (event.key === "Escape") {
      searchOpen = false;
      input.hidden = true;
      renderRoute();
    }
  };
  return input;
}

function pager(total, page, limit, onPage, cls = "pager") {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  const current = Math.min(Math.max(1, page), pages);
  const bar = el("div", null, cls);
  const prev = el("button", null, "pager-button");
  prev.type = "button";
  prev.title = "Предыдущая страница";
  prev.setAttribute("aria-label", "Предыдущая страница");
  prev.append(icon("prev"), el("span", "Назад"));
  prev.disabled = current <= 1;
  prev.onclick = () => onPage(current - 1);
  const next = el("button", null, "pager-button");
  next.type = "button";
  next.title = "Следующая страница";
  next.setAttribute("aria-label", "Следующая страница");
  next.append(el("span", "Вперёд"), icon("next"));
  next.disabled = current >= pages;
  next.onclick = () => onPage(current + 1);
  bar.append(prev, el("span", `Страница ${current} из ${pages}`, "pager-info"), next);
  return bar;
}

function hideFloatingPager() {
  const host = $("floating-pager");
  host.hidden = true;
  host.replaceChildren();
  $("page").classList.remove("with-pager");
}

function renderFloatingPager(total, page, limit, onPage) {
  const host = $("floating-pager");
  const bar = pager(total, page, limit, onPage);
  if (!bar) {
    hideFloatingPager();
    return;
  }
  host.replaceChildren(bar);
  host.hidden = false;
  $("page").classList.add("with-pager");
}

function listToolbar(placeholder, renderList, { create = null, folder = null, branch = null } = {}) {
  const toolbar = el("div", null, "toolbar");
  const search = searchField(placeholder, renderList);
  search.hidden = !searchOpen;
  const toggle = el("button", null, "button search-toggle");
  toggle.type = "button";
  toggle.append(icon("search"));
  toggle.title = "Поиск";
  toggle.setAttribute("aria-label", "Поиск");
  toggle.setAttribute("aria-expanded", String(searchOpen));
  toggle.onclick = () => {
    searchOpen = !searchOpen;
    search.hidden = !searchOpen;
    toggle.setAttribute("aria-expanded", String(searchOpen));
    if (searchOpen) search.focus();
    else {
      searchValue = "";
      search.value = "";
      renderList("");
      toggle.focus();
    }
  };
  toolbar.append(search);
    if (folder) {
      const button = el("button", null, "button ghost");
      button.type = "button";
      button.append(icon("folder"), el("span", "Выбрать папку"));
      button.onclick = () => openFolderDialog();
      toolbar.append(button);
    }
    const actions = el("div", null, "list-actions");
  actions.style.display = "flex";
  actions.style.gap = "6px";
  actions.append(toggle);
  if (branch) {
    const button = el("button", null, "button primary");
    button.type = "button";
    button.append(icon("plus"), el("span", "Новый чат"));
    button.disabled = Boolean(state.busy);
    button.onclick = () => newBranch();
    actions.append(button);
  }
  if (create) {
    const button = el("button", null, "button primary");
    button.type = "button";
    button.append(icon("plus"), el("span", "Новый проект"));
    button.onclick = create.run;
    actions.append(button);
  }
  toolbar.append(actions);
  return { toolbar, search };
}

function skeletonList(rows = 4) {
  const list = el("div", null, "skeleton-list");
  for (let index = 0; index < rows; index += 1) {
    const row = el("div", null, "skeleton-row");
    const block = el("span", null, `skeleton w-${index % 2 ? 60 : 40}`);
    const meta = el("span", null, "skeleton w-40");
    meta.style.marginLeft = "auto";
    row.append(block, meta);
    list.append(row);
  }
  return list;
}

function emptyState(title, text, action) {
  const empty = el("div", null, "empty");
  empty.append(el("h2", title), el("p", text));
  if (action) {
    const button = el("button", action.label, "button" + (action.primary ? " primary" : ""));
    button.type = "button";
    button.onclick = action.run;
    empty.append(button);
  }
  return empty;
}

function renderProjectsPage() {
  const root = pageShell(
    "Проекты",
    "Проект — папка с файлами. Внутри проекта можно вести несколько независимых чатов.",
  );
  const renderList = (query = searchValue) => {
    const list = el("div", null, "list");
    const term = query.trim().toLocaleLowerCase();
    const projects = catalog.filter((project) =>
      (project.name + " " + (project.folder || "")).toLocaleLowerCase().includes(term),
    );
    const pages = Math.max(1, Math.ceil(projects.length / PROJECT_PAGE_SIZE));
    projectPage = Math.min(Math.max(1, projectPage), pages);
    const visible = projects.slice((projectPage - 1) * PROJECT_PAGE_SIZE, projectPage * PROJECT_PAGE_SIZE);
    if (!projects.length) {
      list.append(
        emptyState(
          term ? "Ничего не найдено" : "Начните с первого проекта",
          term ? "Попробуйте другое название или путь." : "Проект объединяет файлы и чаты одной задачи.",
          term ? null : { label: "Новый проект", primary: true, run: openCreateProject },
        ),
      );
    }
    if (projectPage === 1 && projects.length) {
      const create = el("button", null, "row-item row-create");
      create.type = "button";
      create.append(icon("plus"));
      const copy = el("span", null, "row-copy");
      copy.append(el("strong", "Создать проект"));
      create.append(copy);
      create.onclick = () => openCreateProject();
      list.append(create);
    }
    for (const project of visible) {
      const row = el("button", null, "row-item");
      row.type = "button";
      row.append(icon("folder"));
      const copy = el("span", null, "row-copy");
      copy.append(el("strong", project.name));
      copy.append(el("small", plural(project.chats?.length || 0, "чат", "чата", "чатов")));
      row.append(copy, icon("arrow"));
      row.onclick = () => openProject(project);
      list.append(row);
    }
    const container = $("project-list");
    if (container) {
      if (catalogLoading) container.replaceChildren(skeletonList());
      else {
        container.replaceChildren(list);
        renderFloatingPager(projects.length, projectPage, PROJECT_PAGE_SIZE, (next) => {
          projectPage = next;
          renderList(searchValue);
          scrollPageTop();
        });
      }
    }
  };
  const searchRender = (query) => {
    projectPage = 1;
    renderList(query);
  };
  const { toolbar } = listToolbar("Найти проект…", searchRender, {
    folder: true,
    create: { run: openCreateProject },
  });
  root.append(toolbar);
  const list = el("div");
  list.id = "project-list";
  list.append(catalogLoading ? skeletonList() : el("div"));
  root.append(list);
  if (catalogError) {
    root.append(
      emptyState("Не удалось загрузить проекты", catalogError, {
        label: "Повторить",
        run: () => run("Загружаю проекты…", () => loadCatalog()),
      }),
    );
  }
  renderList();
}

function renderChatsPage(project) {
  if (!project) {
    page = "projects";
    renderProjectsPage();
    return;
  }
  const root = pageShell(project.name, "Файлы и чаты проекта.");
  const renderList = (query = searchValue) => {
    const list = el("div", null, "list");
    const term = query.trim().toLocaleLowerCase();
    const chats = (project.chats || []).filter((chat) =>
      (chat.name || "").toLocaleLowerCase().includes(term),
    );
    const pages = Math.max(1, Math.ceil(chats.length / CHAT_PAGE_SIZE));
    chatPage = Math.min(Math.max(1, chatPage), pages);
    const visible = chats.slice((chatPage - 1) * CHAT_PAGE_SIZE, chatPage * CHAT_PAGE_SIZE);
    const create = el("button", null, "row-item row-create row-create-chat");
    create.type = "button";
    create.disabled = Boolean(state.busy);
    create.append(icon("plus"));
    const createCopy = el("span", null, "row-copy");
    createCopy.append(el("strong", "Создать чат"));
    create.append(createCopy);
    create.onclick = () => newBranch();
    list.append(create);
    for (const chat of visible) {
      const row = el("button", null, "row-item" + (chat.id === state.active?.id ? " selected" : ""));
      row.type = "button";
      row.append(icon("branch"));
      const copy = el("span", null, "row-copy");
      copy.append(el("strong", chat.name || "Новый чат"));
      copy.append(
        el("small", plural(chat.count || 0, "сообщение", "сообщения", "сообщений")),
      );
      row.append(copy, icon("arrow"));
      row.onclick = () => {
        if (chat.id === state.active?.id) {
          page = "chat";
          renderRoute();
          return;
        }
        openBranch(chat);
      };
      list.append(row);
    }
    if (!chats.length) {
      list.append(
        emptyState(
          term ? "Ничего не найдено" : "Пока нет чатов",
          term ? "Попробуйте другое название." : "Создайте чат — он будет хранить свою переписку.",
          null,
        ),
      );
    }
    const container = $("chat-list");
    if (container) {
      container.replaceChildren(list);
      renderFloatingPager(chats.length, chatPage, CHAT_PAGE_SIZE, (next) => {
        chatPage = next;
        renderList(searchValue);
        scrollPageTop();
      });
    }
  };
  const searchRender = (query) => {
    chatPage = 1;
    renderList(query);
  };
  const toolbar = el("div", null, "toolbar");
  const back = el("button", null, "button ghost");
  back.type = "button";
  back.append(icon("prev"), el("span", "Все проекты"));
  back.onclick = () => navigate("projects");
  toolbar.append(back);
  const { toolbar: searchBar } = listToolbar("Найти чат…", searchRender, {
    branch: true,
  });
  toolbar.append(...searchBar.childNodes);
  root.append(toolbar);
  const list = el("div");
  list.id = "chat-list";
  list.append(el("div"));
  root.append(list);
  renderList();
}

function renderCreatePage() {
  const back = el("button", null, "back");
  back.type = "button";
  back.append(icon("prev"), el("span", "Все проекты"));
  back.onclick = () => navigate("projects");
  const root = pageShell("Новый проект", "Для файлов задачи будет создана отдельная папка.");
  root.prepend(back);
  const form = el("form", null, "form");
  const label = el("label", "Название проекта");
  label.htmlFor = "project-name";
  const input = el("input");
  input.id = "project-name";
  input.placeholder = "Например, сайт пекарни";
  input.maxLength = 60;
  input.required = true;
  input.autocomplete = "off";
  const error = el("div", null, "form-error");
  error.setAttribute("role", "alert");
  const actions = el("div", null, "form-actions");
  const submit = el("button", "Создать проект", "button primary");
  submit.type = "submit";
  const cancel = el("button", "Отмена", "button");
  cancel.type = "button";
  cancel.onclick = () => navigate("projects");
  actions.append(submit, cancel);
  form.append(label, input, error, actions);
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!input.value.trim()) {
      error.textContent = "Введите название проекта.";
      input.focus();
      return;
    }
    submit.disabled = true;
    run("Создаю проект…", async () => {
      const next = await api("create-project", { name: input.value, fast: true }, 45000);
      applyState(next);
      page = "chat";
      projectId = next.active?.projectId || null;
      loadCatalog().catch(() => {});
      renderRoute();
    }).finally(() => {
      submit.disabled = false;
    });
  };
  root.append(form);
  input.focus();
}

/* ============================== chat rendering ============================== */

function renderChat() {
  if (state.loading) {
    renderChatSkeleton();
  } else {
    renderMessages();
  }
  renderQueue();
  renderStatus();
  autoGrow();
}

function renderChatSkeleton() {
  const area = $("messages");
  const wrap = el("div", null, "chat-loading");
  const user = el("div", null, "user-line");
  const bubble = el("div");
  bubble.style.width = "42%";
  bubble.append(el("span", null, "skeleton w-80"));
  user.append(bubble);
  wrap.append(user);
  for (let index = 0; index < 2; index += 1) {
    const row = el("div", null, "message");
    const mark = el("div", null, "assistant-mark");
    mark.textContent = "π";
    const body = el("div");
    body.style.flex = "1";
    body.append(el("span", null, "skeleton w-60"), el("span", null, "skeleton w-80"), el("span", null, "skeleton w-40"));
    body.style.display = "grid";
    body.style.gap = "7px";
    row.append(mark, body);
    wrap.append(row);
  }
  wrap.append(el("div", "Открываю чат…", "stream-label"));
  area.replaceChildren(wrap);
}

function syncGenerationClock() {
  clearInterval(chatClockTimer);
  chatClockTimer = null;
  const nodes = [...document.querySelectorAll("[data-chat-clock]")];
  if (!nodes.length) return;
  const update = () => {
    if (!nodes.some((node) => node.isConnected)) {
      clearInterval(chatClockTimer);
      chatClockTimer = null;
      return;
    }
    for (const node of nodes) {
      if (!node.isConnected) continue;
      node.textContent = [progressTime(), node.dataset.quota].filter(Boolean).join(" · ");
    }
  };
  update();
  chatClockTimer = setInterval(update, 1000);
}

function messageSignature() {
  return JSON.stringify([
    state.messages || [],
    Boolean(state.busy),
    editingIndex,
    state.active?.readOnly,
    state.active?.id,
    state.ready,
  ]);
}

function renderMessages() {
  if (page !== "chat") return;
  const signature = messageSignature();
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  const area = $("messages");
  const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 120;
  const oldTop = area.scrollTop;
  const frag = document.createDocumentFragment();
  const messages = state.messages || [];
  let previousAssistant = false;
  let assistantContent = null;
  let assistantText = "";
  let assistantStreaming = false;
  let assistantRunningTools = false;
  let assistantImageLoaders = 0;

  const finishAssistant = (final = false) => {
    if (!assistantContent) return;
    if (assistantImageLoaders) {
      assistantContent.append(imageToolLoader(assistantImageLoaders));
      assistantImageLoaders = 0;
    }
    const active = assistantStreaming || (state.busy && (assistantRunningTools || final));
    if (active) {
      const quota = Number.isFinite(state.routerProgress?.quota)
        ? `${state.routerProgress.estimated ? "≈" : ""}${state.routerProgress.quota.toLocaleString("ru-RU")} квоты`
        : Number.isFinite(state.billing?.account?.available)
          ? `${state.billing.account.available.toLocaleString("ru-RU")} доступно`
          : "";
      const meta = [progressTime(), quota].filter(Boolean).join(" · ") || progressTime();
      const generation = el("div", null, "inline-generation");
      generation.append(el("span", null, "inline-generation-spinner"));
      const metaNode = el("span", meta, "inline-generation-meta");
      metaNode.dataset.chatClock = "1";
      metaNode.dataset.quota = quota;
      generation.append(metaNode);
      assistantContent.append(generation);
    } else if (assistantText) {
      const foot = el("div", null, "assistant-foot");
      const copy = el("button", null, "copy-btn");
      copy.type = "button";
      copy.append(icon("copy"), el("span", "Копировать"));
      copy.onclick = () => copyText(assistantText);
      foot.append(copy);
      assistantContent.append(foot);
    }
    assistantContent = null;
    assistantText = "";
    assistantStreaming = false;
    assistantRunningTools = false;
    assistantImageLoaders = 0;
  };

  messages.forEach((message, index) => {
    if (
      !message.text &&
      !message.thinking &&
      !message.tools?.length &&
      !message.error &&
      message.status !== "streaming"
    )
      return;
    const user = message.role === "user";
    if (user) {
      finishAssistant();
      previousAssistant = false;
    }
    const nextUser = messages.findIndex((item, position) => position > index && item.role === "user");
    const historical = nextUser >= 0;
    const recovered = messages
      .slice(index + 1, historical ? nextUser : undefined)
      .some((item) => item.role === "assistant" && !item.error && (item.text || item.tools?.length));
    const showFailure = message.error && !recovered && (historical || !state.busy);
    if (message.error && !showFailure && !message.text && !message.thinking && !message.tools?.length)
      return;

    const messageKey = (state.active?.id || "") + ":" + index;

    if (user) {
      const row = el("article", null, "message user");
      row.dataset.index = String(index);
      const wrapper = el("div", null, "user-message-wrapper");
      if (editingIndex === index) {
        wrapper.append(editBox(message, index));
      } else {
        const parsed = splitAttachments(message.text || "");
        const bubble = el("div", null, "user-bubble");
        if (parsed.text) markdown(bubble, parsed.text);
        if (parsed.attachments.length) bubble.append(attachmentChips(parsed.attachments, false));
        wrapper.append(bubble);
        if (!state.busy && !state.active?.readOnly && !state.active?.host) {
          const controls = el("div", null, "message-controls");
          const edit = el("button", null, "message-control");
          edit.type = "button";
          edit.title = "Редактировать в новой ветке (новый чат)";
          edit.append(icon("edit"), el("span", "Изменить"));
          edit.onclick = () => {
            editingIndex = index;
            renderMessages();
          };
          const branch = el("button", null, "message-control");
          branch.type = "button";
          branch.title = "Создать ветку от этого сообщения (новый чат)";
          branch.append(icon("branch"), el("span", "Ветка отсюда"));
          branch.onclick = () => forkMessage(index, "");
          const copy = el("button", null, "message-control");
          copy.type = "button";
          copy.title = "Скопировать";
          copy.append(icon("copy"), el("span", "Копировать"));
          copy.onclick = () => copyText(message.text || "");
          controls.append(edit, branch, copy);
          wrapper.append(controls);
        }
      }
      row.append(wrapper);
      frag.append(row);
    } else {
      let content = assistantContent;
      if (!content) {
        const row = el("article", null, "message assistant");
        row.dataset.index = String(index);
        const mark = el("div", null, "assistant-mark");
        mark.textContent = "π";
        content = el("div", null, "assistant-body");
        row.append(mark, content);
        frag.append(row);
        assistantContent = content;
      }
      assistantText += (assistantText && message.text ? "\n\n" : "") + (message.text || "");
      assistantStreaming = message.status === "streaming";
      if (message.thinking) {
        const body = el("div", null, "reasoning-text");
        markdown(body, message.thinking);
        content.append(
          disclosure(
            message.status === "streaming" && !message.text ? "Размышляет…" : "Размышления",
            body,
            "reasoning",
            message.status === "streaming" ? { label: "идёт", cls: "warn" } : null,
            messageKey + ":thinking",
          ),
        );
      }
      const answer = el("div", null, "answer");
      markdown(answer, message.text || "");
      content.append(answer);
      if (message.status === "streaming" && !message.text && !message.thinking && !message.tools?.length) {
        const skeleton = el("div", null, "stream-skeleton");
        skeleton.append(el("span", null, "skeleton w-80"), el("span", null, "skeleton w-60"));
        content.append(skeleton);
      }
      for (const tool of message.tools || []) {
        const status = tool.status || "pending";
        if (status === "running" || status === "pending") assistantRunningTools = true;
        const labels = { pending: "ожидает", running: "выполняется", done: "готово", error: "ошибка", stopped: "остановлено" };
        const body = el("div", null, "tool-detail");
        if (tool.path) body.append(el("p", tool.path, "file-path"));
        if (tool.command) body.append(el("pre", tool.command));
        if (tool.output) body.append(el("pre", tool.output));
        if (!body.childNodes.length)
          body.append(el("p", status === "running" ? "Ожидаю результат…" : "Дополнительных сведений нет."));
        const label = status === "done"
          ? String(tool.label || "Действие").replace("Создаю файл", "Файл записан").replace("Обновляю файл", "Файл изменён").replace("Читаю файл", "Файл прочитан")
          : tool.label || "Действие";
        content.append(
          disclosure(
            label,
            body,
            "tool-card " + status,
            {
              label: labels[status] || status,
              cls: status === "error" ? "err" : status === "done" ? "ok" : status === "running" ? "warn" : "",
              dot: true,
            },
            messageKey + ":tool:" + (tool.id || tool.label || "tool"),
          ),
        );
        if (Array.isArray(tool.images) && tool.images.length) {
          content.append(toolImageGrid(tool.images));
          if (tool.images.some((image) => !imageImages.some((item) => item.path === image.path))) {
            void refreshImageLibrary();
          }
        } else if (tool.name === "generate_image" && (status === "running" || status === "pending")) {
          assistantImageLoaders += 1;
        }
      }
      if (showFailure) {
        content.append(
          disclosure(
            "Не удалось получить ответ · Подробнее",
            el("pre", message.error),
            "message-error",
            null,
            messageKey + ":error",
          ),
        );
      }
      if (message.status === "stopped") content.append(el("p", "Ответ прерван. Полученная часть сохранена.", "stopped-note"));
      if (message.retained) content.append(el("p", "Сохранённый фрагмент: сервис не вернул его в итоговой истории.", "stopped-note"));
      if (message.versions?.length) {
        const body = el("div");
        for (const version of message.versions) body.append(el("pre", version.text || version.thinking || ""));
        content.append(
          disclosure(
            "Предыдущий фрагмент ответа · сервис заменил текст",
            body,
            "reasoning",
            null,
            messageKey + ":versions",
          ),
        );
      }
      previousAssistant = true;
    }
  });
  finishAssistant(true);

  if (state.active && state.ready === false && !state.busy) {
    const connecting = el("div", null, "inline-generation connecting");
    connecting.append(
      el("span", null, "inline-generation-spinner"),
      document.createTextNode("Подключаюсь к чату…"),
    );
    frag.append(connecting);
  }
  if (!frag.childNodes.length) {
    const welcome = el("div", null, "welcome");
    const mark = el("div", "π", "welcome-mark");
    welcome.append(mark, el("h2", "Чем помочь?"), el("p", "Опишите задачу — файлы появятся в папке проекта."));
    area.replaceChildren(welcome);
  } else {
    area.replaceChildren(frag);
  }
  syncGenerationClock();
  if (nearBottom && !area.querySelector("details[open]")) area.scrollTop = area.scrollHeight;
  else area.scrollTop = oldTop;
  if (editingIndex != null) {
    const textarea = area.querySelector(".edit-box textarea");
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }
}

function disclosure(label, body, cls = "", badge = null, key = null) {
  const details = el("details", null, cls);
  const stateKey = key || cls + ":" + label;
  details.open = expandedDetails.get(stateKey) || false;
  const summary = el("summary");
  if (badge?.dot) summary.append(el("span", null, "tool-dot"));
  summary.append(el("span", label));
  if (badge && !badge.dot) summary.append(el("span", badge.label, "pill-badge " + (badge.cls || "")));
  summary.onclick = () => expandedDetails.set(stateKey, !details.open);
  details.append(summary, body);
  return details;
}

function editBox(message, index) {
  const parsed = splitAttachments(message.text || "");
  const box = el("div", null, "edit-box");
  const textarea = el("textarea");
  textarea.value = parsed.text;
  textarea.rows = 3;
  textarea.setAttribute("aria-label", "Текст сообщения");
  const note = el("div", "Сохранение создаст новую ветку. Она появится отдельным чатом слева.", "edit-note");
  const actions = el("div", null, "edit-actions");
  const cancel = el("button", "Отмена", "button");
  cancel.type = "button";
  cancel.onclick = () => {
    editingIndex = null;
    renderedSignature = "";
    renderMessages();
  };
  const save = el("button", "Создать ветку", "button primary");
  save.type = "button";
  save.onclick = () => {
    const text = textarea.value.trim();
    if (!text) {
      showHint("Введите текст сообщения.", true);
      return;
    }
    editingIndex = null;
    renderedSignature = "";
    forkMessage(index, buildOutgoingText(text, parsed.attachments));
  };
  actions.append(cancel, save);
  box.append(textarea, note, actions);
  return box;
}


function formatBytes(size) {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) {
    const value = size / 1024;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(".", ",")} КБ`;
  }
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

function attachmentChips(items, removable = false) {
  const box = el("div", null, "message-attachments");
  items.forEach((item, index) => {
    const card = el("span", null, "attachment-card");
    card.title = item.path;
    const iconBox = el("span", null, "attachment-icon");
    iconBox.append(icon("file"));
    const copy = el("span", null, "attachment-copy");
    const name = item.name || "Файл";
    copy.append(el("span", name, "attachment-name"));
    const extension = name.includes(".") ? name.split(".").pop().toUpperCase().slice(0, 5) : "";
    const meta = [extension, formatBytes(item.size)].filter(Boolean).join(" · ");
    if (meta) copy.append(el("span", meta, "attachment-meta"));
    card.append(iconBox, copy);
    if (removable) {
      const remove = el("button", null, "attachment-remove");
      remove.type = "button";
      remove.title = "Открепить файл";
      remove.setAttribute("aria-label", "Открепить файл");
      remove.append(icon("close"));
      remove.onclick = (event) => {
        event.stopPropagation();
        items.splice(index, 1);
        renderAttachments();
      };
      card.append(remove);
    }
    box.append(card);
  });
  return box;
}

function renderAttachments() {
  const box = $("attachments");
  box.replaceChildren();
  box.hidden = !attachments.length;
  if (attachments.length) box.append(attachmentChips(attachments, true));
  renderStatus();
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function base64File(buffer) {
  let binary = "";
  for (let index = 0; index < buffer.length; index += 0x8000)
    binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
  return btoa(binary);
}

function dropFiles(files) {
  const list = [...files];
  if (!list.length) return;
  if (!state.active) {
    showHint("Сначала откройте чат, чтобы прикрепить файлы.", true);
    return;
  }
  if (state.active.readOnly) {
    showHint("Этот чат открыт в консоли.", true);
    return;
  }
  run("Прикрепляю файлы…", async () => {
    const payload = [];
    let total = 0;
    for (const file of list) {
      if (file.size > 50 * 1024 * 1024) {
        showHint(`«${file.name}» больше 50 МБ и был пропущен.`, true);
        continue;
      }
      total += file.size;
      if (total > 100 * 1024 * 1024) {
        showHint("Слишком много файлов за один раз (до 100 МБ).", true);
        break;
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      payload.push({ name: file.name, content: base64File(buffer) });
    }
    if (!payload.length) return;
    const result = await api("drop-attach", { files: payload }, 180000);
    const seen = new Set(attachments.map((item) => item.path.toLowerCase()));
    for (const file of result.files || []) {
      if (!file?.path || seen.has(file.path.toLowerCase())) continue;
      seen.add(file.path.toLowerCase());
      attachments.push({ name: file.name || "Файл", path: file.path, ...(Number.isFinite(file.size) ? { size: file.size } : {}) });
    }
    renderAttachments();
    showHint(
      payload.length === 1 ? `Прикреплён файл: ${payload[0].name}` : `Прикреплено файлов: ${payload.length}`,
    );
  });
}

function wireDropZone() {
  const overlay = $("drop-overlay");
  let depth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    depth += 1;
    overlay.hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    overlay.hidden = false;
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasDraggedFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener("drop", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.hidden = true;
    dropFiles(event.dataTransfer.files);
  });
}

function imageUrl(image, project = activeProjectId()) {
  if (!project || !image?.path) return "";
  return `/api/image?project=${encodeURIComponent(project)}&path=${encodeURIComponent(image.path)}`;
}

function imageName(path) {
  return String(path || "").replace(/\\/g, "/").split("/").pop() || "Изображение";
}

function imageMeta(image) {
  const actual = image.width && image.height ? `${image.width}×${image.height}` : "";
  const requested = image.size && image.size !== "auto" ? image.size.replace("x", "×") : "";
  const size = requested && requested !== actual ? requested : "";
  const date = dateLabel(image.createdAt);
  return [actual, size, date].filter(Boolean).join(" · ");
}

function updateImageBadge() {
  const button = $("image-gallery-open");
  const count = $("image-count");
  if (!button || !count) return;
  const project = activeProjectId();
  button.hidden = !project || page !== "chat" || !state.active || imageComposeOpen || imagePanelOpen;
  if (!project) return;
  const chatId = state.active?.sessionId;
  const number = chatId
    ? imageImages.filter((image) => image.chatId === chatId).length
    : imageImages.length;
  count.textContent = String(number);
  count.hidden = !number;
}

async function refreshImageLibrary() {
  if (imageRefreshPending) {
    imageRefreshQueued = true;
    return;
  }
  imageRefreshPending = true;
  try {
    const project = activeProjectId();
    if (!project) {
      imageImages = [];
      updateImageBadge();
      return;
    }
    try {
      const result = await api("images", { project }, 30000);
      imageImages = result.images || [];
    } catch {}
    updateImageBadge();
    if ($("image-panel") && !$("image-panel").hidden) {
      if (imageGallerySelected) renderGallery();
      else renderGallery({ reset: true });
    }
    if ($("image-source-menu") && !$("image-source-menu").hidden && !$("image-source-generated-list").hidden) {
      renderSourceMenuGallery();
    }
  } finally {
    imageRefreshPending = false;
    if (imageRefreshQueued) {
      imageRefreshQueued = false;
      void refreshImageLibrary();
    }
  }
}

function renderImageWorkspace(chatPage = page === "chat" && Boolean(state.active)) {
  const workspace = $("chat-workspace");
  if (!workspace) return;
  if (!chatPage) {
    imageComposeOpen = false;
    imagePanelOpen = false;
    imageWorkspaceChatId = null;
  } else if (imageWorkspaceChatId && state.active?.id !== imageWorkspaceChatId) {
    imageComposeOpen = false;
    imagePanelOpen = false;
    imageWorkspaceChatId = null;
  }
  const compose = Boolean(chatPage && imageComposeOpen);
  const panel = Boolean(chatPage && imagePanelOpen && !compose);
  workspace.hidden = !chatPage;
  $("chat").hidden = !chatPage || compose;
  $("image-compose").hidden = !compose;
  $("image-panel").hidden = !panel;
  workspace.classList.toggle("with-panel", panel);
  updateImageBadge();
}

function normalizeImageSource(source) {
  if (!source) return null;
  if (typeof source === "string") return { path: source, name: imageName(source) };
  if (!source.path) return null;
  return { ...source, path: source.path, name: source.name || imageName(source.path) };
}

function openImageCompose(source = null) {
  if (!activeProjectId() || !state.active) {
    showHint("Сначала откройте чат в проекте.", true);
    return;
  }
  imageComposeOpen = true;
  imagePanelOpen = false;
  imageWorkspaceChatId = state.active?.id || null;
  closeSourceMenu();
  imageStudioSource = normalizeImageSource(source);
  imageJobs = imageJobs.filter((job) => job.surface !== "compose" || job.status === "loading");
  $("image-prompt").value = "";
  $("image-prompt").style.height = "";
  $("image-aspect").value = "auto";
  $("image-count-select").value = "1";
  $("image-jobs").replaceChildren();
  renderImageSource();
  updateImageGenerateButton();
  renderImageWorkspace();
  renderImageJobs();
  refreshImageLibrary();
  setTimeout(() => {
    $("image-prompt").focus();
    $("image-prompt").style.height = "";
  }, 0);
}

function closeImageCompose() {
  imageComposeOpen = false;
  closeSourceMenu();
  renderImageWorkspace();
  $("draft").focus({ preventScroll: true });
}

function openImagePanel() {
  if (!activeProjectId() || !state.active) {
    showHint("Сначала откройте чат в проекте.", true);
    return;
  }
  imageComposeOpen = false;
  imagePanelOpen = true;
  imageWorkspaceChatId = state.active?.id || null;
  closeSourceMenu();
  const chatId = state.active?.sessionId;
  if (!chatId || !imageImages.some((image) => image.chatId === chatId)) imageGalleryScope = "project";
  imageGallerySelected = null;
  panelRefs = [];
  renderPanelRefs();
  renderImageWorkspace();
  renderGallery({ reset: true });
  renderPanelJobs();
  refreshImageLibrary();
  renderStatus();
}

function openImagePanelAt(image) {
  if (!activeProjectId() || !state.active) {
    showHint("Сначала откройте чат в проекте.", true);
    return;
  }
  imageComposeOpen = false;
  imagePanelOpen = true;
  imageWorkspaceChatId = state.active?.id || null;
  imageGallerySelected = null;
  imageGalleryScope = image.chatId && image.chatId !== state.active?.sessionId ? "project" : "chat";
  if (image?.path) addPanelRef(image);
  renderImageWorkspace();
  renderGallery({ reset: true });
  renderPanelJobs();
  openImageLightbox(image);
  refreshImageLibrary();
}

function closeImagePanel() {
  imagePanelOpen = false;
  imageGallerySelected = null;
  panelRefs = [];
  renderPanelRefs();
  if (voiceTarget === "panel") voiceTarget = "chat";
  renderImageWorkspace();
  renderStatus();
  $("draft").focus({ preventScroll: true });
}

function galleryTabs() {
  $("gallery-chat").classList.toggle("active", imageGalleryScope === "chat");
  $("gallery-project").classList.toggle("active", imageGalleryScope === "project");
}

function galleryImages() {
  const chatId = state.active?.sessionId;
  return imageGalleryScope === "chat" && chatId
    ? imageImages.filter((image) => image.chatId === chatId)
    : imageImages;
}

function renderGallery({ reset = false } = {}) {
  galleryTabs();
  const selected = imageGallerySelected;
  const images = galleryImages();
  $("gallery-grid").hidden = Boolean(selected);
  $("gallery-view").hidden = !selected;
  $("gallery-count").textContent = String(images.length);
  if (selected) {
    const image = selected;
    $("gallery-image").src = imageUrl(image);
    $("gallery-image").alt = image.prompt || "Сгенерированное изображение";
    $("gallery-meta").replaceChildren(
      el("strong", image.prompt || "Изображение", "gallery-prompt"),
      el("span", [imageMeta(image), image.chatName].filter(Boolean).join(" · "), "gallery-sub"),
    );
    $("gallery-download").href = imageUrl(image);
    $("gallery-download").download = imageName(image.path);
    $("gallery-edit").disabled = !image.path;
    $("gallery-delete").disabled = !image.path;
    return;
  }

  const grid = $("gallery-grid");
  const columns = $("gallery-columns");
  if (reset) {
    columns.replaceChildren();
    grid.scrollTop = 0;
    galleryRendered = 0;
  }
  renderPanelSkeletons();
  if (!images.length) {
    if (!columns.querySelector(".gallery-skeleton")) {
      columns.replaceChildren();
      const empty = el("div", null, "gallery-empty");
      empty.append(
        el("strong", imageGalleryScope === "chat" ? "В этом чате пока нет изображений" : "В проекте пока нет изображений"),
        el("span", "Напишите запрос внизу панели или перетащите картинку в референсы."),
      );
      columns.append(empty);
    }
    return;
  }
  if (!galleryRendered) appendGalleryBatch();
}

function panelLoadingJobs() {
  return imageJobs.filter((job) => job.surface === "panel" && job.status === "loading");
}

function renderPanelSkeletons() {
  const grid = $("gallery-grid");
  const columns = $("gallery-columns");
  if (!grid || !columns) return;
  const entries = panelLoadingJobs().map((job) => ({
    key: job.id,
    label: Math.round(job.progress) + "%",
  }));
  if (state.busy) {
    const messages = state.messages || [];
    let turnStart = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        turnStart = index + 1;
        break;
      }
    }
    for (const message of messages.slice(turnStart)) {
      for (const tool of message.tools || []) {
        if (
          tool.name === "generate_image" &&
          (tool.status === "running" || tool.status === "pending") &&
          !tool.images?.length
        ) {
          entries.push({ key: "tool:" + (tool.id || tool.label || "image"), label: "Генерация" });
        }
      }
    }
  }
  if (entries.length) columns.querySelector(".gallery-empty")?.remove();
  const ids = new Set(entries.map((entry) => entry.key));
  for (const node of columns.querySelectorAll(".gallery-skeleton")) {
    if (!ids.has(node.dataset.job)) node.remove();
  }
  const existing = new Map(
    [...columns.querySelectorAll(".gallery-skeleton")].map((node) => [node.dataset.job, node]),
  );
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    let card = existing.get(entry.key);
    if (!card) {
      card = el("div", null, "gallery-skeleton");
      card.dataset.job = entry.key;
      card.append(el("span", null, "gallery-skeleton-spinner"), el("span", null, "gallery-skeleton-percent"));
      columns.prepend(card);
    }
    const percent = card.querySelector(".gallery-skeleton-percent");
    if (percent) percent.textContent = entry.label;
  }
}

function galleryCard(image) {
  const button = el("button", null, "gallery-card");
  button.type = "button";
  button.draggable = true;
  button.title = image.prompt || "Изображение";
  const img = el("img");
  img.src = imageUrl(image);
  img.loading = "lazy";
  img.alt = image.prompt || "Изображение";
  button.append(img);
  button.onclick = () => openGalleryImage(image);
  button.ondragstart = (event) => {
    if (!image.path) return;
    draggingImageCard = button;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-pf-image", image.path);
    event.dataTransfer.setData("text/image-url", imageUrl(image));
    event.dataTransfer.setData("text/plain", image.path);
  };
  button.ondragend = () => {
    if (draggingImageCard === button) draggingImageCard = null;
  };
  return button;
}

function appendGalleryBatch() {
  const grid = $("gallery-grid");
  const columns = $("gallery-columns");
  if (!grid || !columns || imageGallerySelected) return;
  const images = galleryImages();
  const end = Math.min(images.length, galleryRendered + GALLERY_BATCH);
  if (galleryRendered >= end) return;
  const frag = document.createDocumentFragment();
  for (let index = galleryRendered; index < end; index += 1) frag.append(galleryCard(images[index]));
  columns.append(frag);
  galleryRendered = end;
  if (galleryRendered < images.length && columns.scrollHeight <= grid.clientHeight + 10) {
    appendGalleryBatch();
  }
}

function lightboxRefs(image) {
  if (Array.isArray(image?.sources) && image.sources.length) return image.sources.filter(Boolean);
  return image?.source ? [image.source] : [];
}

function renderImageLightbox() {
  const image = lightboxImages[lightboxIndex];
  if (!image) return;
  imageLightboxImage = image;
  const prompt = String(image.prompt || "").trim();
  const shortPrompt = prompt.split(/\s+/).slice(0, 6).join(" ").slice(0, 56).trim();
  const title = String(image.title || shortPrompt || "Изображение").trim();
  $("lightbox-image").src = imageUrl(image);
  $("lightbox-image").alt = title;
  $("lightbox-title").textContent = title;
  $("lightbox-prompt").textContent = prompt;
  $("lightbox-prompt-section").hidden = !prompt;
  const actual = image.width && image.height ? `${image.width}×${image.height}` : "";
  const requested = image.size && image.size !== "auto" ? image.size.replace("x", "×") : "";
  $("lightbox-size").textContent = [actual, requested && requested !== actual ? requested : ""].filter(Boolean).join(" · ") || "—";
  $("lightbox-format").textContent = String(image.format || imageName(image.path).split(".").pop() || "—").toUpperCase();
  $("lightbox-date").textContent = image.createdAt ? dateLabel(image.createdAt) : "—";
  $("lightbox-chat").textContent = image.chatName || "—";
  $("lightbox-path").textContent = image.path;
  $("lightbox-download").href = imageUrl(image);
  $("lightbox-download").download = imageName(image.path);
  const refs = lightboxRefs(image);
  const refBox = $("lightbox-refs");
  refBox.replaceChildren();
  for (const ref of refs) {
    const img = el("img");
    img.src = imageUrl({ path: ref });
    img.alt = "Референс";
    img.title = imageName(ref);
    refBox.append(img);
  }
  $("lightbox-ref-section").hidden = !refs.length;
  const pager = $("lightbox-pager");
  pager.hidden = lightboxImages.length <= 1;
  if (!pager.hidden) {
    $("lightbox-page").textContent = `Страница ${lightboxIndex + 1} из ${lightboxImages.length}`;
    $("lightbox-prev").disabled = lightboxIndex <= 0;
    $("lightbox-next").disabled = lightboxIndex >= lightboxImages.length - 1;
  }
}

function openImageLightbox(image) {
  if (!image?.path) return;
  const images = galleryImages();
  lightboxImages = images.some((item) => item.path === image.path) ? images : [image];
  lightboxIndex = Math.max(0, lightboxImages.findIndex((item) => item.path === image.path));
  renderImageLightbox();
  $("image-lightbox").hidden = false;
}

function showLightboxAt(index) {
  if (!lightboxImages.length) return;
  lightboxIndex = Math.min(Math.max(0, index), lightboxImages.length - 1);
  renderImageLightbox();
}

function closeImageLightbox() {
  $("image-lightbox").hidden = true;
  imageLightboxImage = null;
  lightboxImages = [];
  lightboxIndex = 0;
}

function openGalleryImage(image) {
  openImageLightbox(image);
}

function showGalleryGrid() {
  imageGallerySelected = null;
  renderGallery({ reset: true });
}

function addPanelRef(source) {
  const ref = normalizeImageSource(source);
  if (!ref || !ref.path) return;
  panelRefs = [ref];
  renderPanelRefs();
}

function removePanelRef(path) {
  panelRefs = panelRefs.filter((item) => item.path !== path);
  renderPanelRefs();
}

function renderPanelRefs() {
  const box = $("panel-refs");
  const prompt = $("panel-prompt");
  if (!box) return;
  box.replaceChildren();
  for (const ref of panelRefs) {
    const item = el("div", null, "panel-ref");
    item.title = ref.name || imageName(ref.path);
    const img = el("img");
    img.src = imageUrl(ref);
    img.alt = item.title;
    const remove = el("button", null, "panel-ref-remove");
    remove.type = "button";
    remove.textContent = "✕";
    remove.title = "Убрать референс";
    remove.setAttribute("aria-label", "Убрать референс");
    remove.onclick = (event) => {
      event.stopPropagation();
      removePanelRef(ref.path);
    };
    item.append(img, remove);
    box.append(item);
  }
  if (prompt) prompt.placeholder = panelRefs.length ? "Опишите изменения…" : "Опишите изображение…";
}
function renderImageSource() {
  const list = $("image-ref-list");
  if (!list) return;
  list.replaceChildren();
  if (!imageStudioSource) return;
  const item = el("div", null, "image-ref");
  item.title = imageStudioSource.name || imageName(imageStudioSource.path);
  const img = el("img");
  img.src = imageUrl(imageStudioSource);
  img.alt = item.title;
  const remove = el("button", null, "image-ref-remove");
  remove.type = "button";
  remove.title = "Убрать референс";
  remove.setAttribute("aria-label", "Убрать референс");
  remove.textContent = "✕";
  remove.onclick = (event) => {
    event.stopPropagation();
    setImageSource(null);
  };
  item.append(img, remove);
  list.append(item);
}

function setImageSource(source) {
  imageStudioSource = normalizeImageSource(source);
  renderImageSource();
  closeSourceMenu();
  updateImageGenerateButton();
}

function closeSourceMenu() {
  const menu = $("image-source-menu");
  const list = $("image-source-generated-list");
  if (menu) menu.hidden = true;
  if (list) list.hidden = true;
}

function toggleSourceMenu() {
  const menu = $("image-source-menu");
  if (!menu) return;
  if (!menu.hidden) {
    closeSourceMenu();
    return;
  }
  menu.hidden = false;
  $("image-source-generated-list").hidden = true;
  refreshImageLibrary();
}

function renderSourceMenuGallery() {
  const list = $("image-source-generated-list");
  if (!list) return;
  list.hidden = false;
  list.replaceChildren();
  if (!imageImages.length) {
    list.append(el("div", "Нет сгенерированных изображений.", "source-menu-empty"));
    return;
  }
  for (const image of imageImages.slice(0, 24)) {
    const button = el("button");
    button.type = "button";
    button.title = image.prompt || imageName(image.path);
    const img = el("img");
    img.src = imageUrl(image);
    img.loading = "lazy";
    img.alt = button.title;
    button.append(img);
    button.onclick = () => setImageSource(image);
    list.append(button);
  }
}

async function uploadImageSource(file, target = "compose") {
  if (!file) return;
  if (!/image\/(png|jpeg)/.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) {
    showHint("Выберите PNG или JPEG.", true);
    return;
  }
  if (file.size > 11 * 1024 * 1024) {
    showHint("Файл больше 11 МБ.", true);
    return;
  }
  if (imageSourceUploading) return;
  imageSourceUploading = true;
  showHint("Загружаю референс…");
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < buffer.length; index += 0x8000)
      binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
    const result = await api("image-source", { name: file.name, content: btoa(binary) }, 60000);
    if (target === "panel") addPanelRef(result);
    else setImageSource(result);
    showHint("Референс добавлен.");
  } catch (error) {
    showHint(error.message, true);
  } finally {
    imageSourceUploading = false;
  }
}

function updateImageGenerateButton() {
  const button = $("image-generate");
  if (!button) return;
  const loading = imageJobs.some((job) => job.surface === "compose" && job.status === "loading");
  button.disabled = loading || !$("image-prompt").value.trim();
  button.textContent = loading ? "Генерирую…" : "Сгенерировать";
}

function updatePanelGenerateButton() {
  const button = $("panel-generate");
  if (!button) return;
  const loading = panelLoadingJobs().length;
  const full = loading >= 4;
  button.disabled = full || !$("panel-prompt").value.trim();
  button.textContent = full ? "Максимум 4" : loading ? `Ещё (${loading}/4)` : "Сгенерировать";
  button.setAttribute("aria-busy", String(loading > 0));
}

function stopImageTimer() {
  clearInterval(imageProgressTimer);
  imageProgressTimer = null;
}

function startImageTimer() {
  if (imageProgressTimer) return;
  imageProgressTimer = setInterval(() => {
    let loading = false;
    for (const job of imageJobs) {
      if (job.status !== "loading") continue;
      loading = true;
      job.progress = Math.min(92, 4 + (Date.now() - job.startedAt) / 1000 * 1.3);
    }
    if (loading) {
      renderImageJobs();
      renderPanelJobs();
    } else stopImageTimer();
  }, 400);
}

function imageJobElapsed(job) {
  const seconds = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function imageJobSize(job) {
  if (!job.size || job.size === "auto") return "авто";
  const labels = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3", "1920x1080": "16:9", "1080x1920": "9:16" };
  return labels[job.size] || job.size;
}

function renderJobCards(box, jobs) {
  if (!box) return;
  box.replaceChildren();
  for (const job of jobs) {
    const card = el("div", null, "image-job " + job.status);
    card.dataset.job = job.id;
    if (job.status === "loading") {
      const visual = el("div", null, "image-job-visual loading");
      visual.append(el("span", null, "image-skeleton"), el("span", "Генерирую…", "image-job-state"));
      const progress = el("div", null, "image-progress");
      const fill = el("span");
      fill.style.width = Math.round(job.progress) + "%";
      progress.append(fill);
      const meta = el("div", null, "image-job-meta");
      meta.append(el("span", imageJobElapsed(job)), el("span", imageJobSize(job)));
      card.append(visual, progress, meta);
    } else if (job.status === "done" && job.image) {
      const visual = el("button", null, "image-job-visual done");
      visual.type = "button";
      visual.title = "Открыть изображение";
      const img = el("img");
      img.src = imageUrl(job.image);
      img.alt = job.prompt;
      visual.append(img);
      visual.onclick = () => openImagePanelAt(job.image);
      const meta = el("div", null, "image-job-meta");
      meta.append(el("span", imageMeta(job.image)), el("span", "готово", "image-job-ok"));
      card.append(visual, meta);
    } else {
      const visual = el("div", null, "image-job-visual error");
      visual.append(el("span", "!", "image-job-error-mark"));
      const message = el("div", null, "image-job-error");
      message.append(el("strong", "Не удалось создать изображение"));
      message.append(el("span", job.error || "Попробуйте ещё раз."));
      const actions = el("div", null, "image-job-actions");
      const retry = el("button", "Повторить", "button");
      retry.type = "button";
      retry.onclick = () => retryImageJob(job);
      actions.append(retry);
      if (job.statusCode === 402 || /quota|кредит/i.test(job.error || "")) {
        const topup = el("button", "Пополнить", "button primary");
        topup.type = "button";
        topup.onclick = () => $("billing-open").click();
        actions.append(topup);
      }
      card.append(visual, message, actions);
    }
    box.append(card);
  }
}

function renderImageJobs() {
  renderJobCards($("image-jobs"), imageJobs.filter((job) => job.surface !== "panel"));
  updateImageGenerateButton();
}

function renderPanelJobs() {
  renderPanelSkeletons();
  updatePanelGenerateButton();
}

function runImageJob(job) {
  job.status = "loading";
  job.progress = 4;
  job.startedAt = Date.now();
  job.error = null;
  job.image = null;
  renderImageJobs();
  renderPanelJobs();
  startImageTimer();
  api("image-generate", {
    prompt: job.prompt,
    size: job.size,
    source: job.source,
    sources: job.sources,
    requestId: job.id,
  }, 0)
    .then((result) => {
      if (!result?.image) throw new Error("Роутер не вернул изображение.");
      job.status = "done";
      job.progress = 100;
      job.image = result.image;
      if (job.surface === "panel" && imagePanelOpen && imageGallerySelected) {
        imageGallerySelected = result.image;
        imageGalleryScope = "chat";
        renderGallery();
      }
    })
    .catch((error) => {
      job.status = "error";
      job.error = error.message;
      job.statusCode = error.status;
      job.code = error.code;
      if (job.surface === "panel") showHint(error.message, true);
    })
    .finally(() => {
      renderImageJobs();
      renderPanelJobs();
      if (!imageJobs.some((item) => item.status === "loading")) stopImageTimer();
      refreshImageLibrary();
    });
}

function retryImageJob(job) {
  if (job.status === "loading") return;
  runImageJob(job);
}

function generateImages() {
  const prompt = $("image-prompt").value.trim();
  if (!prompt) {
    showHint("Опишите изображение.", true);
    $("image-prompt").focus();
    return;
  }
  if (!activeProjectId() || !state.active) {
    showHint("Сначала откройте чат в проекте.", true);
    return;
  }
  const count = Math.max(1, Math.min(4, Number($("image-count-select").value) || 1));
  const size = $("image-aspect").value;
  const source = imageStudioSource?.path;
  imageJobs = imageJobs.filter((job) => job.surface !== "compose");
  for (let index = 0; index < count; index += 1) {
    const job = {
      id: crypto.randomUUID(),
      surface: "compose",
      prompt,
      size,
      source,
      sources: source ? [source] : undefined,
      status: "loading",
      progress: 4,
      startedAt: Date.now(),
      image: null,
      error: null,
    };
    imageJobs.push(job);
    runImageJob(job);
  }
  renderImageJobs();
}

function generatePanelImage() {
  const prompt = $("panel-prompt").value.trim();
  if (!prompt) {
    showHint("Опишите изображение.", true);
    $("panel-prompt").focus();
    return;
  }
  if (!activeProjectId() || !state.active) {
    showHint("Сначала откройте чат в проекте.", true);
    return;
  }
  if (panelLoadingJobs().length >= 4) {
    showHint("Можно генерировать не больше четырёх изображений одновременно.", true);
    return;
  }
  const sources = panelRefs.map((ref) => ref.path);
  const job = {
    id: crypto.randomUUID(),
    surface: "panel",
    prompt,
    size: $("panel-aspect").value,
    source: sources[0],
    sources: sources.length ? sources : undefined,
    status: "loading",
    progress: 4,
    startedAt: Date.now(),
    image: null,
    error: null,
  };
  imageJobs.push(job);
  updatePanelGenerateButton();
  runImageJob(job);
  $("gallery-grid").scrollTop = 0;
}

function toolImageGrid(images) {
  const box = el("div", null, "tool-images");
  for (const image of images) {
    const button = el("button", null, "tool-image");
    button.type = "button";
    button.draggable = true;
    button.title = "Открыть изображение";
    const img = el("img");
    img.src = imageUrl(image);
    img.loading = "lazy";
    img.alt = image.prompt || "Изображение";
    button.append(img);
    button.onclick = () => openImagePanelAt(image);
    button.ondragstart = (event) => {
      if (!image.path) return;
      draggingImageCard = button;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-pf-image", image.path);
      event.dataTransfer.setData("text/image-url", imageUrl(image));
    };
    button.ondragend = () => {
      if (draggingImageCard === button) draggingImageCard = null;
    };
    box.append(button);
  }
  return box;
}

function imageToolLoader(count = 1) {
  const box = el("div", null, "tool-image-skeletons");
  for (let index = 0; index < Math.max(1, count); index += 1) {
    box.append(el("span", null, "tool-image-skeleton"));
  }
  return box;
}

function pickAttachments() {
  if (!connected) {
    showHint("Нет соединения с pi.", true);
    return;
  }
  if (!state.active) {
    showHint("Сначала откройте чат.", true);
    return;
  }
  if (state.active.readOnly) {
    showHint("Этот чат открыт в консоли.", true);
    return;
  }
  run("Выбираю файлы…", async () => {
    const result = await api("pick-attach", {}, 300000);
    const files = result.files || [];
    if (!files.length) return;
    const seen = new Set(attachments.map((item) => item.path.toLowerCase()));
    for (const file of files) {
      if (!file?.path || seen.has(file.path.toLowerCase())) continue;
      seen.add(file.path.toLowerCase());
      attachments.push({
        name: file.name || "Файл",
        path: file.path,
        ...(Number.isFinite(file.size) ? { size: file.size } : {}),
      });
    }
    renderAttachments();
    showHint(
      files.length === 1 ? `Прикреплён файл: ${files[0].name}` : `Прикреплено файлов: ${files.length}`,
    );
  });
}

const expandedDetails = new Map();

function copyText(text) {
  return (async () => {
    try {
      await navigator.clipboard.writeText(text);
      showHint("Скопировано.");
    } catch {
      showHint("Не удалось скопировать.", true);
    }
  })();
}

/* ============================== queue ============================== */

function scrollPageTop() {
  $("page").scrollTo({ top: 0, behavior: "smooth" });
}

function iconAction(name, title, run, cls = "queue-action") {
  const button = el("button", null, cls);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.append(icon(name));
  button.onclick = (event) => {
    event.stopPropagation();
    run();
  };
  return button;
}

function renderQueue() {
  const panel = $("queue-panel");
  const queue = queueOf();
  const messages = [...(queue.followUp || [])];
  const signature = JSON.stringify([messages, queueCollapsed, editingQueueIndex]);
  if (signature === queueSignature) {
    panel.hidden = !messages.length;
    return;
  }
  queueSignature = signature;
  panel.replaceChildren();
  panel.hidden = !messages.length;
  panel.classList.toggle("collapsed", queueCollapsed);
  if (!messages.length) {
    editingQueueIndex = null;
    return;
  }

  const head = el("div", null, "queue-head");
  const toggle = el("button", null, "queue-toggle");
  toggle.type = "button";
  toggle.title = queueCollapsed ? "Развернуть очередь" : "Свернуть очередь";
  toggle.append(
    icon("chevron-down"),
    el("span", "Очередь"),
    el("span", String(messages.length), "pill-badge info"),
  );
  toggle.onclick = () => {
    queueCollapsed = !queueCollapsed;
    try {
      localStorage.setItem("pf-queue-collapsed", queueCollapsed ? "1" : "0");
    } catch {}
    queueSignature = "";
    renderQueue();
  };

  const actions = el("div", null, "queue-actions");
  const sendAll = iconAction("send", "Отправить всё сейчас", sendAllQueued);
  sendAll.disabled = !messages.length;
  const clear = iconAction("trash", "Очистить очередь", clearQueue, "queue-action danger");
  actions.append(sendAll, clear);
  head.append(toggle, actions);

  const body = el("div", null, "queue-body");
  body.hidden = queueCollapsed;
  const list = el("div", null, "queue-list");
  if (!queueCollapsed) {
    messages.forEach((text, index) => {
      if (editingQueueIndex === index) {
        const row = el("div", null, "queue-item editing");
        const box = el("div", null, "queue-edit");
        const textarea = el("textarea");
        textarea.value = queueEditDraft;
        textarea.rows = 2;
        textarea.setAttribute("aria-label", "Текст сообщения в очереди");
        textarea.oninput = () => {
          queueEditDraft = textarea.value;
        };
        const editActions = el("div", null, "queue-edit-actions");
        const save = iconAction("check", "Сохранить", () => saveQueueEdit(index, textarea.value), "queue-action");
        save.classList.add("ok");
        const cancel = iconAction("close", "Отмена", () => {
          editingQueueIndex = null;
          queueEditDraft = "";
          queueEditAttachments = [];
          queueSignature = "";
          renderQueue();
        });
        editActions.append(cancel, save);
        box.append(textarea, editActions);
        row.append(box);
        list.append(row);
        return;
      }
      const row = el("div", null, "queue-item");
      row.append(el("span", String(index + 1), "queue-index"));
      const parsed = splitAttachments(text);
      const copy = el("span", parsed.text || (parsed.attachments.length ? "Файл" : text), "queue-text");
      copy.title = parsed.text || text;
      if (parsed.attachments.length) {
        copy.append(el("span", ` · ${parsed.attachments.length} файл(а)`, "queue-files"));
      }
      row.append(copy);
      const itemActions = el("div", null, "queue-item-actions");
      itemActions.append(
        iconAction("send", "Отправить сейчас, прервав ответ", () => sendQueuedNow(index)),
        iconAction("edit", "Редактировать", () => {
          editingQueueIndex = index;
          queueEditDraft = parsed.text;
          queueEditAttachments = parsed.attachments;
          queueSignature = "";
          renderQueue();
        }),
        iconAction("close", "Удалить из очереди", () => unqueue(index)),
      );
      row.append(itemActions);
      list.append(row);
    });
  }
  body.append(list);
  panel.append(head, body);
}

function sendQueuedNow(index) {
  run("Отправляю сейчас…", async () => {
    const result = await api("send-now", { chat: state.active.id, index }, 120000);
    state.queue = result.queue || { steering: [], followUp: [] };
    editingQueueIndex = null;
    queueEditDraft = "";
    queueEditAttachments = [];
    queueSignature = "";
    renderQueue();
    showHint("Сообщение отправлено.");
  });
}

function sendAllQueued() {
  run("Отправляю очередь…", async () => {
    const result = await api("send-all", { chat: state.active.id }, 120000);
    state.queue = result.queue || { steering: [], followUp: [] };
    editingQueueIndex = null;
    queueEditDraft = "";
    queueEditAttachments = [];
    queueSignature = "";
    renderQueue();
    showHint("Очередь отправлена.");
  });
}

function saveQueueEdit(index, text) {
  const value = buildOutgoingText(text, queueEditAttachments);
  if (!value) {
    showHint("Введите текст сообщения или прикрепите файл.", true);
    return;
  }
  run("Сохраняю сообщение…", async () => {
    const result = await api("edit-queue", { chat: state.active.id, index, text: value }, 60000);
    state.queue = result.queue || { steering: [], followUp: [] };
    editingQueueIndex = null;
    queueEditDraft = "";
    queueEditAttachments = [];
    queueSignature = "";
    renderQueue();
    showHint("Сообщение в очереди обновлено.");
  });
}

function queueMessage(text) {
  const visible = String(text || "").trim();
  const items = [...attachments];
  const value = buildOutgoingText(visible, items);
  if (!value || !state.active) return;
  if (!canQueue()) return;
  const chat = state.active.id;
  const before = queueOf().followUp?.length || 0;
  state.queue = { ...queueOf(), followUp: [...(queueOf().followUp || []), value] };
  renderQueue();
  attachments = [];
  renderAttachments();
  $("draft").value = "";
  store(chat, "");
  autoGrow();
  renderStatus();
  beginTask("Ставлю в очередь…");
  api("prompt", { chat, text: value }, 60000)
    .then(() => {
      queueSignature = "";
      renderQueue();
      showHint("Сообщение добавлено в очередь.");
    })
    .catch((error) => {
      const followUp = [...(queueOf().followUp || [])];
      if (followUp.length > before) followUp.splice(before, 1);
      state.queue = { ...queueOf(), followUp };
      queueSignature = "";
      renderQueue();
      if (!$("draft").value) {
        $("draft").value = visible;
        store(chat, visible);
        autoGrow();
      }
      if (!attachments.length && items.length) {
        attachments = items;
        renderAttachments();
      }
      showHint(error.message, true);
    })
    .finally(() => {
      endTask();
      renderStatus();
    });
}

function canQueue() {
  if (!connected) {
    showHint("Нет соединения с pi.", true);
    return false;
  }
  if (state.ready === false) {
    showHint("Чат ещё подключается. Подождите секунду.", true);
    return false;
  }
  if (state.active?.readOnly) {
    showHint("Этот чат открыт в консоли. Создайте новый чат.", true);
    return false;
  }
  if (state.active?.host && state.busy) {
    showHint("В консоли уже идёт ответ. Дождитесь его завершения.", true);
    return false;
  }
  return true;
}

function unqueue(index) {
  run("Убираю из очереди…", async () => {
    const result = await api("unqueue", { chat: state.active.id, index }, 30000);
    state.queue = result.queue || { steering: [], followUp: [] };
    if (editingQueueIndex != null && editingQueueIndex >= index) {
      editingQueueIndex = null;
      queueEditDraft = "";
      queueEditAttachments = [];
    }
    queueSignature = "";
    renderQueue();
    if (result.removed) {
      const parsed = splitAttachments(result.removed);
      if (!$("draft").value) {
        $("draft").value = parsed.text;
        store(state.active.id, parsed.text);
        attachments = parsed.attachments;
        renderAttachments();
        autoGrow();
      }
    }
  });
}

function clearQueue() {
  run("Очищаю очередь…", async () => {
    const result = await api("clear-queue", { chat: state.active.id }, 30000);
    const returned = [...(result.steering || []), ...(result.followUp || [])];
    state.queue = { steering: [], followUp: [] };
    editingQueueIndex = null;
    queueEditDraft = "";
    queueEditAttachments = [];
    queueSignature = "";
    renderQueue();
    if (returned.length && !$("draft").value) {
      $("draft").value = returned.join("\n");
      store(state.active.id, $("draft").value);
      autoGrow();
      showHint("Очередь очищена, текст возвращён в поле ввода.");
    } else if (returned.length) {
      showHint("Очередь очищена. Текст не помещён в поле, потому что там уже есть черновик.");
    } else {
      showHint("Очередь пуста.");
    }
  });
}

/* ============================== send / edit / fork ============================== */

function sendMessage(text) {
  const visible = String(text || "").trim();
  const items = [...attachments];
  const value = buildOutgoingText(visible, items);
  if (!value || !state.active || !canQueue()) return;
  const chat = state.active.id;
  attachments = [];
  renderAttachments();
  $("draft").value = "";
  store(chat, "");
  autoGrow();
  renderStatus();
  beginTask("Отправляю сообщение…");
  api("prompt", { chat, text: value }, 60000)
    .then(() => {
      showError("");
    })
    .catch((error) => {
      if (!$("draft").value) {
        $("draft").value = visible;
        store(chat, visible);
        autoGrow();
      }
      if (!attachments.length && items.length) {
        attachments = items;
        renderAttachments();
      }
      showHint(error.message, true);
    })
    .finally(() => {
      endTask();
      renderStatus();
    });
}

function abortGeneration() {
  if (!state.active) return;
  run("Останавливаю ответ…", async () => {
    const result = await api("abort", { chat: state.active.id }, 30000);
    const returned = [...(result.cleared?.steering || []), ...(result.cleared?.followUp || [])];
    state.queue = { steering: [], followUp: [] };
    editingQueueIndex = null;
    queueEditDraft = "";
    queueEditAttachments = [];
    queueSignature = "";
    renderQueue();
    if (returned.length && !$("draft").value) {
      $("draft").value = returned.join("\n");
      store(state.active.id, $("draft").value);
      autoGrow();
      showHint("Ответ остановлен. Очередь возвращена в поле ввода.");
    }
  });
}

function forkMessage(index, text) {
  if (!state.active) return;
  if (!canSwitch()) return;
  const chat = state.active.id;
  const label = text ? "Создаю чат и отправляю…" : "Создаю чат…";
  run(label, async () => {
    const next = await api("fork", { chat, index, text: text || "" }, 90000);
    applyState(next);
    page = "chat";
    editingIndex = null;
    renderedSignature = "";
    loadCatalog().catch(() => {});
    renderRoute();
    $("draft").focus();
    showHint(text ? "Новый чат создан, сообщение отправлено." : "Новый чат создан.");
  });
}

/* ============================== status ============================== */

function elapsedSeconds() {
  return Math.floor((clockBase + (state.busy ? Math.max(0, performance.now() - clockAt) : 0)) / 1000);
}
function progressTime() {
  const seconds = elapsedSeconds();
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderStatus() {
  const busy = Boolean(state.busy);
  const ready = state.ready !== false;
  const voice = state.voice;
  const recording = ["starting", "recording", "transcribing"].includes(voice?.phase);
  const navigating = Boolean(state.loading || pending || uploading);
  const readOnly = Boolean(state.active?.readOnly);
  $("exit").disabled = Boolean(busy || navigating || recording);
  $("draft").disabled = Boolean(readOnly || !connected);
  $("attach").hidden = !(page === "chat" && state.active && !readOnly);
  $("attach").disabled = !connected || readOnly;
  $("mic").disabled = !connected || !state.active || readOnly || voice?.phase === "transcribing";
  $("mic").replaceChildren(icon(voice?.phase === "recording" ? "stop" : "mic"));
  $("mic").setAttribute("aria-label", voice?.phase === "recording" ? "Закончить запись" : "Начать диктовку");
  const panelMic = $("panel-mic");
  if (panelMic) {
    panelMic.disabled = !connected || !state.active || readOnly || voice?.phase === "transcribing";
    panelMic.replaceChildren(icon(voice?.phase === "recording" ? "stop" : "mic"));
    panelMic.setAttribute("aria-label", voice?.phase === "recording" ? "Закончить запись" : "Начать диктовку");
  }

  const draftText = $("draft").value.trim();
  const queueButton = $("queue-send");
  if (queueButton) {
    queueButton.hidden = !(busy && (draftText || attachments.length) && !readOnly && connected && !state.active?.host);
    queueButton.disabled = !connected || (!draftText && !attachments.length) || !ready;
    queueButton.onclick = (event) => {
      event.preventDefault();
      queueMessage($("draft").value);
    };
  }
  const send = $("send");
  send.classList.toggle("stop", busy);
  send.replaceChildren(icon(busy ? "stop" : "arrow-up"));
  send.title = busy ? "Остановить ответ (Esc)" : "Отправить (Enter)";
  send.setAttribute("aria-label", busy ? "Остановить ответ" : "Отправить");
  send.disabled = !connected || navigating || recording || readOnly || !ready || (!busy && !draftText && !attachments.length);
  $("readonly").hidden = !readOnly;

  renderModelSelect(Boolean(busy || navigating || recording || state.loading || uploading || !ready || modelSwitching));
  renderQuestions();
  renderVoice(voice, recording);
  renderQuota();
  showError(state.error && !state.messages?.some((message) => message.error === state.error) ? state.error : "");
  $("notice").textContent = state.notice || "";
  $("notice").hidden = !state.notice;
  renderConnection();
  updateImageBadge();
  if (imagePanelOpen) renderPanelSkeletons();
}


function renderVoice(voice, recording) {
  const panelRecording = Boolean(recording && voiceTarget === "panel" && imagePanelOpen);
  $("voice-view").hidden = !recording || panelRecording;
  $("panel-voice-view").hidden = !panelRecording;
  $("draft").style.visibility = recording && !panelRecording ? "hidden" : "visible";
  $("panel-prompt").style.visibility = panelRecording ? "hidden" : "visible";
  if (recording) {
    const seconds = voice.seconds || 0;
    const label = panelRecording ? $("panel-voice-label") : $("voice-label");
    label.textContent =
      voice.phase === "recording"
        ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · Enter — закончить`
        : voice.phase === "transcribing"
          ? `Распознаю · ${Math.round(voice.percent || 0)}%`
          : "Включаю микрофон…";
    drawWave(voice.levels || [], panelRecording ? "panel-wave" : "wave");
  }
  const setup = $("voice-setup");
  setup.replaceChildren();
  if (voice && ["installing", "downloading", "loading", "error"].includes(voice.phase)) {
    setup.append(el("span", voice.phase === "error" ? "Голос не загрузился" : voice.label || "Подготовка голоса"));
    if (Number.isFinite(voice.percent)) {
      setup.append(el("span", ` · ${Math.round(voice.percent)}%`));
      const progress = el("progress");
      progress.max = 100;
      progress.value = voice.percent;
      setup.append(progress);
    }
  }
}

function renderQuota() {
  const available = state.routerProgress?.available ?? state.billing?.account?.available;
  $("quota").textContent = Number.isFinite(available)
    ? "Осталось " + Math.max(0, available).toLocaleString("ru-RU") + " токенов"
    : Object.values(state.statuses || {})
        .filter((value) => /осталось|quota|remaining/i.test(value))
        .join(" ");
}

async function renderQuestions() {
  const question = (state.questions || []).find((item) => !item.expires || item.expires > Date.now());
  if (question?.id === questionId) return;
  questionId = question?.id;
  $("question").replaceChildren();
  if (!question) return;
  const box = el("div", null, "question");
  box.append(el("h2", question.title || "Нужен ваш ответ"));
  if (question.message) box.append(el("p", question.message));
  const actions = el("div", null, "question-actions");
  const answer = (data) =>
    run("Отправляю ответ…", async () => {
      await api("answer", { chat: state.active?.id, id: question.id, ...data }, 30000);
      state.questions = (state.questions || []).filter((item) => item.id !== question.id);
      questionId = undefined;
      renderQuestions();
    });
  if (question.method === "select") {
    for (const option of question.options || []) {
      const button = el("button", option, "button");
      button.type = "button";
      button.onclick = () => answer({ value: option });
      actions.append(button);
    }
  } else if (question.method === "confirm") {
    const yes = el("button", "Да", "button primary");
    yes.type = "button";
    yes.onclick = () => answer({ confirmed: true });
    const no = el("button", "Нет", "button");
    no.type = "button";
    no.onclick = () => answer({ confirmed: false });
    actions.append(yes, no);
  } else {
    const input = el(question.method === "editor" ? "textarea" : "input");
    input.value = question.prefill || "";
    input.placeholder = question.placeholder || "";
    box.append(input);
    const submit = el("button", "Продолжить", "button primary");
    submit.type = "button";
    submit.onclick = () => answer({ value: input.value });
    actions.append(submit);
  }
  const cancel = el("button", "Отмена", "button ghost");
  cancel.type = "button";
  cancel.onclick = () => answer({ cancelled: true });
  actions.append(cancel);
  box.append(actions);
  $("question").append(box);
}

function drawWave(levels, canvasId = "wave") {
  const canvas = $(canvasId);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent-ink") || "#1e40af";
  const count = Math.floor(width / 4);
  const samples = levels.slice(-count);
  for (let index = 0; index < count; index += 1) {
    const value = samples[index - (count - samples.length)] || 0;
    const bar = Math.max(2, Math.pow(value, 0.7) * (height - 2));
    ctx.fillRect(index * 4, (height - bar) / 2, 1.5, bar);
  }
}

/* ============================== model menu ============================== */

function renderModelSelect(blocked = false) {
  const select = $("model-select");
  const current = state.active?.model;
  select.disabled = Boolean(blocked || modelSwitching || !connected || !state.active || state.active.readOnly || state.ready === false);
  if (select.disabled && modelMenu.matches(":popover-open")) modelMenu.hidePopover();
  if (modelSwitching) {
    select.dataset.name = "";
    select.replaceChildren(el("span", "Переключаю модель…"), el("span", null, "model-spinner"));
    select.title = "Переключение модели…";
    return;
  }
  const name = current?.name || current?.id || "Модель";
  if (select.dataset.name !== name) {
    select.replaceChildren(el("span", name), icon("chevron-down"));
    select.dataset.name = name;
    select.title = "Выбрать модель · " + name;
    select.setAttribute("aria-label", select.title);
  }
  if (state.active && !modelsLoaded && !modelsLoading && Date.now() > modelRetryAfter) {
    loadModels();
  }
  renderModelMenu();
}

function loadModels() {
  if (modelsLoading || modelsLoaded) return;
  modelsLoading = true;
  modelsError = "";
  renderModelMenu();
  api("models", undefined, 20000)
    .then((result) => {
      modelList = result.models || [];
      modelsLoaded = true;
    })
    .catch((error) => {
      modelsError = error.message;
      modelRetryAfter = Date.now() + 15000;
    })
    .finally(() => {
      modelsLoading = false;
      renderModelMenu();
    });
}

function renderModelMenu() {
  const current = state.active?.model;
  const models = [...modelList];
  if (current && !models.some((model) => modelKey(model) === modelKey(current))) models.unshift(current);
  const signature = JSON.stringify([models, current, modelsLoading, modelsError]);
  if (modelMenu.dataset.signature === signature) return;
  modelMenu.dataset.signature = signature;
  modelMenu.replaceChildren();
  modelMenu.append(el("div", "Модель", "model-menu-title"));
  if (modelsLoading && !models.length) {
    const loading = el("div", null, "model-loading");
    for (let index = 0; index < 4; index += 1) {
      const line = el("span", null, "skeleton w-80");
      loading.append(line);
    }
    loading.append(el("div", "Загружаю модели…", "model-error"));
    modelMenu.append(loading);
    return;
  }
  if (modelsError && !models.length) {
    const error = el("div", null, "model-error");
    error.append(document.createTextNode(modelsError));
    const retry = el("button", "Повторить", "button");
    retry.type = "button";
    retry.onclick = () => {
      modelsLoaded = false;
      loadModels();
    };
    error.append(retry);
    modelMenu.append(error);
    return;
  }
  if (!models.length) {
    modelMenu.append(el("div", "Модели ещё не загружены.", "model-error"));
    return;
  }
  for (const model of models) {
    const chosen = current && modelKey(model) === modelKey(current);
    const option = el("button", null, "model-option");
    option.type = "button";
    option.setAttribute("aria-pressed", String(Boolean(chosen)));
    const copy = el("span");
    copy.append(el("span", model.name || model.id), el("small", model.provider || ""));
    option.append(copy, icon("check"));
    option.onclick = () => {
      modelMenu.hidePopover();
      if (chosen || modelSwitching) return;
      modelSwitching = true;
      beginTask("Переключаю модель…");
      renderModelSelect();
      renderStatus();
      api("model", { chat: state.active.id, id: model.id, provider: model.provider }, 30000)
        .then(() => {
          state.active = { ...state.active, model };
          showHint(`Модель: ${model.name || model.id}`);
        })
        .catch((error) => showHint(error.message, true))
        .finally(() => {
          modelSwitching = false;
          endTask();
          renderModelSelect();
          renderStatus();
        });
    };
    modelMenu.append(option);
  }
  if (modelsError) modelMenu.append(el("div", modelsError, "model-error"));
}

function modelKey(model) {
  return JSON.stringify([model?.provider, model?.id]);
}

function positionModels() {
  const rect = $("model-select").getBoundingClientRect();
  modelMenu.style.width = Math.min(320, innerWidth - 24) + "px";
  modelMenu.style.left = Math.max(12, Math.min(rect.left, innerWidth - 332)) + "px";
  modelMenu.style.top = "auto";
  modelMenu.style.bottom = Math.max(12, innerHeight - rect.top + 8) + "px";
  modelMenu.style.maxHeight = Math.max(120, rect.top - 24) + "px";
}

/* ============================== folder browser ============================== */

let browserPath = "";
let browserChosen = null;
let browserRequest = 0;

async function browseFolders(path) {
  const request = ++browserRequest;
  $("folder-choose").disabled = true;
  const status = $("browser-status");
  status.textContent = "Загружаю папки…";
  const list = $("browser-list");
  list.replaceChildren();
  const loading = el("div", null, "skeleton-list");
  for (let index = 0; index < 5; index += 1) {
    const row = el("div", null, "skeleton-row");
    row.append(el("span", null, "skeleton w-60"));
    loading.append(row);
  }
  list.append(loading);
  beginTask("Загружаю папки…");
  try {
    const data = await api("browse-folders" + (path ? "?path=" + encodeURIComponent(path) : ""), undefined, 30000);
    if (request !== browserRequest || !$("folder-dialog").open) return;
    browserPath = data.path;
    browserChosen = data.path;
    renderBrowser(data);
  } catch (error) {
    if (request === browserRequest && $("folder-dialog").open) status.textContent = error.message;
  } finally {
    endTask();
  }
}

function renderBrowser({ path, parent, entries, shortcuts = [] }) {
  $("folder-path").value = path;
  $("browser-status").textContent = entries.length
    ? "Откройте нужную папку и нажмите «Выбрать эту папку»."
    : "Вложенных папок нет. Можно выбрать эту папку.";
  const quick = $("browser-shortcuts");
  quick.replaceChildren();
  quick.hidden = !shortcuts.length;
  if (shortcuts.length) {
    const title = el("div", "Быстрый переход", "browser-section-title");
    const grid = el("div", null, "browser-shortcut-grid");
    for (const shortcut of shortcuts) {
      const card = el("button", null, "browser-shortcut");
      card.type = "button";
      const kind =
        shortcut.kind === "desktop"
          ? "desktop"
          : shortcut.kind === "downloads"
            ? "download"
            : shortcut.kind === "documents"
              ? "file"
              : shortcut.kind === "projects"
                ? "projects"
                : "home";
      card.append(icon(kind === "projects" ? "folder" : kind), el("span", shortcut.name, "shortcut-name"));
      card.title = shortcut.path;
      card.onclick = () => browseFolders(shortcut.path);
      grid.append(card);
    }
    quick.append(title, grid);
  }
  const list = $("browser-list");
  list.replaceChildren();
  const up = el("button", null, "browser-row parent");
  up.type = "button";
  up.disabled = !parent;
  const upIcon = icon("arrow");
  upIcon.classList.add("up");
  up.append(upIcon, el("span", "На уровень выше", "browser-name"));
  up.onclick = () => browseFolders(parent);
  list.append(up);
  for (const entry of entries.filter((item) => !item.name.startsWith("."))) {
    const row = el("button", null, "browser-row");
    row.type = "button";
    row.append(icon("folder"), el("span", entry.name, "browser-name"));
    row.onclick = () => browseFolders(entry.path);
    list.append(row);
  }
  if (!entries.length) list.append(el("p", "В этой папке нет вложенных папок.", "browser-empty"));
  $("folder-choose").disabled = false;
}

function chooseFolder() {
  if (!browserChosen || $("folder-choose").disabled) return;
  const chosen = browserChosen;
  $("folder-dialog").close();
  run("Подключаю папку…", async () => {
    const result = await api("attach-project", { path: chosen }, 45000);
    if (result.cancelled) return;
    catalog = result.projects || [];
    projectId = result.project || null;
    page = "chats";
    searchOpen = false;
    searchValue = "";
    renderRoute();
    showHint("Папка подключена как проект.");
  });
}

/* ============================== uploads ============================== */

function uploadFiles() {
  return (async () => {
    const files = [...($("file-input").files || [])];
    $("file-input").value = "";
    if (!files.length) return;
    const project = state.active?.projectId;
    if (!project) {
      showHint("Сначала откройте чат в проекте.", true);
      return;
    }
    const payload = [];
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        showHint(`«${file.name}» больше 50 МБ и был пропущен.`, true);
        continue;
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < buffer.length; index += 0x8000)
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      payload.push({ name: file.name, content: btoa(binary), truncated: false });
    }
    if (!payload.length) return;
    uploading = true;
    renderProgress();
    renderStatus();
    try {
      const result = await api("upload", { project, files: payload }, 120000);
      if (result.saved?.length)
        showHint(
          result.saved.length === 1
            ? `Файл «${result.saved[0]}» сохранён в проекте.`
            : `Сохранено файлов: ${result.saved.length}.`,
        );
    } catch (error) {
      showHint(error.message, true);
    } finally {
      uploading = false;
      renderProgress();
      renderStatus();
    }
  })();
}

/* ============================== apply server state ============================== */

function applyState(next) {
  if (pendingOpenId && next.active?.id !== pendingOpenId) return;
  const now = performance.now();
  const request = next.routerProgress?.requestId;
  if (
    next.busy &&
    (!state.busy || next.active?.id !== state.active?.id || (request && clockRequest && request !== clockRequest))
  ) {
    clockBase = 0;
    clockAt = now;
  }
  if (next.busy && Number.isFinite(next.routerProgress?.elapsedMs)) {
    clockBase = Math.max(next.routerProgress.elapsedMs, clockBase + Math.max(0, now - clockAt));
    clockAt = now;
  }
  if (request) clockRequest = request;
  if (!next.busy) clockRequest = undefined;
  billingUI.update(next.billing, next.busy);
  const previous = state.active?.id;
  const previousName = state.active?.id && state.active.id === next.active?.id ? state.active.name : null;
  state = next;
  if (previousName && state.active?.name && previousName !== state.active.name) {
    const project = projectOf(state.active.projectId);
    const chat = project?.chats.find((item) => item.id === state.active.id);
    if (chat) chat.name = state.active.name;
    renderBranches();
  }
  if (state.active?.id && state.messageVersions)
    versionManager.syncFromServer(state.messageVersions, state.active.id);
  if (previous !== state.active?.id) {
    store(previous, $("draft").value);
    $("draft").value = saved(state.active?.id);
    editingIndex = null;
    void refreshImageLibrary();
    questionId = undefined;
    versionManager.reset();
    renderedSignature = "";
    queueSignature = "";
    attachments = [];
    renderAttachments();
    autoGrow();
  }
  if (state.dictation && state.dictation.id !== dictationId && saved("dictation-" + state.dictation.chat) !== state.dictation.id) {
    dictationId = state.dictation.id;
    store("dictation-" + state.dictation.chat, dictationId);
    const dictation = state.dictation;
    const toPanel =
      typeof voiceTarget !== "undefined" &&
      voiceTarget === "panel" &&
      typeof imagePanelOpen !== "undefined" &&
      imagePanelOpen &&
      dictation.chat === state.active?.id;
    if (toPanel) {
      const area = $("panel-prompt");
      const old = area.value;
      const text = dictation.replace ? dictation.text : old + (old ? " " : "") + dictation.text;
      area.value = text;
      area.style.height = "auto";
      area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
      updatePanelGenerateButton();
      area.focus();
    } else {
      const old = dictation.chat === state.active?.id ? $("draft").value : saved(dictation.chat);
      const text = dictation.replace ? dictation.text : old + (old ? " " : "") + dictation.text;
      store(dictation.chat, text);
      if (dictation.chat === state.active?.id) $("draft").value = text;
    }
  }
  if (state.active?.projectId) projectId = state.active.projectId;
  if (state.active && !lastChat) {
    lastChat = state.active.id;
    page = "chat";
    renderRoute();
    return;
  }
  if (!state.active && page === "chat") {
    page = "chats";
    renderRoute();
    return;
  }
  if (page === "chat") {
    renderBranches();
    renderChat();
    const project = projectOf(state.active?.projectId || projectId);
    setBreadcrumb(
      state.active?.name || "Чат",
      `${project?.name || state.active?.projectName || ""}${project?.folder ? " · " + project.folder : ""}`,
    );
  } else if (page === "projects" || page === "chats") {
    renderBranches();
  }
}

/* ============================== misc UI ============================== */

function autoGrow() {
  requestAnimationFrame(() => {
    const area = $("draft");
    if (!area) return;
    area.style.height = "auto";
    area.style.height = Math.min(area.scrollHeight, 250) + "px";
  });
}

boot();
