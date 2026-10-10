import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {configure} from './configure.mjs';

test('fresh install discovers arbitrary API metadata and installs every plugin module', async t => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let request;
 const result=await configure({apiKey:'synthetic-only',baseURL:'https://different.example/proxy/v1',provider:'anything',configDir:dir},{fetch:async(url,init)=>{request={url,init};return new Response(JSON.stringify({data:[{id:'my-text',context_window:262144,max_output_tokens:16384}]}));}});
 assert.equal(request.url,'https://different.example/proxy/v1/models');assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.Authorization,'Bearer synthetic-only');
 const config=JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8'));
 assert.equal(config.providers.anything.models[0].contextWindow,262144);assert.equal(result.models,1);
 for(const file of ['index.ts','progress.mjs','models.mjs','safety.mjs']) assert.ok((await fs.stat(path.join(dir,'extensions','llmsrouter-progress',file))).size);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).defaultModel,'my-text');
});
test('reinstall replaces this provider models and preserves other providers, settings, backups and offline snapshots',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'models.json'),JSON.stringify({custom:true,providers:{other:{apiKey:'unrelated',models:[{id:'other-model'}]},custom:{baseUrl:'https://api.example/v1',apiKey:'existing',models:[{id:'manual',contextWindow:100000,maxTokens:5000}]}}}));
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({theme:'dark',defaultProvider:'custom',defaultModel:'manual'}));
 const options={baseURL:'https://api.example/v1',provider:'custom',configDir:dir};
 await configure(options,{fetch:async()=>new Response(JSON.stringify({data:[{id:'new'}]}))});
 let config=JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8'));
 assert.equal(config.providers.other.apiKey,'unrelated');assert.deepEqual(config.providers.custom.models.map(m=>m.id),['new']);assert.equal(config.custom,true);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).theme,'dark');
 assert.ok((await fs.readdir(dir)).some(f=>f.startsWith('models.json.bak.')));
 const result=await configure(options,{fetch:async()=>{throw new Error('offline')}});assert.equal(result.refreshed,false);assert.equal(result.models,1);
});
test('fresh install selects Kimi K3 ahead of MiniMax and explicit model still wins',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-install-kimi-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const options={apiKey:'synthetic',baseURL:'https://api.example/v1',configDir:dir};
 const deps={fetch:async()=>new Response(JSON.stringify({data:[{id:'MiniMax-M3'},{id:'kimi-k3'}]}))};
 assert.equal((await configure(options,deps)).defaultModel,'kimi-k3');
 assert.equal((await configure({...options,defaultModel:'MiniMax-M3'},deps)).defaultModel,'MiniMax-M3');
});

test('empty catalogue is honored; changing address requires an explicit key; bad JSON is preserved',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const options={apiKey:'synthetic',baseURL:'https://api.example/v1',configDir:dir};
 const result=await configure(options,{fetch:async()=>new Response('{"data":[]}')});assert.equal(result.models,0);assert.equal(result.refreshed,true);
 const before=await fs.readFile(path.join(dir,'models.json'),'utf8');
 await assert.rejects(configure({...options,apiKey:undefined,baseURL:'https://different.example/v1'}),/PI_API_KEY/);assert.equal(await fs.readFile(path.join(dir,'models.json'),'utf8'),before);
 await fs.writeFile(path.join(dir,'settings.json'),'{broken');await assert.rejects(configure(options),/Invalid configuration/);assert.equal(await fs.readFile(path.join(dir,'models.json'),'utf8'),before);
});

test('reinstall migrates localhost to a new API including per-model URLs and credentials',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-migrate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const old={providers:{other:{baseUrl:'https://other.example/v1',apiKey:'other-key',models:[{id:'other'}]},router:{baseUrl:'http://localhost:8080/v1',apiKey:'old-key',headers:{Authorization:'Bearer old-key'},models:[{id:'kimi-k3',baseUrl:'http://localhost:8080/v1',headers:{Authorization:'Bearer old-key'}},{id:'removed'}]}}};
 await fs.writeFile(path.join(dir,'models.json'),JSON.stringify(old));
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({theme:'dark',defaultProvider:'router',defaultModel:'removed'}));
 const result=await configure({configDir:dir,baseURL:'https://new.example/v1',apiKey:'new-key',defaultModel:'kimi-k3'},{fetch:async(url,init)=>{
  assert.equal(url,'https://new.example/v1/models');assert.equal(init.headers.Authorization,'Bearer new-key');
  return new Response(JSON.stringify({data:[{id:'kimi-k3'}]}));
 }});
 const updated=JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8'));
 assert.deepEqual(updated.providers.other,old.providers.other);
 assert.equal(updated.providers.router.baseUrl,'https://new.example/v1');assert.equal(updated.providers.router.apiKey,'new-key');
 assert.equal(updated.providers.router.headers,undefined);
 assert.deepEqual(updated.providers.router.models.map(m=>m.id),['kimi-k3']);
 assert.equal(updated.providers.router.models[0].baseUrl,'https://new.example/v1');assert.equal(updated.providers.router.models[0].headers,undefined);
 assert.equal(result.connectionChanged,true);assert.equal(result.defaultModel,'kimi-k3');
 const backups=(await fs.readdir(dir)).filter(f=>f.startsWith('models.json.bak.'));
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,backups[0]),'utf8')),old);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).theme,'dark');
});

test('offline migration saves new connection without stale models or a blocking preferred model',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-migrate-offline-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{router:{baseUrl:'http://localhost:8080/v1',apiKey:'old-key',models:[{id:'kimi-k3',baseUrl:'http://localhost:8080/v1'}]}}}));
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({defaultProvider:'router',defaultModel:'kimi-k3'}));
 const result=await configure({configDir:dir,baseURL:'https://new.example/v1',apiKey:'new-key',defaultModel:'kimi-k3'},{fetch:async()=>{throw Error('offline')}});
 const config=JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8'));
 assert.equal(config.providers.router.baseUrl,'https://new.example/v1');assert.equal(config.providers.router.apiKey,'new-key');assert.deepEqual(config.providers.router.models,[]);
 const settings=JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));
 assert.equal(settings.defaultProvider,'router');assert.equal(settings.defaultModel,undefined);assert.equal(result.refreshed,false);
});

test('rotating key at same URL refreshes access and falls back when preferred model is absent',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-rotate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{router:{baseUrl:'https://api.example/v1',apiKey:'old-key',headers:{Authorization:'Bearer old-key'},models:[{id:'old'}]}}}));
 const result=await configure({configDir:dir,baseURL:'https://api.example/v1',apiKey:'new-key',defaultModel:'kimi-k3'},{fetch:async()=>new Response(JSON.stringify({data:[{id:'qwen-plus'}]}))});
 assert.equal(result.defaultModel,'qwen-plus');assert.equal(result.preferredModelUnavailable,true);
 const provider=JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8')).providers.router;
 assert.equal(provider.apiKey,'new-key');assert.equal(provider.headers,undefined);assert.deepEqual(provider.models.map(m=>m.id),['qwen-plus']);
});

test('Pi JSON comments, trailing commas, empty files and UTF-16 are read without losing other providers',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-jsonc-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const original='\uFEFF{\n// Pi accepts comments\n"providers":{"other":{"baseUrl":"https://other.example/v1","apiKey":"//literal,}","models":[],},},}\n';
 const options={configDir:dir,baseURL:'https://new.example/v1',apiKey:'synthetic'};
 const deps={fetch:async()=>new Response('{"data":[{"id":"kimi-k3"}]}')};
 for(const encoding of ['utf8','utf16le']) {
  await fs.writeFile(path.join(dir,'models.json'),original,encoding);
  await fs.writeFile(path.join(dir,'settings.json'),'{"theme":"dark", // comment\n}');
  await configure(options,deps);
  const config=JSON.parse(await fs.readFile(path.join(dir,'models.json'),'utf8'));
  assert.equal(config.providers.other.baseUrl,'https://other.example/v1');assert.equal(config.providers.other.apiKey,'//literal,}');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).theme,'dark');
 }
 await fs.writeFile(path.join(dir,'models.json'),'');
 assert.equal((await configure(options,deps)).models,1);
});

test('malformed configuration is preserved and parser errors never reveal credentials',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-invalid-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const secret='DO_NOT_PRINT_THIS_SYNTHETIC_SECRET';await fs.writeFile(path.join(dir,'models.json'),secret);
 await assert.rejects(configure({configDir:dir,baseURL:'https://api.example/v1',apiKey:'synthetic'}),error=>error.message.includes('invalid JSON')&&!error.message.includes(secret));
 assert.equal(await fs.readFile(path.join(dir,'models.json'),'utf8'),secret);
 await fs.rm(path.join(dir,'models.json'));await fs.mkdir(path.join(dir,'models.json'));
 await assert.rejects(configure({configDir:dir,baseURL:'https://api.example/v1',apiKey:'synthetic'}),/Cannot read configuration/);
});
