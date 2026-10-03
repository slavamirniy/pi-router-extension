import test from 'node:test';
import assert from 'node:assert/strict';
import { installRouterProgress, cleanPreview, formatTokens, eventURL, accountURL, readStatuses, widgetRows, balanceText } from './progress.mjs';
const tick=()=>new Promise(r=>setTimeout(r,20));
const quota={token_limit:1000,used:250,held:100,available:650,expires:2000000000};
const event=(v)=>`event: status\ndata: ${JSON.stringify({request_id:'synthetic-id',...v})}\n\n`;
function harness(fetcher){
 const handlers=new Map(),widgets=[],requests=[],statuses=[],working=[];let stream;
 const ctx={hasUI:true,model:{provider:'AnyGatewayName',id:'model',api:'openai-completions',baseUrl:'http://localhost:8080/v1'},modelRegistry:{getApiKeyAndHeaders:async()=>({ok:true,apiKey:'synthetic-key'})},ui:{setWidget:(_key,content)=>widgets.push(typeof content==='function'?content(null,null).render(140):content),setStatus:(_key,text)=>statuses.push(text),setWorkingVisible:v=>working.push(v),notify(){}}};
 const pi={on:(name,fn)=>handlers.set(name,fn),registerCommand(){}};
 const instance=installRouterProgress(pi,{fetch:async(url,init)=>{requests.push({url,init});if(url.endsWith('/account'))return new Response(JSON.stringify(quota));return fetcher?fetcher(url,init):new Response(new ReadableStream({start(c){stream=c}}));}});
 const begin=async(headers={},responseHeaders={'X-Router-Events':'v1','X-Request-ID':'synthetic-id'})=>{await handlers.get('before_provider_headers')({headers},ctx);handlers.get('after_provider_response')({status:200,headers:responseHeaders},ctx);await tick();};
 const send=(v)=>stream.enqueue(new TextEncoder().encode(event(v)));
 const message=(reason='stop',provider=ctx.model.provider)=>({role:'assistant',provider,model:'model',timestamp:123,stopReason:reason,usage:{input:9999,output:9999},content:[{type:'text',text:'draft'},{type:'toolCall',name:'write'}]});
 return{handlers,widgets,requests,statuses,working,ctx,instance,begin,send,message};
}
test('safe Unicode tail, controls stripped, URLs preserve mount without credentials',()=>{
 assert.equal(Array.from(cleanPreview('я'.repeat(70))).length,50);
 assert.equal(cleanPreview('\x1b[31mПривет\x1b[0m\nмир\x1b]0;danger\x07'),'Привет мир');
 assert.equal(formatTokens(1234,true),'≈1.23к токенов');
 assert.equal(eventURL('https://host/proxy/v1/?secret=omit','abc'),'https://host/proxy/router/requests/abc/events');
 assert.equal(accountURL('https://host/proxy/v1/'),'https://host/proxy/router/account');
 assert.throws(()=>eventURL('https://u:p@host/v1','abc'));
});
test('UTF8 split, CRLF, heartbeat, multiline and malformed data',async()=>{
 const bytes=new TextEncoder().encode(': hb\r\nevent: status\r\ndata: {"preview":\r\ndata: "я"}\r\n\r\nevent: status\ndata: broken\n\n');const out=[];
 await readStatuses(new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close()}})),v=>out.push(v));assert.deepEqual(out,[{preview:'я'}]);
 await assert.rejects(readStatuses(new Response('data: '+'x'.repeat(70000)+'\n\n'),()=>{}),/too large/);
});
test('arbitrary provider name: only response capability starts authenticated side channels',async()=>{
 const h=harness();const headers={'x-request-id':'keep-existing'};
 await h.handlers.get('before_provider_headers')({headers},h.ctx);
 assert.deepEqual(headers,{'x-request-id':'keep-existing'});assert.equal(h.requests.length,0);
 h.handlers.get('after_provider_response')({status:200,headers:{'x-router-events':'v1','x-request-id':'synthetic-id'}});await tick();
 assert.equal(h.requests.length,2);assert.ok(h.requests.every(r=>r.init.headers.Authorization==='Bearer synthetic-key'&&r.init.redirect==='error'));
 assert.equal(h.statuses.at(-1),'Осталось 750');assert.equal(h.widgets.at(-1).length,1);assert.equal(h.working.at(-1),false);h.instance.stop();
});
test('ordinary API with any name is untouched, including its errors',async()=>{
 const h=harness();h.ctx.model.provider='LLMSRouter';await h.begin({},{});
 assert.equal(h.requests.length,0);assert.equal(h.widgets.filter(Boolean).length,0);
 assert.equal(await h.handlers.get('message_end')({message:h.message('error')}),undefined);h.instance.stop();
});
test('unsupported capability or unsafe request ID cannot trigger requests',async()=>{
 for(const headers of [{'x-router-events':'v2','x-request-id':'synthetic-id'},{'x-router-events':'v1','x-request-id':'http://evil'},{'x-router-events':'v1','x-request-id':'x'.repeat(65)}]){
 const h=harness();await h.begin({},headers);assert.equal(h.requests.length,0);h.instance.stop();}
});
test('auth failure and nested foreign credentials never forward secrets',async()=>{
 const h=harness();await h.begin({Authorization:'Bearer foreign-secret'});assert.equal(h.requests.length,0);
 h.ctx.modelRegistry.getApiKeyAndHeaders=async()=>({ok:false});await h.begin();assert.equal(h.requests.length,0);h.instance.stop();
});
test('weighted quota, retry resets, stale and foreign frames ignored; exact settlement wins over SDK counts',async()=>{
 let closed=false;const h=harness(async()=>closed?new Response(event({version:99,state:'completed',quota_tokens:65,quota_tokens_estimated:false,input_tokens:10,output_tokens:7,input_coefficient:'3',output_coefficient:'5'})):new Response(new ReadableStream({start(c){h.stream=c}})));
 await h.begin();const send=v=>h.stream.enqueue(new TextEncoder().encode(event(v)));
 send({version:1,state:'generating',attempt:1,preview:'first',quota_tokens:230,quota_tokens_estimated:true,input_tokens:10,input_tokens_estimated:true,output_tokens:40,output_tokens_estimated:true,input_coefficient:'3',output_coefficient:'5'});await tick();
 assert.ok(h.widgets.at(-1)[0].includes('≈230 квоты'));assert.ok(!h.widgets.at(-1)[0].includes('×3'));assert.equal(h.widgets.at(-1).length,1);
 send({version:2,state:'retrying',attempt:1,preview:'',reset:true,quota_tokens:30,quota_tokens_estimated:true,output_tokens:0});await tick();assert.ok(!h.widgets.at(-1).join(' ').includes('first'));
 send({version:3,state:'generating',attempt:2,preview:'second',quota_tokens:65});send({version:1,state:'generating',preview:'stale'});send({request_id:'foreign',version:99,state:'generating',preview:'foreign'});await tick();assert.ok(h.widgets.at(-1)[0].includes('second'));
 closed=true;await h.handlers.get('message_end')({message:h.message()});assert.equal(h.widgets.at(-1),undefined);assert.equal(h.instance.getCurrent().snapshot.quota_tokens,65);assert.equal(h.working.at(-1),true);h.instance.stop();
});
test('confirmed interrupted response strips tools and text, only that message removed from context',async()=>{
 const h=harness(async()=>new Response(event({version:99,state:'failed',quota_tokens:0,quota_tokens_estimated:false})));await h.begin();const m=h.message('error');
 const result=await h.handlers.get('message_end')({message:m});assert.deepEqual(result.message.content,[]);
 const context=h.handlers.get('context')({messages:[m,{...m,timestamp:124},{...m,provider:'ordinary'},{role:'user',content:'question'}]});assert.equal(context.messages.length,3);
 assert.equal(h.widgets.at(-1),undefined);assert.equal(h.instance.getCurrent().snapshot.quota_tokens,0);h.instance.stop();
});
test('side-channel failures never retry generation; shutdown aborts listeners',async()=>{
 const h=harness(async()=>new Response('',{status:429}));await h.begin();assert.equal(h.instance.getCurrent().unavailable,true);
 h.handlers.get('session_shutdown')({},h.ctx);assert.ok(h.requests[0].init.signal.aborted);assert.equal(h.widgets.at(-1),undefined);
});
test('status reconnect retains only newer versions',async()=>{
 let calls=0;const h=harness(async()=>new Response(event({version:++calls,state:'generating',preview:'live',quota_tokens:calls})));await h.begin();await new Promise(r=>setTimeout(r,550));assert.equal(calls,2);assert.equal(h.instance.getCurrent().version,2);h.instance.stop();
});
test('one responsive row without loader, raw balance only in footer, disappears at completion',()=>{
 const run={now:()=>2000000001000,started:2000000000000,account:quota,snapshot:{state:'generating',preview:'secret\n\x1b[31m draft',quota_tokens:65,quota_tokens_estimated:true,input_tokens:10,output_tokens:7,input_coefficient:'3',output_coefficient:'5'}};
 run.ctx={ui:{setStatus(){}}};
 for(const width of [30,50,80,140]){const rows=widgetRows(run,width);assert.equal(rows.length,1);assert.ok(rows.every(r=>Array.from(r).length<=width));}
 const row=widgetRows(run,140)[0];assert.ok(row.includes('Генерация'));assert.ok(row.includes('≈65 квоты'));assert.ok(!/резерв|доступно|Вход|выход|Осталось|Истёк|◐|попытка/.test(row));assert.equal(balanceText(run),'Осталось 750');
 run.snapshot.state='completed';assert.deepEqual(widgetRows(run,140),[]);
});
