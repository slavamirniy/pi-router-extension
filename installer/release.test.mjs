import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = f => fs.readFile(new URL(f,root),'utf8');
const hash = async f => createHash('sha256').update(await fs.readFile(new URL(f,root))).digest('hex');

test('Windows and Bash download the same complete, hash-pinned UI and quota runtime', async () => {
  const windows = await read('installer/install-pi-windows.ps1');
  const linux = await read('installer/install-pi-linux.sh');
  const winSource = windows.match(/\$TaskSource = '([^']+)'/)[1];
  assert.match(winSource,/\/pi-router-extension\/[a-f0-9]{40}$/);
  assert.equal(linux.match(/TASK_SOURCE="([^"]+)"/)[1],winSource);
  const winEntries = Object.fromEntries([...windows.matchAll(/'([^']+)' = '([a-f0-9]{64})'/g)].map(m=>[m[1],m[2]]));
  const linuxEntries = Object.fromEntries(linux.split("done <<'MANIFEST'\n")[1].split('\nMANIFEST')[0].split('\n').map(s=>s.split(' ')));
  assert.deepEqual(winEntries,linuxEntries);
  const bundle=JSON.parse(await read('installer/pi-friendly/bundle.json'));
  for(const f of Object.keys(bundle.files)) assert.ok(winEntries['installer/pi-friendly/'+f]);
  for(const f of ['index.ts','models.mjs','progress.mjs','safety.mjs','installer/configure.mjs','installer/friendly.mjs','installer/pi-friendly/bundle.json']) assert.ok(winEntries[f]);
  for(const [f,h] of Object.entries(winEntries)) assert.equal(await hash(f),h,f);
});

test('macOS and short Windows entry use this release and macOS verifies the shared installer',async()=>{
  const {version}=JSON.parse(await read('package.json'));
  const mac=await read('installer/install-pi-macos.sh');
  assert.ok(mac.includes(`/v${version}/installer/install-pi-linux.sh`));
  assert.equal(mac.match(/TASK_COMMON_HASH='([^']+)'/)[1],await hash('installer/install-pi-linux.sh'));
  assert.ok((await read('i.ps1')).includes(`/v${version}/installer/install-pi-windows.ps1`));
});
