import {activityLabel} from './activity.mjs';
import {clean} from './menu.mjs';
const output=result=>(result?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').slice(-16000);
export function toolView(c){
 const value={id:c.id,name:c.name,label:activityLabel(c.name,c.arguments||{}),path:clean(c.arguments?.path||c.arguments?.file_path||''),command:clean(c.arguments?.command||''),status:'pending',images:[]};
 if(c.name==='subagent'||c.name==='subagent_wait'||c.name==='subagent_cancel')value.subagent={agent:clean(c.arguments?.agent||''),task:clean(c.arguments?.task||''),background:c.arguments?.background!==false};
 return value;
}
export function publicMessage(message){
 if(message?.role==='compactionSummary'||message?.role==='branchSummary'){
  const summary=String(message.summary||'');
  return {role:'summary',kind:message.role==='compactionSummary'?'compaction':'branch',text:summary,summaryText:summary,tokensBefore:Number.isFinite(message.tokensBefore)?message.tokensBefore:undefined,timestamp:message.timestamp,status:'done'};
 }
 if(message?.role==='custom'){
  const content=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content||[];
  return {role:'custom',customType:message.customType,text:content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),details:message.details,timestamp:message.timestamp,status:'done'};
 }
 const content=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content||[];
 return {role:message.role,timestamp:message.timestamp,text:content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),thinking:content.filter(c=>c.type==='thinking').map(c=>c.thinking||'').join('\n'),tools:content.filter(c=>c.type==='toolCall').map(toolView),error:message.errorMessage?clean(message.errorMessage):undefined,status:message.stopReason==='error'?'error':message.stopReason==='aborted'?'stopped':'done',usage:message.usage?{input:message.usage.input,output:message.usage.output}:undefined};
}
export function updateTool(tool,event){
 const details=event.result?.details||event.partialResult?.details;
 const images=Array.isArray(details?.images)?details.images:details?.image?[details.image]:tool.images||[];
 const subagents=Array.isArray(details?.subagents)?details.subagents:tool.subagents;
 return {...tool,status:event.type==='tool_execution_end'?(event.isError?'error':'done'):'running',output:output(event.result||event.partialResult)||tool.output,images,subagents,started:tool.started||Date.now(),ended:event.type==='tool_execution_end'?Date.now():undefined};
}
export function publicMessages(messages){
 const results=new Map(messages.filter(m=>m.role==='toolResult').map(m=>[m.toolCallId,m]));
 return messages.filter(m=>['user','assistant','compactionSummary','branchSummary','custom'].includes(m.role)).map(m=>{const value=publicMessage(m);if(value.tools?.length)value.tools=value.tools.map(t=>{const result=results.get(t.id);if(!result)return t;const details=result.details;const images=Array.isArray(details?.images)?details.images:details?.image?[details.image]:t.images||[];const subagents=Array.isArray(details?.subagents)?details.subagents:t.subagents;return {...t,status:result.isError?'error':'done',output:output(result),images,subagents};});return value;});
}
// Provider snapshots can shrink or replace text after a retry. Keep the visible
// draft as a labelled previous version, without sending it back to the model.
export function mergeMessage(previous,next,final=false){
 if(!previous)return next;
 const merged={...previous,...next,versions:[...(previous.versions||[])]};
 for(const field of ['text','thinking']){
  const old=previous[field]||'',fresh=next[field]||'';
  if(old&&!fresh){merged[field]=old;if(final)merged.retained=true;}
  else if(old!==fresh&&old&&!fresh.startsWith(old)){
   if(!final&&old.startsWith(fresh))merged[field]=old;
   else if(!merged.versions.some(v=>v[field]===old))merged.versions.push({[field]:old});
  }
 }
 merged.tools=(next.tools||[]).map(t=>({...previous.tools?.find(p=>p.id===t.id),...t,status:t.status==='pending'?previous.tools?.find(p=>p.id===t.id)?.status||t.status:t.status}));
 for(const t of previous.tools||[])if(!merged.tools.some(n=>n.id===t.id))merged.tools.push(t);
 return merged;
}
// Compaction changes the conversation for real: its message list is the new truth,
// so nothing from the previous list may be kept except matching entries.
export function replaceMessages(previous,next){
 return mergeMatched(previous,next).merged;
}
function mergeMatched(previous,next){
 const used=new Set();const merged=next.map((m,i)=>{let index=previous.findIndex((p,j)=>!used.has(j)&&p.role===m.role&&m.timestamp!=null&&p.timestamp===m.timestamp);if(index<0&&previous[i]?.role===m.role&&!used.has(i))index=i;if(index<0)return m;used.add(index);return mergeMessage(previous[index],m,true);});
 return {merged,used};
}
export function reconcileMessages(previous,next){
 const {merged,used}=mergeMatched(previous,next);
 for(let i=0;i<previous.length;i++)if(!used.has(i)&&previous[i].role==='assistant'&&(previous[i].text||previous[i].thinking||previous[i].tools?.length))merged.splice(Math.min(i,merged.length),0,{...previous[i],retained:true,status:previous[i].status==='streaming'?'stopped':previous[i].status});
 return merged;
}
