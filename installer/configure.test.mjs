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

test('empty catalogue without router headers is honored; mismatched provider or bad JSON cannot overwrite config',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const options={apiKey:'synthetic',baseURL:'https://api.example/v1',configDir:dir};
 const result=await configure(options,{fetch:async()=>new Response('{"data":[]}')});assert.equal(result.models,0);assert.equal(result.refreshed,true);
 const before=await fs.readFile(path.join(dir,'models.json'),'utf8');
 await assert.rejects(configure({...options,baseURL:'https://different.example/v1'}),/another API/);assert.equal(await fs.readFile(path.join(dir,'models.json'),'utf8'),before);
 await fs.writeFile(path.join(dir,'settings.json'),'{broken');await assert.rejects(configure(options),/Invalid configuration/);assert.equal(await fs.readFile(path.join(dir,'models.json'),'utf8'),before);
});
