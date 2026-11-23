import {randomUUID} from 'node:crypto';
// Reuse the running terminal session, rather than opening its file a second time.
export function contextMessages(sessionManager){
 const entries=sessionManager?.buildContextEntries?.()||sessionManager?.getBranch?.()||[];
 const messages=[];
 for(const entry of entries){
  if(entry?.type==='message')messages.push(entry.message);
  else if(entry?.type==='compaction')messages.push({role:'compactionSummary',summary:entry.summary,tokensBefore:entry.tokensBefore,timestamp:entry.timestamp});
  else if(entry?.type==='branch_summary')messages.push({role:'branchSummary',summary:entry.summary,timestamp:entry.timestamp});
 }
 return messages;
}
export function createHostBridge({pi,ctx,observers,onEvent}){
 observers.add(onEvent);const pending=new Map(),restore=[];
 for(const method of ['select','confirm','input','editor','notify','setStatus','setWidget']){
  const original=ctx.ui[method];if(typeof original!=='function')continue;
  const wrapper=(...args)=>{
   const id=randomUUID(),base={type:'extension_ui_request',method,id};
   if(['select','confirm','input','editor'].includes(method))return new Promise(resolve=>{
    const options=args[2]||{},timer=options.timeout?setTimeout(()=>{pending.delete(id);resolve(method==='confirm'?false:undefined);},options.timeout):undefined;
    pending.set(id,{resolve,timer,method});onEvent({...base,title:args[0],...(method==='select'?{options:args[1]}:method==='confirm'?{message:args[1]}:method==='editor'?{prefill:args[1]}:{placeholder:args[1]}),timeout:options.timeout});
   });
   const result=original.apply(ctx.ui,args);
   if(method==='notify')onEvent({...base,message:args[0],notifyType:args[1]});
   if(method==='setStatus')onEvent({...base,statusKey:args[0],statusText:args[1]});
   if(method==='setWidget'&&(Array.isArray(args[1])||args[1]===undefined))onEvent({...base,widgetKey:args[0],widgetLines:args[1]});
   return result;
  };
  ctx.ui[method]=wrapper;restore.push(()=>{if(ctx.ui[method]===wrapper)ctx.ui[method]=original;});
 }
 return {
  async request(type,data={}){
   if(type==='get_state')return {model:ctx.model,isStreaming:!ctx.isIdle()};
   if(type==='get_messages')return {messages:contextMessages(ctx.sessionManager)};
   if(type==='get_session_stats')return {contextUsage:ctx.getContextUsage?.()};
   if(type==='prompt'){if(!ctx.isIdle())throw new Error('В консоли уже идёт ответ.');pi.sendUserMessage(data.message,{expandPromptTemplates:true});return;}
   if(type==='compact')return await new Promise((resolve,reject)=>ctx.compact({customInstructions:data.customInstructions,onComplete:resolve,onError:reject}));
   if(type==='abort'){await ctx.abort();return;}
   if(type==='set_model'){const model=ctx.modelRegistry.getAvailable().find(m=>m.id===data.modelId&&m.provider===data.provider);if(!model||!await pi.setModel(model))throw new Error('Модель недоступна.');return;}
  },
  respond(data){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);p.resolve(data.cancelled?(p.method==='confirm'?false:undefined):p.method==='confirm'?data.confirmed===true:data.value);},
  async dispose(){observers.delete(onEvent);for(const undo of restore)undo();for(const p of pending.values()){clearTimeout(p.timer);p.resolve(p.method==='confirm'?false:undefined);}pending.clear();}
 };
}