import { randomUUID } from 'node:crypto';
import { open, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export async function runImageTool({ prompt, source }, cwd, connection, signal, fetcher = fetch) {
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 32000)
    throw Error('Укажите описание изображения длиной до 32 КБ.');
  const root = await realpath(cwd);
  const url = new URL(connection.baseURL);
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || !connection.apiKey)
    throw Error('Проверьте подключение роутера.');
  const fields = { model: 'gpt-image-2.5', prompt, response_format: 'b64_json' };
  const headers = { Authorization: 'Bearer ' + connection.apiKey, 'Idempotency-Key': randomUUID() };
  let body;
  if (source) {
    const path = await realpath(resolve(root, source));
    const rel = relative(root, path);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
      throw Error('Исходное изображение должно находиться в папке проекта.');
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 11 * 1024 * 1024) throw Error('Выберите PNG или JPEG до 11 МБ.');
      const data = await file.readFile();
      const jpeg = data[0] === 0xff && data[1] === 0xd8;
      body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.set(k, v);
      body.set('image', new Blob([data], {type: jpeg ? 'image/jpeg' : 'image/png'}), jpeg ? 'input.jpg' : 'input.png');
    } finally { await file.close(); }
  } else {
    body = JSON.stringify(fields);
    headers['Content-Type'] = 'application/json';
  }
  url.pathname = url.pathname.replace(/\/$/, '') + (source ? '/images/edits' : '/images/generations');
  const timeout = AbortSignal.timeout(610000);
  const response = await fetcher(url, { method:'POST', headers, body, redirect:'error',
    signal: signal ? AbortSignal.any([signal,timeout]) : timeout });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > 21 * 1024 * 1024) throw Error('Изображение превышает допустимый размер.');
    chunks.push(chunk);
  }
  const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!response.ok) throw Error(reply?.error?.message || 'Не удалось получить изображение.');
  const data = Buffer.from(reply?.data?.[0]?.b64_json || '', 'base64');
  const ext = data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'png'
    : data[0] === 0xff && data[1] === 0xd8 ? 'jpg' : null;
  if (!ext) throw Error('Роутер вернул некорректное изображение.');
  const filename = 'image-' + randomUUID() + '.' + ext;
  await writeFile(join(root,filename), data, {flag:'wx',mode:0o600});
  return {content:[{type:'text', text:'Готовое изображение сохранено в проекте: ' + filename}], details:{file:filename}};
}
