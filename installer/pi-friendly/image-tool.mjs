import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const IMAGE_SIZES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1920x1080",
  "1080x1920",
  "2048x1152",
  "2048x2048",
  "2560x1440",
];

function imageDimensions(data) {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    return { format: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = data.readUInt16BE(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xc3 ||
        marker >= 0xc5 &&
        marker <= 0xc7 ||
        marker >= 0xc9 &&
        marker <= 0xcb ||
        marker >= 0xcd &&
        marker <= 0xcf
      ) {
        return {
          format: "jpg",
          width: data.readUInt16BE(offset + 7),
          height: data.readUInt16BE(offset + 5),
        };
      }
      offset += 2 + length;
    }
  }
  return null;
}

function safeSession(value) {
  const text = String(value || "chat")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 96);
  return text || "chat";
}

function validateSize(size) {
  if (size === undefined || size === null || size === "") return undefined;
  if (!IMAGE_SIZES.includes(size)) throw new Error("Недопустимый размер изображения.");
  return size;
}

async function bodyBuffer(body) {
  if (body instanceof FormData) {
    const boundary = "----pi" + randomUUID();
    const chunks = [];
    for (const [name, value] of body.entries()) {
      if (typeof value === "string") {
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      } else {
        const data = Buffer.from(await value.arrayBuffer());
        const filename = value.name || "blob";
        const type = value.type || "application/octet-stream";
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`));
        chunks.push(data, Buffer.from("\r\n"));
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { data: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }
  return { data: Buffer.isBuffer(body) ? body : Buffer.from(body || ""), contentType: null };
}

async function nativeFetch(url, options = {}) {
  const target = new URL(url);
  const lib = target.protocol === "https:" ? https : http;
  const { data, contentType } = await bodyBuffer(options.body);
  const headers = { ...(options.headers || {}) };
  if (contentType) headers["Content-Type"] = contentType;
  headers["Content-Length"] = String(data.length);
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "accept-encoding")) headers["Accept-Encoding"] = "identity";
  return new Promise((resolve, reject) => {
    const request = lib.request(target, { method: options.method || "GET", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 0, headers: response.headers }));
      });
    });
    const abort = () => request.destroy(new Error("Запрос прерван."));
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
      request.on("close", () => options.signal.removeEventListener("abort", abort));
    }
    request.on("error", reject);
    request.end(data);
  });
}

export async function runImageTool(
  { prompt, source, sources, size, idempotencyKey, sessionId },
  cwd,
  connection,
  signal,
  fetcher = nativeFetch,
  options = {},
) {
  if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 32000)
    throw new Error("Укажите описание изображения длиной до 32 КБ.");
  const imageSize = validateSize(size);
  const root = await realpath(cwd);
  const url = new URL(connection.baseURL);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !connection.apiKey
  )
    throw new Error("Проверьте подключение роутера.");

  const fields = { model: "gpt-image-2.5", prompt, n: 1, response_format: "b64_json" };
  if (imageSize) fields.size = imageSize;
  const key = String(idempotencyKey || randomUUID()).slice(0, 128);
  const headers = {
    Authorization: "Bearer " + connection.apiKey,
    "Idempotency-Key": key,
  };
  let body;
  const refs = (Array.isArray(sources) ? sources : source ? [source] : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 1);
  const sourcePaths = [];
  if (refs.length) {
    body = new FormData();
    for (const [field, value] of Object.entries(fields)) body.set(field, String(value));
    for (const ref of refs) {
      const path = await realpath(resolve(root, ref));
      const rel = relative(root, path);
      if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
        throw new Error("Исходное изображение должно находиться в папке проекта.");
      const file = await open(path, "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 11 * 1024 * 1024)
          throw new Error("Выберите PNG или JPEG до 11 МБ.");
        const data = await file.readFile();
        const jpeg = data[0] === 0xff && data[1] === 0xd8;
        sourcePaths.push(rel.split(sep).join("/"));
        body.append(
          "image",
          new Blob([data], { type: jpeg ? "image/jpeg" : "image/png" }),
          `${jpeg ? "input" : "input"}-${sourcePaths.length}.${jpeg ? "jpg" : "png"}`,
        );
      } finally {
        await file.close();
      }
    }
  } else {
    body = JSON.stringify(fields);
    headers["Content-Type"] = "application/json";
  }
  url.pathname =
    url.pathname.replace(/\/$/, "") + (sourcePaths.length ? "/images/edits" : "/images/generations");
  const response = await fetcher(url, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: signal || undefined,
  });
  const chunks = [];
  let sizeBytes = 0;
  for await (const chunk of response.body || []) {
    sizeBytes += chunk.length;
    if (sizeBytes > 21 * 1024 * 1024) throw new Error("Изображение превышает допустимый размер.");
    chunks.push(chunk);
  }
  let reply;
  try {
    reply = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    reply = {};
  }
  if (!response.ok) {
    const error = new Error(
      reply?.error?.message || `Не удалось получить изображение (HTTP ${response.status}).`,
    );
    error.status = response.status;
    error.code = reply?.error?.code;
    error.requestId = response.headers.get("x-request-id") || undefined;
    throw error;
  }
  const data = Buffer.from(reply?.data?.[0]?.b64_json || "", "base64");
  const dimensions = data.length ? imageDimensions(data) : null;
  if (!dimensions) {
    const error = new Error("Роутер вернул некорректное изображение.");
    error.status = 502;
    error.code = "invalid_image_response";
    throw error;
  }
  const session = safeSession(sessionId || options.sessionId);
  const directory = join(root, "generated", session);
  await mkdir(directory, { recursive: true });
  const id = randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `image-${stamp}-${id.slice(0, 8)}.${dimensions.format}`;
  const target = join(directory, filename);
  await writeFile(target, data, { flag: "wx", mode: 0o600 });
  const relPath = relative(root, target).split(sep).join("/");
  const record = {
    id,
    file: relPath,
    path: relPath,
    name: filename,
    width: dimensions.width,
    height: dimensions.height,
    format: dimensions.format,
    prompt,
    size: imageSize || null,
    source: sourcePaths[0] || null,
    sources: sourcePaths,
    createdAt: new Date().toISOString(),
    chatId: session,
    requestId: key,
  };
  await writeFile(
    target.replace(/\.[^.]+$/, ".json"),
    JSON.stringify(record, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  return {
    content: [{ type: "text", text: `Готовое изображение сохранено в проекте: ${relPath}` }],
    details: { file: relPath, image: record, images: [record] },
  };
}

export async function setImageTitle(cwd, record, title) {
  if (!record?.file || !title) return;
  record.title = title;
  try {
    const sidecar = join(resolve(cwd), record.file.replace(/\.[^.]+$/, ".json"));
    const data = JSON.parse(await readFile(sidecar, "utf8"));
    data.title = title;
    await writeFile(sidecar, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch {}
}
