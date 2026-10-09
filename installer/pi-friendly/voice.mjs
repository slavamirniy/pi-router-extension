import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareVoice} from './voice-setup.mjs';

function setupError(error){
 const text=error?.message||String(error);
 if(/fetch|network|connect|timeout|ENOTFOUND/i.test(text))return 'Не удалось скачать голос. Проверьте интернет и нажмите «Повторить».';
 if(/ENOSPC|disk space|места/i.test(text))return 'Недостаточно места для голоса. Освободите место и нажмите «Повторить».';
 return text;
}
export function appendDictation(draft,text){return text.trim()?draft+(draft&&!/\s$/.test(draft)?' ':'')+text.trim():draft;}
export function createVoiceService({root,onState=()=>{},onText=()=>{},onError=()=>{},prepare=prepareVoice,spawnWorker=spawn}){
 let state={phase:'installing',label:'Подготовка голоса…'},child,controller,starting,disposed=false,sequence=0,recordingId,recordingContext,levels=[];
 const update=next=>{state=next;if(!disposed)onState(state);};
 const send=data=>{if(child?.stdin.writable)child.stdin.write(JSON.stringify(data)+'\n');};
 async function start(){
  if(disposed||starting||child)return starting;
  controller=new AbortController();
  starting=(async()=>{
   try{
    const runtime=await prepare(root,update,{signal:controller.signal});if(disposed)return;
    update({phase:'loading',label:'Запуск GigaAM…'});
    const process=child=spawnWorker(runtime.python,['-u',fileURLToPath(new URL('./voice-worker.py',import.meta.url)),'--model',runtime.modelDir],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...globalThis.process.env,PYTHONUTF8:'1',HF_HUB_OFFLINE:'1'}});
    let buffer='',details='';
    process.stdout.on('data',chunk=>{
     buffer+=chunk.toString();if(buffer.length>1024*1024){buffer='';return;}
     let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{event(JSON.parse(line));}catch{}}
    });
    process.stderr.on('data',chunk=>{details=(details+chunk.toString()).slice(-2000);});
    process.stdin.on('error',()=>{});
    process.on('error',error=>{if(child===process){child=undefined;update({phase:'error',label:'Голос недоступен',error:error.message});}});
    process.on('close',code=>{if(child===process){child=undefined;if(!disposed)update({phase:'error',label:'Повторить голос',error:`Процесс голоса завершился (${code}). ${details}`});}});
   }catch(error){if(!disposed)update({phase:'error',label:'Повторить голос',error:setupError(error)});}
   finally{starting=undefined;}
  })();return starting;
 }
 function event(message){
  if(disposed)return;
  if(message.type==='ready')update({phase:'ready',label:'Голос готов'});
  else if(message.type==='error')onError(message.message);
  else if(message.type==='text'&&message.id===recordingId){onText(message.text,recordingContext);recordingId=undefined;recordingContext=undefined;}
  else if(message.id===recordingId&&['recording','transcribing'].includes(message.type)){
   if(message.type==='recording'&&Number.isFinite(message.level))levels=[...levels.slice(-511),Math.max(0,Math.min(1,message.level))];
   update({phase:message.type,label:message.type==='recording'?'Слушаю…':'Распознаю…',seconds:message.seconds,levels,percent:message.type==='transcribing'?(message.percent??0):undefined});
  }
 }
 return {get state(){return state;},start,
  toggle(context){
   if(state.phase==='error'){void start();return;}
   if(state.phase==='ready'){
    levels=[];recordingId=String(++sequence);recordingContext=context;update({phase:'starting',label:'Включаю микрофон…'});send({type:'start',id:recordingId});
   }else if(state.phase==='recording'){update({phase:'transcribing',label:'Распознаю…',percent:0});send({type:'stop',id:recordingId});}
  },
  cancel(){if(recordingId){send({type:'cancel',id:recordingId});recordingId=undefined;recordingContext=undefined;}},
  dispose(){disposed=true;controller?.abort();send({type:'shutdown'});child?.kill();child=undefined;},
 };
}
