import test from 'node:test';
import assert from 'node:assert/strict';
import {modelsURL,discoveredModel,mergeModels,installModelRefresh} from './models.mjs';
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
test('manual models retained; router response explicitly authorizes catalogue pruning, including empty selection',()=>{
 const old=[template,{...template,id:'manual'}];const input=[{id:'old',max_context_length:'128K',max_output_tokens:8000},{id:'new',input_modalities:['text','image']},{id:'embedding-v1'}];
 const merged=mergeModels(old,input,template);assert.deepEqual(merged.map(m=>m.id),['old','manual','new']);assert.equal(merged[0].contextWindow,131072);assert.deepEqual(merged[2].input,['text','image']);
 assert.deepEqual(mergeModels(old,input,template,true).map(m=>m.id),['old','new']);assert.deepEqual(mergeModels(old,[],template,true),[]);
});
function harness(fetcher){
 const handlers=new Map(),calls=[],registrations=[];let all=[{...template,provider:'first'},{...template,provider:'second',baseUrl:'https://second.example/v1'},{...template,provider:'unconfigured'}];
 const ctx={hasUI:false,model:all[0],isIdle:()=>true,modelRegistry:{getAll:()=>all,hasConfiguredAuth:m=>m.provider!=='unconfigured',getApiKeyAndHeaders:async m=>({ok:true,apiKey:'synthetic-'+m.provider}),getRegisteredProviderConfig:()=>({authHeader:true}),find:(p,id)=>all.find(m=>m.provider===p&&m.id===id)}};
 const pi={on:(name,cb)=>handlers.set(name,cb),registerCommand(){},registerProvider:(provider,config)=>{registrations.push({provider,config});all=[...all.filter(m=>m.provider!==provider),...config.models.map(m=>({...m,provider}))]},setModel:async m=>ctx.model=m};
 const instance=installModelRefresh(pi,{fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init)},timeout:100});return{handlers,calls,registrations,ctx,instance};
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
test('shutdown aborts discovery, late response cannot update the registry',async()=>{
 const h=harness(async(_url,init)=>{await new Promise(resolve=>init.signal.addEventListener('abort',resolve,{once:true}));return new Response(JSON.stringify({data:[{id:'new'}]}));});
 const pending=h.instance.refresh(h.ctx);await new Promise(r=>setTimeout(r,10));h.handlers.get('session_shutdown')();await pending;assert.equal(h.registrations.length,0);assert.ok(h.calls.every(c=>c.init.signal.aborted));
});
