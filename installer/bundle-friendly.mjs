// Snapshot committed runtime files; local drafts, tests and user data are excluded.
// Usage: node installer/bundle-friendly.mjs /path/to/pi-friendly [revision]
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repository = process.argv[2];
if (!repository) throw Error('Pass the pi-friendly checkout');
const git = (...args) => execFileSync('git', ['-C', repository, ...args], {maxBuffer:16*1024*1024});
const revision = git('rev-parse', process.argv[3] || 'HEAD').toString().trim();
const files = git('ls-tree', '-r', '--name-only', revision).toString().trim().split('\n').filter(f =>
  f === 'LICENSE' || f === 'package.json' || f === 'router/LICENSE' ||
  /^(?:web|router)\/[\w.-]+\.(?:mjs|js|ts|css|html)$/.test(f) && !f.includes('.test.') ||
  /^[\w.-]+\.(?:mjs|ts|py)$/.test(f) && !/(?:\.test\.|^test_|smoke|preview)/.test(f));
const target = new URL('./pi-friendly/', import.meta.url);
const manifest = {repository:'https://github.com/slavamirniy/pi-friendly', revision, version:'', embeddedRouter:true, files:{}};
for (const file of files) {
  const data = git('show', `${revision}:${file}`);
  await fs.mkdir(new URL('./', new URL(file, target)), {recursive:true});
  await fs.writeFile(new URL(file, target), data);
  manifest.files[file] = createHash('sha256').update(data).digest('hex');
  if (file === 'package.json') manifest.version = JSON.parse(data).version;
}
if (!files.includes('router/index.ts')) throw Error('This release requires the integrated router extension');
await fs.writeFile(new URL('bundle.json', target), JSON.stringify(manifest,null,2)+'\n');
console.log(`Bundled pi-friendly ${manifest.version}: ${files.length} runtime files at ${revision}`);
