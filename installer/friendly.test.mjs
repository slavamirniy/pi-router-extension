import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {configure} from './configure.mjs';
import {prepareFriendly} from './friendly.mjs';

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-ui-install-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  return dir;
}
const fetch = async () => new Response(JSON.stringify({data:[{id:'kimi-k3'}]}));

test('new and repeated installations load integrated UI/quota and preserve user projects/preferences', async t => {
  const dir = await directory(t);
  const options = {configDir:dir, apiKey:'synthetic', baseURL:'https://example.test/v1'};
  const installed = await configure(options, {fetch});
  assert.equal(installed.uiInstalled, true);
  assert.equal(installed.uiVersion, '0.12.4');
  const ui = path.join(dir, 'extensions/pi-friendly');
  for (const file of ['index.ts','friendly.mjs','surface.mjs','voice.mjs','voice-setup.mjs','voice-worker.py','voice_audio.py','web-server.mjs','web-rpc.mjs','web/index.html','web/app.js','web/app.css']) {
    assert.ok((await fs.stat(path.join(ui,file))).size);
  }
  await fs.writeFile(path.join(dir,'friendly-ui.json'), '{"theme":"dark"}');
  await fs.writeFile(path.join(dir,'friendly-projects.jsonl'), 'user projects');
  await fs.writeFile(path.join(ui,'obsolete.mjs'), 'old version');
  await configure(options, {fetch});
  assert.deepEqual((await fs.readdir(path.join(dir,'extensions'))).sort(), ['pi-friendly']);
  assert.equal(await fs.readFile(path.join(dir,'friendly-ui.json'),'utf8'), '{"theme":"dark"}');
  assert.equal(await fs.readFile(path.join(dir,'friendly-projects.jsonl'),'utf8'), 'user projects');
  await assert.rejects(fs.stat(path.join(ui,'obsolete.mjs')), {code:'ENOENT'});
  assert.ok((await fs.readdir(path.join(dir,'backups'))).some(file=>file.startsWith('pi-friendly-')));
});

test('upgrade from separate quota and old UI replaces runtime and backs up both without duplicate registrations', async t => {
  const dir = await directory(t);
  const oldUI = path.join(dir,'extensions/pi-friendly');
  const oldQuota = path.join(dir,'extensions/llmsrouter-progress');
  await fs.mkdir(oldUI,{recursive:true}); await fs.mkdir(oldQuota,{recursive:true});
  await fs.writeFile(path.join(oldUI,'package.json'),'{"name":"pi-friendly","version":"0.10.4"}');
  await fs.writeFile(path.join(oldUI,'index.ts'),'old UI');
  await fs.writeFile(path.join(oldQuota,'index.ts'),'old quota');
  await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({packages:['git:github.com/slavamirniy/pi-router-extension@v1.0.11'],extensions:['./extensions/llmsrouter-progress/index.ts']}));
  await fs.writeFile(path.join(dir,'sessions-preserved.jsonl'),'history');
  await configure({configDir:dir,apiKey:'synthetic-new',baseURL:'https://example.test/v1'},{fetch});
  assert.deepEqual(await fs.readdir(path.join(dir,'extensions')),['pi-friendly']);
  const settings = JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));
  assert.deepEqual(settings.packages,[]); assert.deepEqual(settings.extensions,[]);
  assert.equal(JSON.parse(await fs.readFile(path.join(oldUI,'package.json'),'utf8')).version,'0.12.4');
  assert.ok((await fs.readFile(path.join(oldUI,'bundled.ts'),'utf8')).includes("import routerProgress from './router/index.ts'"));
  assert.ok((await fs.stat(path.join(oldUI,'router/progress.mjs'))).size);
  const backups = await fs.readdir(path.join(dir,'backups'));
  for (const [name,text] of [['pi-friendly','old UI'],['llmsrouter-progress','old quota']]) {
    const backup = backups.find(f=>f.startsWith(name+'-'));
    assert.equal(await fs.readFile(path.join(dir,'backups',backup,'index.ts'),'utf8'),text);
  }
  assert.equal(await fs.readFile(path.join(dir,'sessions-preserved.jsonl'),'utf8'),'history');
});

test('migration removes duplicate UI registrations while preserving other extensions and providers', async t => {
  const dir = await directory(t);
  const local = path.join(dir,'old-ui');
  await fs.mkdir(local); await fs.writeFile(path.join(local,'package.json'), '{"name":"pi-friendly"}');
  const other = {source:'git:github.com/other/extension', extensions:['./index.ts']};
  await fs.writeFile(path.join(dir,'settings.json'), JSON.stringify({theme:'custom', packages:['git:github.com/slavamirniy/pi-friendly@v0.8.2', other, './old-ui'], extensions:[path.join(local,'index.ts'), './unrelated.ts']}));
  await fs.writeFile(path.join(dir,'models.json'), '{"providers":{"other":{"apiKey":"unchanged","models":[]}}}');
  await configure({configDir:dir,apiKey:'synthetic',baseURL:'https://example.test/v1'}, {fetch});
  const settings = JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));
  assert.deepEqual(settings.packages,[other]); assert.deepEqual(settings.extensions,['./unrelated.ts']);
  assert.equal(settings.theme,'custom');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8')).providers.other.apiKey,'unchanged');
});

test('incomplete or modified UI download cannot overwrite installed UI', async t => {
  const dir = await directory(t), source = path.join(dir,'bundle');
  await fs.cp(fileURLToPath(new URL('./pi-friendly/',import.meta.url)),source,{recursive:true});
  await fs.writeFile(path.join(source,'index.ts'),'damaged download');
  const settings = {packages:['git:github.com/slavamirniy/pi-friendly']};
  await assert.rejects(prepareFriendly(settings,dir,source), /integrity/);
  assert.deepEqual(settings.packages,['git:github.com/slavamirniy/pi-friendly']);
  await assert.rejects(fs.stat(path.join(dir,'extensions')), {code:'ENOENT'});
});
