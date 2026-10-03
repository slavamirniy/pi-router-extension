import test from 'node:test';
import assert from 'node:assert/strict';
import {modelsURL,discoveredModel,mergeModels,installModelRefresh,persistCatalogues} from './models.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const template={provider:'arbitrary',api:'openai-completions',baseUrl:'https://api.example/proxy/v1',compat:{supportsStore:false},id:'old',name:'Old',contextWindow:64000,maxTokens:4000,reasoning:false,input:['text'],cost:{input:1,output:2,cacheRead:1,cacheWrite:1}};
test('URL derives from base, drops secrets and rejects embedded credentials',()=>{
 assert.equal(modelsURL(template.baseUrl+'/?secret=x'),'https://api.example/proxy/v1/models');assert.throws(()=>modelsURL('https://u:p@host/v1'));assert.throws(()=>modelsURL('file:///tmp'));
});
test('GLM official fallback repairs stale capacity; explicit deployment limits win',()=>{
 const m=discoveredModel({id:'ZHIPU/GLM-5.3'}, {...template,id:'ZHIPU/GLM-5.3',contextWindow:32768,maxTokens:8192},template);
 assert.equal(m.contextWindow,1048576);assert.equal(m.maxTokens,131072);assert.equal(m.reasoning,true);assert.equal(m.thinkingLevelMap.off,'low');assert.equal(m.compat.supportsReasoningEffort,true);
 const smaller=discoveredModel({id:'glm-5.3',context_length:262144,max_output_tokens:16384},undefined,template);assert.equal(smaller.contextWindow,262144);assert.equal(smaller.maxTokens,16384);
 const unknown=discoveredModel({id:'custom'}, {...template,id:'custom'},template);assert.equal(unknown.contextWindow,64000);assert.equal(unknown.maxTokens,4000);assert.deepEqual(unknown.cost,template.cost);
});
test('every valid catalogue replaces old IDs without a special router header, including an empty list',()=>{
 const old=[template,{...template,id:'manual'}];const input=[{id:'old',max_context_length:'128K',max_output_tokens:8000},{id:'new',input_modalities:['text','image']},{id:'embedding-v1'}];
 const merged=mergeModels(old,input,template);assert.deepEqual(merged.map(m=>m.id),['old','new']);assert.equal(merged[0].contextWindow,131072);assert.deepEqual(merged[1].input,['text','image']);
 assert.deepEqual(mergeModels(old,[],template),[]);
});
function harness(fetcher){
 const handlers=new Map(),commands=new Map(),calls=[],registrations=[];let all=[{...template,provider:'first'},{...template,provider:'second',baseUrl:'https://second.example/v1'},{...template,provider:'unconfigured'}];
 const ctx={hasUI:false,model:all[0],isIdle:()=>true,modelRegistry:{getAll:()=>all,hasConfiguredAuth:m=>m.provider!=='unconfigured',getApiKeyAndHeaders:async m=>({ok:true,apiKey:'synthetic-'+m.provider}),getRegisteredProviderConfig:()=>({authHeader:true}),find:(p,id)=>all.find(m=>m.provider===p&&m.id===id)}};
 const pi={on:(name,cb)=>handlers.set(name,cb),registerCommand:(name,command)=>commands.set(name,command),registerProvider:(provider,config)=>{registrations.push({provider,config});all=[...all.filter(m=>m.provider!==provider),...config.models.map(m=>({...m,provider}))]},setModel:async m=>ctx.model=m};
 const instance=installModelRefresh(pi,{fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init)},timeout:100});return{handlers,commands,calls,registrations,ctx,instance};
}
test('all configured bases refreshed once; auth/config preserved, unavailable provider unchanged',async()=>{
 const h=harness(async url=>url.includes('second')?new Response('',{status:503}):new Response(JSON.stringify({data:[{id:'old',context_window:200000},{id:'new'}]})));
 await h.handlers.get('session_start')({},h.ctx);assert.equal(h.calls.length,2);assert.ok(h.calls.every(c=>c.init.redirect==='error'));
 assert.equal(h.registrations.length,1);assert.equal(h.registrations[0].provider,'first');assert.equal(h.registrations[0].config.authHeader,true);assert.equal(h.ctx.model.contextWindow,200000);assert.equal(h.registrations[0].config.models.length,2);
});
test('malformed, paginated, oversized catalogue cannot prune any models',async()=>{
 for(const data of [{has_more:true,data:[{id:'new'}]},{data:[null]},{invalid:true}]){
 const h=harness(async()=>new Response(JSON.stringify(data),{headers:{'X-Router-Catalog':'v1'}}));await h.instance.refresh(h.ctx);assert.equal(h.registrations.length,0);}
 const h=harness(async()=>new Response('x'.repeat(1048577)));await h.instance.refresh(h.ctx);assert.equal(h.registrations.length,0);
});
test('refresh replaces a stale list with four models, switches removed idle selection, and reports failures',async()=>{
 const ids=['working-1','working-2','working-3','working-4'];
 const h=harness(async url=>url.includes('second')?new Response('',{status:503}):new Response(JSON.stringify({data:ids.map(id=>({id}))})));
 const notices=[];h.ctx.hasUI=true;h.ctx.ui={notify:(message,level)=>notices.push({message,level})};
 await h.commands.get('models-refresh').handler('',h.ctx);
 assert.deepEqual(h.ctx.modelRegistry.getAll().filter(m=>m.provider==='first').map(m=>m.id),ids);
 assert.equal(h.ctx.model.id,'working-1');assert.equal(h.ctx.model.provider,'first');
 assert.equal(h.ctx.modelRegistry.find('second','old').id,'old');assert.equal(h.ctx.modelRegistry.find('unconfigured','old').id,'old');
 assert.match(notices[0].message,/моделей 4/);assert.match(notices[0].message,/Не обновлено подключений: 1/);
 const empty=harness(async()=>new Response('{"data":[]}'));await empty.instance.refresh(empty.ctx);
 assert.equal(empty.ctx.modelRegistry.getAll().filter(m=>m.provider==='first').length,0);
});

test('saved catalogues replace only refreshed providers, retain credentials and backup, and respect edits in flight',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-models-refresh-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'models.json');
 const config={custom:true,providers:{first:{apiKey:'synthetic',baseUrl:template.baseUrl,models:[template]},second:{models:[{id:'manual'}]}}};
 const snapshot=structuredClone(config.providers);await fs.writeFile(file,JSON.stringify(config));
 await persistCatalogues(file,[{provider:'first',models:[{id:'new'}]}],snapshot);
 const saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.providers.first.models,[{id:'new'}]);assert.equal(saved.providers.first.apiKey,'synthetic');assert.equal(saved.custom,true);assert.deepEqual(saved.providers.second,config.providers.second);
 assert.deepEqual(JSON.parse(await fs.readFile(`${file}.previous`,'utf8')),config);
 saved.providers.first.apiKey='changed-while-refreshing';await fs.writeFile(file,JSON.stringify(saved));
 await persistCatalogues(file,[{provider:'first',models:[]}],snapshot);
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),saved);
});

test('shutdown aborts discovery, late response cannot update the registry',async()=>{
 const h=harness(async(_url,init)=>{await new Promise(resolve=>init.signal.addEventListener('abort',resolve,{once:true}));return new Response(JSON.stringify({data:[{id:'new'}]}));});
 const pending=h.instance.refresh(h.ctx);await new Promise(r=>setTimeout(r,10));h.handlers.get('session_shutdown')();await pending;assert.equal(h.registrations.length,0);assert.ok(h.calls.every(c=>c.init.signal.aborted));
});
