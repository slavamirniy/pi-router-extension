import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// The installed pi CLI owns credentials, tools, extensions and project cwd.
export function createRpc({cli,cwd,path,model,onEvent=()=>{},spawnProcess=spawn}){
 const args=[cli,'--mode','rpc','--session',path];
 if(model?.id&&model?.provider)args.push('--provider',model.provider,'--model',model.id);
 const child=spawnProcess(process.execPath,args,{cwd,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PI_FRIENDLY_WEB_CHILD:'1'}});
 const pending=new Map();let buffer='',stderr='',stderrBuffer='',closed=false;
 const fail=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
  buffer+=chunk;
  if(buffer.length>32*1024*1024){fail(new Error('Ответ pi слишком большой.'));child.kill();return;}
  let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let event;try{event=JSON.parse(line);}catch{continue;}
   if(event.type==='response'&&pending.has(event.id)){const p=pending.get(event.id);pending.delete(event.id);clearTimeout(p.timer);event.success?p.resolve(event.data):p.reject(new Error(event.error||'pi не выполнил действие.'));}
   else onEvent(event);
  }
 });
 child.stderr.setEncoding('utf8');
 child.stderr.on('data',chunk=>{
  stderrBuffer+=chunk;
  if(stderrBuffer.length>65536){stderr=(stderr+stderrBuffer.slice(-1200)).slice(-1200);stderrBuffer='';return;}
  let i;while((i=stderrBuffer.indexOf('\n'))>=0){const line=stderrBuffer.slice(0,i).replace(/\r$/,'');stderrBuffer=stderrBuffer.slice(i+1);
   if(line.startsWith('PI_FRIENDLY_PROGRESS ')){
    try{const event=JSON.parse(line.slice('PI_FRIENDLY_PROGRESS '.length));if(event.type!=='friendly_router_progress')continue;const p=event.progress;
     if(p===null){onEvent({type:event.type,progress:null});continue;}
     if(!p||!['waiting','generating','retrying','streaming','completed','failed','cancelled'].includes(p.state)||typeof p.requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(p.requestId))continue;
     const number=n=>Number.isSafeInteger(n)&&n>=0?n:undefined;
     onEvent({type:event.type,progress:{requestId:p.requestId,state:p.state,preview:typeof p.preview==='string'?Array.from(p.preview).slice(-100).join(''):'',elapsedMs:number(p.elapsedMs),quota:number(p.quota),estimated:p.estimated!==false,available:number(p.available),attempt:number(p.attempt)}});
    }catch{}continue;
   }
   stderr=(stderr+line+'\n').slice(-1200);
  }
 });
 child.stdin.on('error',error=>fail(error));child.on('error',error=>{fail(error);onEvent({type:'process_error',message:error.message});});
 child.on('close',code=>{const wasClosed=closed;closed=true;fail(new Error('Процесс pi завершился. '+stderr));if(!wasClosed)onEvent({type:'process_error',message:`pi завершился (${code}). Откройте чат повторно.`});});
 return {
 request(type,data={},timeout=60000){if(closed)return Promise.reject(new Error('Соединение с pi закрыто.'));const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('pi не ответил вовремя. Попробуйте открыть чат ещё раз.'));},timeout);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({...data,type,id})+'\n');});},
 respond(data){if(!closed)child.stdin.write(JSON.stringify({...data,type:'extension_ui_response'})+'\n');},
 async dispose(){if(closed)return;closed=true;fail(new Error('Чат закрыт.'));child.stdin.end();child.kill();await Promise.race([new Promise(resolve=>child.once('close',resolve)),new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);timer.unref?.();})]);}
 };
}
