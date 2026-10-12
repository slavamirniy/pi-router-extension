// Explicit local integration check. Run from the repository with a QA router
// on 18092 and synthetic mock providers on 18481. Never targets production.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = process.cwd();
const piRoot = process.env.PI_PACKAGE_ROOT ?? path.join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent');
const { loadExtensions } = await import(pathToFileURL(path.join(piRoot,'dist/core/extensions/loader.js')));
const { default: OpenAI } = await import(pathToFileURL(path.join(piRoot,'node_modules/openai/index.mjs')));
const entry = path.join(root,'extensions/pi-router-progress/index.ts');
const loaded = await loadExtensions([entry],root);
assert.equal(loaded.errors.length,0, 'pi extension loader rejected extension');
assert.equal(loaded.extensions.length,1);
const extension = loaded.extensions[0];
assert.ok(extension.handlers.has('before_provider_headers'));
const env = await fs.readFile(path.join(root,'.env'),'utf8');
const token = env.match(/^ADMIN_TOKEN=(.+)$/m)[1].trim().replace(/^['"]|['"]$/g,'');
const base = 'http://127.0.0.1:18092';
async function admin(url,method='GET',body) {
 const r=await fetch(base+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 assert.ok(r.ok,`QA admin HTTP ${r.status}`);return r.json();
}
async function control(name,mode,delay_ms=60) {
 const r=await fetch(`http://127.0.0.1:18481/control/${name}`,{method:'PUT',headers:{Authorization:'Bearer synthetic-grouping-control-token-00000001','Content-Type':'application/json'},body:JSON.stringify({mode,delay_ms,chunks:10,chunk_bytes:32,returned_model:'GLM-5.3'})});assert.ok(r.ok);
}
const catalog=await admin('/admin/catalog');
const routes=catalog.routes.filter(r=>r.model_id==='GLM-5.3');
assert.equal(routes.length,2,'Expected isolated QA fixtures');
const model=catalog.models.find(m=>m.id==='GLM-5.3');
await admin('/admin/models/GLM-5.3','PUT',{...model,input_coefficient:'3',output_coefficient:'5'});
const issued=await admin('/admin/keys','POST',{label:'synthetic-pi-extension',plan_id:'month',reference:crypto.randomUUID()});
const client=new OpenAI({apiKey:issued.key,baseURL:base+'/v1',maxRetries:0,timeout:5000});
const widgets=[],statuses=[],working=[];
const ctx={hasUI:true,model:{provider:'RenamedGateway',id:'GLM-5.3',api:'openai-completions',baseUrl:base+'/v1'},modelRegistry:{getApiKeyAndHeaders:async()=>({ok:true,apiKey:issued.key})},ui:{setWidget:(_key,content)=>widgets.push(typeof content==='function'?content(null,null).render(140):content),setStatus:(_key,text)=>statuses.push(text),setWorkingVisible:value=>working.push(value),notify(){}}};
async function fire(name,event){let result;for(const handler of extension.handlers.get(name)??[])result=await handler(event,ctx)??result;return result;}
async function reset(){for(const route of routes){await admin('/admin/routes/'+route.id+'/reset-breaker','POST');await admin('/admin/providers/'+route.provider_id+'/reset-breaker','POST');}}
const result={pi_version:JSON.parse(await fs.readFile(path.join(piRoot,'package.json'),'utf8')).version,loader:'real pi TypeScript loader',scaled_timers:true,scenarios:[]};
try {
 await control('primary','error');await control('backup','healthy');await reset();
 for(const mode of ['healthy','broken']){
  if(mode==='broken'){
   await control('primary','broken',300);await control('backup','broken',300);await reset();
  }
  widgets.length=0;const headers={};await fire('before_provider_headers',{headers});
  assert.deepEqual(headers,{},'Extension must not mutate ordinary provider requests');
  const started=performance.now();let content='',errorCode=null,completed=false,usage;
  try {
   const {data:stream,response}=await client.chat.completions.create({model:'GLM-5.3',messages:[{role:'user',content:'Synthetic progress test'}],max_tokens:50,stream:true},{headers}).withResponse();
   assert.equal(response.headers.get('x-router-events'),'v1');
   await fire('after_provider_response',{status:response.status,headers:Object.fromEntries(response.headers)});
   for await(const c of stream){content+=c.choices?.[0]?.delta?.content??'';completed ||= !!c.choices?.[0]?.finish_reason;if(c.usage)usage=c.usage;}
  }catch(e){errorCode=e.code;}
  const generated=widgets.filter(rows=>/MOCK_OK_|FAILED_DRAFT/.test(rows?.[0]??''));
  assert.ok(generated.length>0,'No live preview in pi widget');
  assert.ok(generated.every(rows=>rows.length===1));
  assert.ok(widgets.some(rows=>rows?.[0]?.includes('≈')),'Estimate not labelled');
  const replacement=await fire('message_end',{message:{role:'assistant',provider:'RenamedGateway',model:'GLM-5.3',timestamp:Date.now(),stopReason:errorCode?'error':'stop',content:[{type:'text',text:content}],usage:{output:usage?.completion_tokens??0}}});
  if(mode==='healthy'){assert.ok(completed);assert.equal(errorCode,null);assert.equal(widgets.at(-1),undefined);assert.ok(statuses.at(-1).startsWith('Осталось '));}
  else {assert.equal(errorCode,'stream_interrupted');assert.equal(completed,false);assert.deepEqual(replacement.message.content,[]);assert.equal(widgets.at(-1),undefined);}
  assert.ok(working.includes(false));assert.equal(working.at(-1),true);
  result.scenarios.push({mode,preview_updates:generated.length,elapsed_ms:Math.round(performance.now()-started),main_stream_received:content.length>0,completed,error_code:errorCode});
 }
 await control('primary','healthy',30);await control('backup','healthy',30);await reset();
 // Actual CLI with the extension and a synthetic credential, isolated from the
 // user's sessions, packages, models, and approval configuration.
 const agentDir=path.join(root,'.tools/pi-extension-agent');await fs.mkdir(agentDir,{recursive:true});
 const configuredModel={id:'GLM-5.3',name:'GLM-5.3',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:50};
 await fs.writeFile(path.join(agentDir,'models.json'),JSON.stringify({providers:{RenamedGateway:{baseUrl:base+'/v1',api:'openai-completions',apiKey:issued.key,models:[configuredModel,{...configuredModel,id:'stale-router-model'}]},OtherService:{baseUrl:'http://127.0.0.1:18481/no-models',api:'openai-completions',apiKey:'synthetic-other-key',models:[{...configuredModel,id:'manual-other'}]},EmptyGateway:{baseUrl:base+'/v1',api:'openai-completions',apiKey:issued.key,models:[]}}}));
 await fs.writeFile(path.join(agentDir,'settings.json'),'{}');
 const proofPath=path.join(root,'.tools/pi-model-refresh-proof.json'),probePath=path.join(root,'.tools/pi-model-probe.ts');
 await fs.writeFile(probePath,`import {writeFile} from 'node:fs/promises'; export default function(pi){pi.on('session_start',async(_event,ctx)=>{const m=ctx.modelRegistry.find('RenamedGateway','GLM-5.3');await writeFile(${JSON.stringify(proofPath)},JSON.stringify({context_window:m?.contextWindow,max_output_tokens:m?.maxTokens,stale_router_model_removed:!ctx.modelRegistry.find('RenamedGateway','stale-router-model'),manual_other_preserved:!!ctx.modelRegistry.find('OtherService','manual-other'),empty_provider_populated:!!ctx.modelRegistry.find('EmptyGateway','GLM-5.3')}));});}`);
 const args=[path.join(piRoot,'dist/bundle/cli.js'),'--no-extensions','--extension',entry,'--extension',probePath,'--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--no-approve','--no-tools','--no-session','--provider','RenamedGateway','--model','GLM-5.3','--mode','json','--print','--system-prompt','Reply briefly.','Synthetic CLI extension smoke'];
 async function runCLI(){return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,PI_CODING_AGENT_DIR:agentDir},windowsHide:true});let stdout='',stderr='';
  child.stdin.end();
  const timer=setTimeout(()=>{child.kill();reject(new Error('pi CLI smoke timed out'));},20000);
  child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
  child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});
 });}
 const cli=await runCLI();
 assert.equal(cli.code,0,'Actual pi CLI failed');
 const messages=cli.stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}});
 assert.ok(messages.some(e=>e.type==='message_end'&&e.message?.role==='assistant'&&e.message?.stopReason==='stop'),'pi did not finish normally');
 result.real_cli='passed';
 const proof=JSON.parse(await fs.readFile(proofPath,'utf8'));
 assert.equal(proof.context_window,1048576);assert.equal(proof.max_output_tokens,8192);assert.equal(proof.stale_router_model_removed,true);assert.equal(proof.manual_other_preserved,true);assert.equal(proof.empty_provider_populated,true);
 result.model_refresh=proof;
 await control('primary','broken',300);await control('backup','broken',300);await reset();
 const brokenCLI=await runCLI();
 const errorMessages=brokenCLI.stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}});
 const failedMessage=errorMessages.find(e=>e.type==='message_end'&&e.message?.role==='assistant'&&e.message?.stopReason==='error');
 assert.ok(failedMessage,'pi CLI did not mark interruption as failure');
 assert.deepEqual(failedMessage.message.content,[],'pi persisted unfinished text or tools');
 result.real_cli_interruption='passed: unfinished content removed';
 const account=await fetch(base+'/router/account',{headers:{Authorization:'Bearer '+issued.key}}).then(r=>r.json());
 assert.equal(account.held,0);assert.equal(account.used,130);result.charged=account.used;result.held=account.held;
 result.capability_detection='response headers, arbitrary provider name';
 result.quota='input 10 ×3 + output 7 ×5 = 65; retries and interruptions not debited';
 result.layout='one progress row, numeric balance in native footer, no loader';
 await fs.mkdir(path.join(root,'docs'),{recursive:true});await fs.writeFile(path.join(root,'docs/pi-extension-report.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
} finally {await fire('session_shutdown',{});}
