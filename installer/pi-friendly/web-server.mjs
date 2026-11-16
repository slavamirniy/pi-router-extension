import {createServer} from 'node:http';
import {readFile,readdir,mkdir,stat,unlink,rename,writeFile} from 'node:fs/promises';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {join,resolve,basename,dirname,relative,sep,isAbsolute} from 'node:path';
import {folderKey} from './projects.mjs';
import {sanitizeUploadName} from './uploads.mjs';
import {clean} from './menu.mjs';
import {activityLabel} from './activity.mjs';
const key=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
const isDir=async p=>{try{return (await stat(p)).isDirectory();}catch{return false;}};
const exists=async p=>{try{await stat(p);return true;}catch{return false;}};
const dirnameOf=p=>{const parent=resolve(p,'..');return parent===p||!p?resolve(p):parent;};
import {publicMessage,publicMessages,mergeMessage,reconcileMessages,toolView,updateTool} from './web-messages.mjs';
import {finalChatTitle,fallbackChatTitle,isValidChatTitle} from './title.mjs';
import {stripAttachments} from './web/attachments.js';
export {publicMessage,publicMessages} from './web-messages.mjs';
export async function startWebServer({billing,projects,listSessions,readSession,makeRpc,makeHostRpc,getHostStatuses=()=>[],models=()=>[],hostSession=()=>undefined,voice,port=0,tabCloseGraceMs=8000,disconnectGraceMs=90000,onExit=()=>{},canExit=()=>true,getPreferredModel=()=>undefined,onModelSelected=()=>{},pickProjectFolder,generateTitle,pickChatFiles,sessionDirFor,dropDir,generateImage}){
 const token=randomBytes(32).toString('hex'),cookie='pf_'+randomBytes(6).toString('hex'),clients=new Set();
 // A document has its own ID, including duplicated tabs and pages opened by reload.
 const tabs = new Map();
 let navigationDeadline = 0;
 const validTab = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
 function expireTab(id, tab, delay) {
  clearTimeout(tab.timer);
  tab.timer = setTimeout(() => {
   if (tabs.get(id) !== tab || disposed) return;
   tabs.delete(id);
   if (!tabs.size) void exitApplication().catch(error => console.error('Pi shutdown:', error.message));
  }, Math.max(delay, navigationDeadline - Date.now()));
  tab.timer.unref();
 }
 function attachTab(id, stream) {
  const tab = tabs.get(id) || {};
  clearTimeout(tab.timer);
  tab.stream = stream;
  tabs.set(id, tab);
  if (stream) navigationDeadline = 0;
  if (!stream) expireTab(id, tab, disconnectGraceMs);
  else stream.once('close', () => {
   if (disposed || tabs.get(id) !== tab || tab.stream !== stream) return;
   tab.stream = null;
   expireTab(id, tab, disconnectGraceMs);
  });
 }
 async function exitApplication() {
  if (disposed) return;
  try { await close(); } finally { await onExit(); }
 }
 let confirmBrowser;
 const browserReady=new Promise(resolve=>{confirmBrowser=resolve;});
 let rpc,active,loading=false,navigating=false,disposed=false,allProjects=[],allSessions=[],generation=0,publishTimer,voiceOwned=false,dropRoot;
 let state={active:null,messages:[],busy:false,loading:false,ready:false,error:null,notice:'',statuses:{},widgets:{},questions:[],queue:{steering:[],followUp:[]},voice:voice?.state||null,dictation:null};
 const messageVersions=new Map();
 const currentVersionIndex=new Map();
 const titleRequests=new Set();
 const snapshot=()=>({...state,billing:billing?.snapshot(),statuses:{...state.statuses,...(active?.host?Object.fromEntries(getHostStatuses().map((s,i)=>['host-'+i,clean(s)])):{})},loading,active,messageVersions:active?Object.fromEntries([...messageVersions.entries()].filter(([key])=>key.startsWith(active.id+'-')).map(([key,versions])=>{const idx=currentVersionIndex.get(key)??versions.length-1;return[key,{versions,currentIndex:idx}];})):{}});
 const broadcast=()=>{clearTimeout(publishTimer);publishTimer=undefined;const data='data: '+JSON.stringify(snapshot())+'\n\n';for(const client of clients){if(client.writableLength>2*1024*1024){client.destroy();clients.delete(client);}else client.write(data);}};
 const changed=()=>{if(!publishTimer)publishTimer=setTimeout(broadcast,35);};
 const unsubBilling=billing?.subscribe(()=>changed());
 const unsub=voice?.subscribe?.(event=>{if(event.type==='state'){state.voice=event.state;if(['ready','error'].includes(event.state.phase))voiceOwned=false;changed();}if(event.type==='text'&&event.context?.web){state.dictation={id:randomBytes(8).toString('hex'),text:event.text,chat:event.context.chat};voiceOwned=false;changed();}if(event.type==='error'&&voiceOwned){state.error=event.message;voiceOwned=false;changed();}});
 async function catalog(){
  allProjects=projects.list();
  const registered=new Set(allProjects.map(p=>folderKey(p.cwd)));
  const known=new Set();
  allSessions=(await listSessions()).filter(s=>s.cwd&&registered.has(folderKey(s.cwd)));
  for(const s of allSessions)known.add(key(s.path));
  return allProjects.map(p=>{
   const projectKey=key(folderKey(p.cwd));
   const chats=allSessions.filter(s=>folderKey(s.cwd)===folderKey(p.cwd)).sort((a,b)=>+new Date(b.modified)-+new Date(a.modified)).map(s=>({id:key(s.path),sessionId:s.id,name:s.name||(s.firstMessage&&s.firstMessage!=='(no messages)'?s.firstMessage.slice(0,80):'Новый чат'),modified:s.modified,count:s.messageCount||0,named:Boolean(s.name),parent:s.parentSessionPath&&known.has(key(s.parentSessionPath))?key(s.parentSessionPath):null,terminal:s.path===hostSession()}));
   // pi writes a forked session file only after the first assistant message.
   // Keep an empty fork visible as the active chat until its file exists.
   if(active?.file&&!active.host&&active.projectId===projectKey){
    const activeId=key(active.file);
    if(!chats.some(chat=>chat.id===activeId)){
     chats.unshift({id:activeId,name:active.name||'Новый чат',modified:new Date().toISOString(),count:state.messages.filter(m=>['user','assistant'].includes(m.role)).length,parent:active.parent||null,terminal:false,pendingFile:true});
    }
   }
   return {id:projectKey,name:p.name,folder:p.cwd,chats};
  });
 }
 function projectSessionDir(project){
  if(!project)return null;
  if(sessionDirFor)return sessionDirFor(project.cwd);
  const known=allSessions.find(session=>folderKey(session.cwd)===folderKey(project.cwd));
  return known?dirname(known.path):null;
 }
 async function archivedEntries(project){
  const dir=projectSessionDir(project);
  if(!dir)return [];
  const archived=join(dir,'archived');
  let names=[];
  try{names=await readdir(archived);}catch{return [];}
  const result=[];
  for(const name of names){
   if(!name.endsWith('.jsonl'))continue;
   const path=join(archived,name);
   let info;
   try{info=await stat(path);}catch{continue;}
   let messages=[];
   try{messages=readSession(path)||[];}catch{}
   const publicOnes=publicMessages(messages);
   const first=publicOnes.find(message=>message.role==='user'&&String(message.text||'').trim());
   const title=first?stripAttachments(String(first.text)).replace(/\s+/g,' ').slice(0,80):basename(name,'.jsonl');
   result.push({id:key(path),name:title||basename(name,'.jsonl'),count:publicOnes.filter(message=>['user','assistant'].includes(message.role)).length,modified:info.mtime.toISOString()});
  }
  return result.sort((a,b)=>+new Date(b.modified)-+new Date(a.modified));
 }
 function imageTarget(project,rel){
  const root=resolve(project.cwd,'generated');
  const target=resolve(project.cwd,String(rel||''));
  if(target!==root&&!target.startsWith(root+sep))throw new Error('Недопустимый путь к изображению.');
  return target;
 }
 function activeSessionId(){
  if(active?.sessionId)return active.sessionId;
  if(active?.file){const match=/_([0-9a-f-]{8,})\.jsonl$/i.exec(basename(active.file));if(match)return match[1];}
  return undefined;
 }
 async function imageRecords(project){
  const root=join(project.cwd,'generated');
  let chatDirs=[];
  try{chatDirs=await readdir(root,{withFileTypes:true});}catch{return [];}
  if(!allSessions.length)await catalog();
  const chatNames=new Map(allSessions.map(session=>[session.id,session.name||(session.firstMessage&&session.firstMessage!=='(no messages)'?session.firstMessage.slice(0,80):'Чат')]));
  const records=[];
  for(const chatDir of chatDirs){
   if(!chatDir.isDirectory()||chatDir.name==='_sources')continue;
   const chatId=chatDir.name;
   let files=[];
   try{files=await readdir(join(root,chatId));}catch{continue;}
   for(const file of files){
    if(!/\.(png|jpe?g)$/i.test(file))continue;
    const target=join(root,chatId,file);
    let info;
    try{info=await stat(target);}catch{continue;}
    let meta=null;
    try{meta=JSON.parse(await readFile(target.replace(/\.[^.]+$/,'.json'),'utf8'));}catch{}
    const rel=relative(project.cwd,target).split(sep).join('/');
    records.push({...(meta||{}),path:rel,file:rel,name:file,chatId:meta?.chatId||chatId,chatName:chatNames.get(chatId)||meta?.chatName||chatId,createdAt:meta?.createdAt||info.mtime.toISOString(),width:meta?.width||0,height:meta?.height||0});
   }
  }
  return records.sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt));
 }
 function uniqueTitle(title,chatId){
  const project=allProjects.find(p=>key(folderKey(p.cwd))===active?.projectId);
  if(!project)return title;
  const names=new Set();
  for(const session of allSessions){
   if(folderKey(session.cwd)!==folderKey(project.cwd)||key(session.path)===chatId)continue;
   const name=session.name||(session.firstMessage&&session.firstMessage!=='(no messages)'?session.firstMessage.slice(0,80):'');
   if(name)names.add(name.toLocaleLowerCase());
  }
  if(!names.has(title.toLocaleLowerCase()))return title;
  for(let i=2;i<100;i++){
   const candidate=`${title} · ${i}`;
   if(!names.has(candidate.toLocaleLowerCase()))return candidate;
  }
  return title;
 }
 async function maybeNameChat(sourceText){
  if(!active||active.readOnly||active.host||active.named)return;
  const chatId=active.id,targetRpc=rpc;
  if(!targetRpc||titleRequests.has(chatId))return;
  const rawText=(state.messages.find(m=>m.role==='user'&&String(m.text||'').trim())?.text||sourceText||'').trim();
  const firstText=stripAttachments(rawText).trim()||(rawText?'Работа с файлом':'');
  if(!firstText||firstText.startsWith('/'))return;
  titleRequests.add(chatId);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
   let raw='';
   if(generateTitle){try{raw=await generateTitle(firstText,controller.signal);}catch{raw='';}}
   let title=finalChatTitle(raw,firstText);
   if(!isValidChatTitle(title))title=fallbackChatTitle(firstText);
   if(!isValidChatTitle(title))title='Новая задача';
   title=uniqueTitle(title,chatId);
   if(active?.id!==chatId||active.named)return;
   await targetRpc.request('set_session_name',{name:title},10000);
   if(active?.id!==chatId||active.named)return;
   active={...active,name:title,named:true};
   await catalog();
   changed();
  }catch{}finally{clearTimeout(timer);titleRequests.delete(chatId);}
 }
 const ensureIdle=()=>{if(loading||navigating||state.busy||voiceOwned||!canExit())throw new Error('Сначала завершите запись или остановите ответ.');};
 function eventHandler(event,epoch){
  if(epoch!==generation||disposed)return;
  if(event.type==='agent_start'){state.busy=true;state.error=null;state.routerProgress=null;}
  if(event.type==='friendly_router_progress'){state.routerProgress=event.progress||null;}
  if(event.type==='agent_end'){rpc?.request('get_messages').then(data=>{if(epoch===generation){state.messages=reconcileMessages(state.messages,publicMessages(data?.messages||[]));changed();}}).catch(()=>{});}
  if(event.type==='queue_update')state.queue={steering:Array.isArray(event.steering)?event.steering:[],followUp:Array.isArray(event.followUp)?event.followUp:[]};
  if(event.type==='message_start'&&['user','assistant'].includes(event.message?.role))state.messages.push({...publicMessage(event.message),status:event.message.role==='assistant'?'streaming':'done'});
  if(event.type==='message_update'){
   const delta=event.assistantMessageEvent,index=state.messages.findLastIndex(m=>m.role==='assistant');
   if(index>=0){let last=state.messages[index];
    if(event.message)last=state.messages[index]=mergeMessage(last,{...publicMessage(event.message),status:'streaming'});
    else if(delta?.type==='text_delta')last.text+=delta.delta;
    else if(delta?.type==='thinking_delta')last.thinking=(last.thinking||'')+delta.delta;
    if(delta?.type==='toolcall_end'&&delta.toolCall&&!last.tools.some(t=>t.id===delta.toolCall.id))last.tools.push(toolView(delta.toolCall));
   }
  }
  if(event.type==='message_end'&&['user','assistant'].includes(event.message?.role)){const m=publicMessage(event.message);if(state.messages.at(-1)?.role===m.role)state.messages[state.messages.length-1]=mergeMessage(state.messages.at(-1),m,true);else state.messages.push(m);if(m.error)state.pendingError=m.error;}
  if(['tool_execution_start','tool_execution_update','tool_execution_end'].includes(event.type)){
   let found=false;
   for(const m of state.messages)m.tools=m.tools.map(tool=>{if(tool.id!==event.toolCallId)return tool;found=true;return updateTool(tool,event);});
   if(!found){let m=state.messages.findLast(m=>m.role==='assistant');if(!m){m=publicMessage({role:'assistant'});state.messages.push(m);}m.tools.push(updateTool(toolView({id:event.toolCallId,name:event.toolName,arguments:event.args}),event));}
  }
  if(event.type==='auto_retry_start'){state.busy=true;state.notice='';}
  if(event.type==='auto_retry_end'){state.notice='';if(!event.success){state.busy=false;state.error=event.finalError||'Не удалось восстановить подключение.';}}
  if(event.type==='agent_settled'){state.busy=false;const last=state.messages.findLast(m=>m.role==='assistant');state.error=last?.error||null;state.pendingError=null;state.notice='';}
  if(event.type==='agent_end')for(const m of state.messages)if(m.status==='streaming')m.status='done';
  if(event.type==='process_error'){state.busy=false;state.error=event.message;for(const m of state.messages){if(m.status==='streaming')m.status='stopped';for(const t of m.tools)if(t.status==='running')t.status='stopped';}}
  if(event.type==='extension_ui_request'){
   if(['select','confirm','input','editor'].includes(event.method)){state.questions.push({...event,expires:event.timeout?Date.now()+event.timeout:null});}
   if(event.method==='notify'){if(event.notifyType==='error'){if(state.busy)state.pendingError=clean(event.message);else state.error=clean(event.message);}else if(!state.busy)state.notice=clean(event.message);}
   if(event.method==='setStatus'){if(event.statusText)state.statuses[event.statusKey]=clean(event.statusText);else delete state.statuses[event.statusKey];}
   if(event.method==='setWidget'){if(event.widgetLines)state.widgets[event.widgetKey]=event.widgetLines.map(clean);else delete state.widgets[event.widgetKey];}
   if(event.method==='set_editor_text')state.dictation={id:event.id,text:event.text,chat:active?.id,replace:true};
  }
  changed();
 }
 async function openSession(session,{notify=true,waitForReady=false}={}){
  loading=true;state.error=null;if(notify)changed();const epoch=++generation;
  let settle;
  const ready=new Promise(resolve=>{settle=resolve;});
  try{
   const previousRpc=rpc;rpc=undefined;if(previousRpc)void previousRpc.dispose();
   const p=allProjects.find(p=>folderKey(p.cwd)===folderKey(session.cwd));if(!p||!projects.isProject(p.cwd))throw new Error('Выберите существующий проект.');
   projects.markOpened?.(p.cwd);
   active={id:key(session.path),sessionId:session.id,projectId:key(folderKey(p.cwd)),projectName:p.name,name:session.name||(session.firstMessage&&session.firstMessage!=='(no messages)'?session.firstMessage.slice(0,80):'Новый чат'),host:session.path===hostSession(),readOnly:session.path===hostSession()&&!makeHostRpc,named:Boolean(session.name),ready:false};
   state={...state,routerProgress:null,messages:publicMessages(readSession(session.path)),busy:false,error:null,notice:'',questions:[],queue:{steering:[],followUp:[]},statuses:{},widgets:{},ready:false};
   loading=false;
   if(active.readOnly){
    active={...active,ready:true};state={...state,ready:true};
    if(notify)broadcast();settle(true);return {ready};
   }
   // The file history is already visible. The RPC child starts in the background.
   if(notify)broadcast();
   void (async()=>{
    let nextRpc;
    try{
     nextRpc=(session.path===hostSession()&&makeHostRpc?makeHostRpc:makeRpc)({cwd:p.cwd,path:session.path,onEvent:e=>eventHandler(e,epoch)});
     if(epoch!==generation){await nextRpc.dispose();settle(false);return;}
     rpc=nextRpc;
     const [current,messages]=await Promise.all([nextRpc.request('get_state',{},20000),nextRpc.request('get_messages',{},20000)]);
     if(epoch!==generation){await nextRpc.dispose();settle(false);return;}
     active={...active,model:current?.model?{id:current.model.id,provider:current.model.provider,name:current.model.name}:null,file:current?.sessionFile||session.path,sessionId:current?.sessionId||active.sessionId};
     state={...state,busy:Boolean(current?.isStreaming),queue:{steering:[],followUp:[]}};
     const preferred=getPreferredModel();
     if(preferred&&!state.busy&&(active.model?.id!==preferred.id||active.model?.provider!==preferred.provider)){
      await nextRpc.request('set_model',{provider:preferred.provider,modelId:preferred.id});
      if(epoch===generation)active={...active,model:{id:preferred.id,provider:preferred.provider,name:preferred.name}};
     }
     if(epoch!==generation){await nextRpc.dispose();settle(false);return;}
     state={...state,messages:reconcileMessages(state.messages,publicMessages(messages?.messages||[])),ready:true,loading:false};
     active={...active,ready:true};
     if(notify){changed();broadcast();}
     settle(true);
    }catch(error){
     if(epoch===generation){
      if(rpc===nextRpc)rpc=undefined;
      state={...state,ready:false,loading:false,error:error.message};
      if(notify){changed();broadcast();}
     }
     try{await nextRpc?.dispose();}catch{}
     settle(false);
    }
   })();
   if(waitForReady)await ready;
   return {ready};
  }catch(error){
   if(rpc)await rpc.dispose();rpc=undefined;state={...state,error:error.message,ready:false,loading:false};changed();settle(false);throw error;
  }
 }
 async function branchAt(index,{text='',name=''}={}){
  if(!rpc||!active||active.readOnly)throw new Error('Сначала откройте чат в проекте.');
  if(active.host)throw new Error('Ответвление недоступно для чата, открытого в консоли. Создайте новый чат.');
  if(state.busy||loading||navigating||voiceOwned)throw new Error('Сначала остановите ответ и дождитесь завершения действия.');
  const forkMessages=(await rpc.request('get_fork_messages',{},20000))?.messages||[];
  const userIndexes=state.messages.map((m,i)=>m.role==='user'?i:-1).filter(i=>i>=0);
  const ordinal=userIndexes.indexOf(index);
  const target=ordinal>=0?forkMessages[ordinal]:undefined;
  if(!target)throw new Error('Не удалось найти это сообщение в текущем чате.');
  const label=(name||`Чат от «${String(target.text||'').replace(/\s+/g,' ').slice(0,42)}»`).slice(0,80);
  // Forking at the first user message produces an empty conversation. pi keeps
  // such a session in memory and writes no file until an assistant reply, so
  // create a real empty chat instead; it appears in the list immediately.
  if(ordinal===0){
   const project=allProjects.find(p=>key(folderKey(p.cwd))===active.projectId);
   if(!project)throw new Error('Проект не найден.');
   const nextPath=projects.createChat(project.cwd);
   await openSession({path:nextPath,cwd:project.cwd,name:label},{notify:false,waitForReady:true});
   if(!rpc||state.ready===false)throw new Error(state.error||'Не удалось подключиться к новому чату.');
   try{await rpc.request('set_session_name',{name:label},10000);}catch{}
   active={...active,name:label};
   await catalog();
   if(text){
    state.busy=true;changed();
    try{await rpc.request('prompt',{message:text},300000);}
    catch(error){state.busy=false;state.error=error.message;changed();throw error;}
   }
   broadcast();
   return snapshot();
  }
  const forked=await rpc.request('fork',{entryId:target.entryId},30000);
  if(forked?.cancelled)throw new Error('Создание ответвления отменено расширением.');
  const current=await rpc.request('get_state',{},20000);
  if(!current?.sessionFile)throw new Error('pi не сообщил файл нового чата.');
  try{await rpc.request('set_session_name',{name:label},10000);}catch{}
  const previousFile=active.file;
  active={...active,id:key(current.sessionFile),name:label,file:current.sessionFile,parent:previousFile?key(previousFile):null,host:false,readOnly:false,named:true};
  const messages=await rpc.request('get_messages',{},20000);
  state={...state,messages:publicMessages(messages?.messages||[]),busy:false,error:null,notice:'',questions:[],queue:{steering:[],followUp:[]},statuses:{},widgets:{}};
  await catalog();
  if(text){
   state.busy=true;changed();
   try{await rpc.request('prompt',{message:text},300000);}
   catch(error){state.busy=false;state.error=error.message;changed();throw error;}
  }
  broadcast();
  return snapshot();
 }
 async function body(req,limit=1024*1024){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Слишком большое сообщение.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
 let origin;
 const server=createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin){reply(403,{error:'Запрос с другого адреса запрещён.'});return;}
   const url=new URL(req.url,origin);
   const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
   for(const [k,v]of Object.entries(safeHeaders))res.setHeader(k,v);
   if(req.method==='POST'&&url.pathname==='/api/auth'){
    const data=await body(req),supplied=Buffer.from(String(data.token||'')),expected=Buffer.from(token);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){reply(403,{error:'Откройте веб-интерфейс кнопкой в pi.'});return;}
    if(validTab(data.tab) && !tabs.has(data.tab)) attachTab(data.tab, null);
    res.setHeader('Set-Cookie',`${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/`);reply(200,{ok:true});confirmBrowser(true);return;
   }
   if(url.pathname.startsWith('/api/')){
    if(!(req.headers.cookie||'').split(';').some(v=>v.trim()===`${cookie}=${token}`)){reply(401,{error:'Откройте веб-интерфейс кнопкой в pi.'});return;}
    if(req.method==='POST' && url.pathname==='/api/tab-left'){
     const {tab:id}=await body(req,1024);
     const tab=tabs.get(id);
     if(tab){
      tab.stream=null;
      expireTab(id,tab,tabCloseGraceMs);
     }
     reply(200,{ok:true});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/events'){const id=url.searchParams.get('tab');if(validTab(id))attachTab(id,res);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('data: '+JSON.stringify(snapshot())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
    if(req.method==='GET'&&url.pathname==='/api/billing'){reply(200,billing?.snapshot()||{});return;}
    if(req.method==='GET'&&url.pathname==='/api/offers'){if(!billing)throw Error('Пополнение не подключено.');reply(200,await billing.offers());return;}
    if(req.method==='GET'&&url.pathname==='/api/catalog'){reply(200,{projects:await catalog()});return;}
    if(req.method==='GET'&&url.pathname==='/api/models'){reply(200,{models:(await models()).map(m=>({id:m.id,name:m.name||m.id,provider:m.provider}))});return;}
    if(req.method==='GET'&&url.pathname==='/api/image'){
     if(!allProjects.length)await catalog();
     const project=allProjects.find(p=>key(folderKey(p.cwd))===url.searchParams.get('project'));
     if(!project)throw new Error('Проект не найден.');
     const target=imageTarget(project,url.searchParams.get('path'));
     const info=await stat(target);
     if(!info.isFile())throw new Error('Изображение не найдено.');
     const type=/\.png$/i.test(target)?'image/png':/\.jpe?g$/i.test(target)?'image/jpeg':'application/octet-stream';
     res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'Cache-Control':'private, max-age=3600'});
     res.end(await readFile(target));return;
    }
   if(req.method==='GET'&&url.pathname==='/api/browse-folders'){
    const start=String(url.searchParams.get('path')||'').trim()||join(homedir());
    if(!isAbsolute(start))throw new Error('Укажите полный путь.');
    let cwd=start;
    while(!await isDir(cwd)){const parent=dirnameOf(cwd);if(parent===cwd)throw new Error('Папка недоступна.');cwd=parent;}
    if(!cwd)throw new Error('Папка недоступна.');
    try{const names=await readdir(cwd,{withFileTypes:true});
     const entries=[];for(const e of names){if(!e.isDirectory())continue;let ok=true;try{await stat(join(cwd,e.name));}catch{ok=false;}if(ok)entries.push({name:e.name});}
     entries.sort((a,b)=>a.name.localeCompare(b.name,'ru'));const visible=entries.filter(e=>!e.name.startsWith('.')),hidden=entries.filter(e=>e.name.startsWith('.'));
     const all=hidden.concat(visible).slice(0,500);
     const home=homedir();
     const candidates=[
      {name:'Домашняя папка',path:home,kind:'home'},
      {name:'Документы',path:join(home,'Documents'),kind:'documents'},
      {name:'Рабочий стол',path:join(home,'Desktop'),kind:'desktop'},
      {name:'Загрузки',path:join(home,'Downloads'),kind:'downloads'},
      {name:'Проекты AI DIY',path:projects.root||join(home,'Documents','AI DIY Projects'),kind:'projects'},
     ];
     const shortcuts=[];const seenPaths=new Set();
     for(const item of candidates){
      if(!item.path)continue;
      const clean=resolve(item.path);
      if(seenPaths.has(clean)||!(await isDir(clean)))continue;
      seenPaths.add(clean);shortcuts.push({...item,path:clean});
     }
     reply(200,{path:resolve(cwd),parent:dirnameOf(cwd)===cwd?null:dirnameOf(cwd),entries:all.map(e=>({name:e.name,path:join(cwd,e.name)})),hasMore:hidden.length+visible.length>all.length,shortcuts});
    }catch(error){reply(400,{error:'Не удалось открыть папку: '+error.message});}
    return;
   }
   if(req.method==='POST'&&url.pathname==='/api/upload'){
    ensureIdle();
    const data=await body(req,140*1024*1024);ensureIdle();
    const p=allProjects.find(p=>key(folderKey(p.cwd))===data.project);
    if(!p||!projects.isProject(p.cwd))throw new Error('Сначала выберите проект.');
    const maxTotal=100*1024*1024;let total=0;const saved=[];
    for(const f of Array.isArray(data.files)?data.files.slice(0,50):[]){
     if(f?.truncated)throw new Error('Файл слишком большой (до 50 МБ).');
     const buf=Buffer.from(String(f.content||''),'base64');const name=sanitizeUploadName(f.name);if(!name)continue;
     if(buf.length>50*1024*1024)throw new Error('Файл слишком большой (до 50 МБ).');total+=buf.length;if(total>maxTotal)throw new Error('Слишком много файлов за один раз (до 100 МБ).');
     await mkdir(p.cwd,{recursive:true});
     let target=join(p.cwd,name),stem=name,ext='';
     const dot=name.lastIndexOf('.');if(dot>0){stem=name.slice(0,dot);ext=name.slice(dot);}
     const {writeFile}=await import('node:fs/promises');
     for(let i=1;;i++){try{await writeFile(target,buf,{flag:'wx'});break;}catch(error){if(error.code!=='EEXIST')throw error;target=join(p.cwd,`${stem} (${i})${ext}`);}}
     saved.push(basename(target));
    }
    reply(200,{saved});return;
   }
    if(req.method==='POST'&&url.pathname==='/api/image-source'){
     if(!active||active.readOnly)throw new Error('Сначала откройте чат в проекте.');
     if(!allProjects.length)await catalog();
     const project=allProjects.find(p=>key(folderKey(p.cwd))===active.projectId);
     if(!project)throw new Error('Проект не найден.');
     const payload=await body(req,16*1024*1024);
     const data=Buffer.from(String(payload.content||''),'base64');
     if(!data.length)throw new Error('Файл пуст.');
     if(data.length>11*1024*1024)throw new Error('Выберите PNG или JPEG до 11 МБ.');
     const png=data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
     const jpeg=data[0]===0xff&&data[1]===0xd8;
     if(!png&&!jpeg)throw new Error('Выберите PNG или JPEG.');
     const dir=join(project.cwd,'generated','_sources');
     await mkdir(dir,{recursive:true});
     const target=join(dir,`source-${Date.now()}-${randomBytes(4).toString('hex')}.${jpeg?'jpg':'png'}`);
     await writeFile(target,data,{flag:'wx',mode:0o600});
     reply(200,{path:relative(project.cwd,target).split(sep).join('/'),name:sanitizeUploadName(payload.name)||basename(target)});
     return;
    }
    if(req.method==='POST'&&url.pathname==='/api/drop-attach'){
     if(!active||active.readOnly)throw new Error('Сначала откройте чат в проекте.');
     const payload=await body(req,140*1024*1024);
     if(!dropRoot){dropRoot=dropDir||join(homedir(),'.pi','agent','friendly-drop');await mkdir(dropRoot,{recursive:true});}
     const saved=[];let total=0;
     for(const f of Array.isArray(payload.files)?payload.files.slice(0,50):[]){
      const buf=Buffer.from(String(f.content||''),'base64');
      if(!buf.length)continue;
      if(buf.length>50*1024*1024)throw new Error('Файл больше 50 МБ.');
      total+=buf.length;if(total>100*1024*1024)throw new Error('Слишком много файлов за один раз (до 100 МБ).');
      const name=sanitizeUploadName(f.name)||'file';
      const target=join(dropRoot,`${Date.now()}-${randomBytes(5).toString('hex')}-${name}`);
      await writeFile(target,buf);
      saved.push({name,path:target,size:buf.length});
     }
     reply(200,{files:saved});return;
    }
    if(req.method!=='POST'){reply(404,{error:'Неизвестное действие.'});return;}
    const data=await body(req),action=url.pathname.slice(5);
    if(action==='buy'){if(!billing)throw Error('Пополнение не подключено.');reply(200,await billing.buy(data));return;}
    if(action==='order'){if(!billing)throw Error('Пополнение не подключено.');reply(200,await billing.order(data.id));return;}
    if(action==='attach-project'){ensureIdle();navigating=true;try{
   let path=data.path?resolve(String(data.path)):null;
   if(!path&&pickProjectFolder)path=await pickProjectFolder();
   if(!path){reply(200,{cancelled:true});return;}
   const p=projects.attach(path);projects.markOpened?.(p.cwd);reply(200,{project:key(folderKey(p.cwd)),projects:await catalog()});}finally{navigating=false;}return;}
    if(action==='open-project'){await catalog();const p=allProjects.find(p=>key(folderKey(p.cwd))===data.project);if(!p)throw new Error('Проект не найден.');projects.markOpened?.(p.cwd);reply(200,{ok:true});return;}
    if(action==='create-project'){ensureIdle();navigating=true;try{const p=projects.create(data.name);await catalog();const path=projects.createChat(p.cwd);await openSession({path,cwd:p.cwd},{waitForReady:data.fast!==true});reply(200,snapshot());}finally{navigating=false;}return;}
    if(action==='new-chat'){ensureIdle();navigating=true;try{await catalog();const p=allProjects.find(p=>key(folderKey(p.cwd))===data.project);if(!p)throw new Error('Сначала выберите проект.');const path=projects.createChat(p.cwd);await openSession({path,cwd:p.cwd},{waitForReady:data.fast!==true});reply(200,snapshot());}finally{navigating=false;}return;}
    if(action==='open'){ensureIdle();navigating=true;try{if(!allProjects.length||!allSessions.some(s=>key(s.path)===data.id))await catalog();const session=allSessions.find(s=>key(s.path)===data.id);if(!session)throw new Error('Разговор не найден. Обновите проекты.');await openSession(session,{waitForReady:data.fast!==true});reply(200,snapshot());}finally{navigating=false;}return;}
    if(action==='voice'){
     if(!voice)throw new Error('Голос ещё не готов. Откройте интерфейс из pi.');
     if(!active||data.chat!==active.id)throw new Error('Сначала откройте чат.');
     if(voice.state.phase==='recording'&&voiceOwned)voice.toggle({web:true,chat:active.id});
     else if(voice.state.phase==='ready'&&!loading){voiceOwned=true;voice.toggle({web:true,chat:active.id});}
     else if(voice.state.phase==='error'){await voice.start();}else throw new Error('Для голосового ввода дождитесь загрузки модели или завершения записи.');
     reply(200,{ok:true});return;
    }
    if(action==='close'){ensureIdle();if(!canExit())throw new Error('Сначала остановите текущую работу.');navigating=true;reply(200,{ok:true});setTimeout(()=>void exitApplication().catch(error=>console.error('Pi shutdown:',error.message)),50);return;}
    if(action==='pick-attach'){
     if(!pickChatFiles)throw new Error('Выбор файлов доступен только в локальном интерфейсе.');
     const files=await pickChatFiles();
     reply(200,{files:Array.isArray(files)?files:[]});return;
    }
    if(action==='archived'||action==='restore-archived'||action==='delete-archived'){
     if(!allProjects.length)await catalog();
     const project=allProjects.find(p=>key(folderKey(p.cwd))===data.project);
     if(!project)throw new Error('Проект не найден.');
     const dir=projectSessionDir(project);
     if(!dir)throw new Error('Папка сессий проекта не найдена.');
     const archived=join(dir,'archived');
     if(action==='archived'){reply(200,{chats:await archivedEntries(project)});return;}
     let names=[];
     try{names=await readdir(archived);}catch{throw new Error('Архив пуст.');}
     const targetName=names.find(name=>name.endsWith('.jsonl')&&key(join(archived,name))===data.id);
     if(!targetName)throw new Error('Архивный чат не найден. Обновите список.');
     const source=join(archived,targetName);
     if(action==='delete-archived'){await unlink(source);}
     else{
      const ext='.jsonl',stem=basename(targetName,ext);
      let target=join(dir,targetName);
      for(let n=1;await exists(target);n++)target=join(dir,`${stem}-restored-${n}${ext}`);
      await rename(source,target);
     }
     const projects=await catalog();changed();
     reply(200,{ok:true,projects});return;
    }
    if(action==='images'){
     if(!allProjects.length)await catalog();
     const project=allProjects.find(p=>key(folderKey(p.cwd))===data.project);
     if(!project)throw new Error('Проект не найден.');
     reply(200,{images:await imageRecords(project)});return;
    }
    if(action==='image-delete'){
     if(!allProjects.length)await catalog();
     const project=allProjects.find(p=>key(folderKey(p.cwd))===data.project);
     if(!project)throw new Error('Проект не найден.');
     const target=imageTarget(project,data.path);
     await unlink(target);
     try{await unlink(target.replace(/\.[^.]+$/,'.json'));}catch{}
     reply(200,{ok:true});return;
    }
    if(action==='image-generate'||action==='image/generate'){
     if(!active||active.readOnly)throw new Error('Сначала откройте чат в проекте.');
     if(!generateImage)throw new Error('Генерация изображений не подключена.');
     if(!allProjects.length)await catalog();
     const project=allProjects.find(p=>key(folderKey(p.cwd))===active.projectId);
     if(!project)throw new Error('Проект не найден.');
     const prompt=String(data.prompt||'').trim();
     if(!prompt)throw new Error('Опишите изображение.');
     try{
      const result=await generateImage({prompt,size:data.size?String(data.size):undefined,source:data.source?String(data.source):undefined,sources:Array.isArray(data.sources)?data.sources.map(value=>String(value||'')).filter(Boolean).slice(0,4):undefined,cwd:project.cwd,sessionId:activeSessionId(),idempotencyKey:data.requestId?String(data.requestId):undefined});
      reply(200,{image:result?.details?.image||null,images:result?.details?.images||[]});
     }catch(error){
      reply(error.status===402?402:error.status===409?409:400,{error:error.message,code:error.code,requestId:error.requestId});
     }
     return;
    }
    if(action==='history'){
     if(!allProjects.length||!allSessions.length)await catalog();
     const session=allSessions.find(s=>key(s.path)===data.chat);
     if(!session)throw new Error('Чат не найден. Обновите список.');
     reply(200,{chat:key(session.path),messages:publicMessages(readSession(session.path))});return;
    }
    if(action==='delete-chat'||action==='archive-chat'){
     const session=allSessions.find(s=>key(s.path)===data.chat);
     if(!session)throw new Error('Чат не найден. Обновите список.');
     if(session.path===hostSession())throw new Error('Чат открыт в консоли и не может быть изменён из веба.');
     const isActive=Boolean(active&&key(session.path)===active.id);
     if(isActive&&state.busy)throw new Error('Сначала остановите ответ.');
     if(isActive){
      if(rpc)await rpc.dispose();
      rpc=undefined;generation++;active=null;
      state={...state,active:null,messages:[],busy:false,error:null,notice:'',questions:[],queue:{steering:[],followUp:[]},statuses:{},widgets:{},routerProgress:null};
     }
     if(action==='delete-chat')await unlink(session.path);
     else{
      const archived=join(dirname(session.path),'archived');
      await mkdir(archived,{recursive:true});
      const ext='.jsonl',stem=basename(session.path,ext);
      let target=join(archived,basename(session.path));
      for(let n=1;await exists(target);n++)target=join(archived,`${stem}-${n}${ext}`);
      await rename(session.path,target);
     }
     const projects=await catalog();changed();
     reply(200,{ok:true,projects});return;
    }
    if(!rpc||!active||active.readOnly)throw new Error(active?.readOnly?'Этот чат открыт в консоли. Создайте новый чат в этом проекте.':'Сначала откройте чат в проекте.');
    if(state.ready===false)throw new Error('Чат ещё подключается. Подождите секунду.');
    if(data.chat!==active.id)throw new Error('Чат был переключён в другом окне. Проверьте текущий разговор.');
    if(action==='prompt'){
     if(voiceOwned||loading||navigating)throw new Error('Дождитесь завершения текущего действия.');
     const message=String(data.text||'').trim();if(!message)throw new Error('Введите сообщение.');
     if(state.messages.some(m=>m.status==='streaming'&&m.role==='user'))throw new Error('Дождитесь отправки предыдущего сообщения.');
     if(active.host&&state.busy)throw new Error('В консоли уже идёт ответ. Дождитесь его завершения.');
     const queued=Boolean(state.busy);
     state.busy=true;state.error=null;state.notice='';state.dictation=null;
     if(queued){state.queue={...state.queue,followUp:[...state.queue.followUp,message]};}
     changed();const epoch=generation;
     try{
      const payload={message};
      if(queued)payload.streamingBehavior=data.steer?'steer':'followUp';
      try{await rpc.request('prompt',payload,300000);}
      catch(error){
       if(!queued&&/already processing|streamingBehavior/i.test(error.message))await rpc.request('prompt',{message,streamingBehavior:'followUp'},300000);
       else throw error;
      }
      void rpc.request('get_state').then(current=>{if(epoch===generation&&typeof current?.isStreaming==='boolean'){state.busy=current.isStreaming;changed();}}).catch(()=>{});
      if(!queued)void maybeNameChat(message);
      reply(200,{ok:true,queued,queue:state.queue});
     }catch(error){
      if(epoch===generation){
       if(queued){const pending=[...state.queue.followUp],index=pending.lastIndexOf(message);if(index>=0)pending.splice(index,1);state.queue={...state.queue,followUp:pending};}
       if(!queued)state.busy=false;
       state.error=error.message;changed();
      }
      throw error;
     }
     return;
    }
    if(action==='clear-queue'){
     const removed=await rpc.request('clear_queue',{},15000);
     state.queue={steering:[],followUp:[]};changed();
     reply(200,{ok:true,steering:removed?.steering||[],followUp:removed?.followUp||[]});return;
    }
    if(action==='unqueue'){
     const target=Number(data.index),removed=await rpc.request('clear_queue',{},15000);
     const follow=Array.isArray(removed?.followUp)?removed.followUp:[],steering=Array.isArray(removed?.steering)?removed.steering:[];
     if(!Number.isInteger(target)||target<0||target>=follow.length)throw new Error('Сообщение уже отправлено или очередь изменилась.');
     const text=follow[target],rest=follow.filter((_,i)=>i!==target);
     for(const message of rest)await rpc.request('prompt',{message,streamingBehavior:'followUp'},60000);
     state.queue={steering,followUp:rest};changed();
     reply(200,{ok:true,removed:text,queue:state.queue});return;
    }
    if(action==='edit-queue'){
     if(!rpc||!active||active.readOnly)throw new Error('Сначала откройте чат в проекте.');
     const index=Number(data.index),text=String(data.text||'').trim();
     if(!text)throw new Error('Введите текст сообщения.');
     const removed=await rpc.request('clear_queue',{},15000);
     const follow=Array.isArray(removed?.followUp)?[...removed.followUp]:[],steering=Array.isArray(removed?.steering)?removed.steering:[];
     if(!Number.isInteger(index)||index<0||index>=follow.length)throw new Error('Сообщение уже отправлено или очередь изменилась.');
     follow[index]=text;
     if(state.busy)for(const message of follow)await rpc.request('prompt',{message,streamingBehavior:'followUp'},60000);
     state.queue={steering,followUp:state.busy?follow:[]};changed();
     reply(200,{ok:true,queue:state.queue});return;
    }
    if(action==='send-now'||action==='send-all'){
     if(!rpc||!active||active.readOnly)throw new Error('Сначала откройте чат в проекте.');
     const removed=await rpc.request('clear_queue',{},15000);
     const follow=Array.isArray(removed?.followUp)?[...removed.followUp]:[],steering=Array.isArray(removed?.steering)?removed.steering:[];
     if(!follow.length)throw new Error('Очередь пуста.');
     let selected,rest;
     if(action==='send-all'){
      selected=follow.length?follow[0]:'';
      rest=follow.slice(1);
     }else{
      const index=Number(data.index);
      if(!Number.isInteger(index)||index<0||index>=follow.length)throw new Error('Сообщение уже отправлено или очередь изменилась.');
      selected=follow[index];rest=follow.filter((_,i)=>i!==index);
     }
     if(!selected)throw new Error('Очередь пуста.');
     if(state.busy){
      await rpc.request('abort');
      state.busy=false;
      for(const m of state.messages){if(m.status==='streaming')m.status='stopped';for(const t of m.tools)if(t.status==='running')t.status='stopped';}
      state.queue={steering,followUp:[]};changed();
      await new Promise(resolve=>setTimeout(resolve,80));
     }
     state.busy=true;state.error=null;changed();
     try{
      await rpc.request('prompt',{message:selected},300000);
      for(const message of rest)await rpc.request('prompt',{message,streamingBehavior:'followUp'},60000);
      state.queue={steering,followUp:rest};changed();
      void maybeNameChat(selected);
      reply(200,{ok:true,queue:state.queue});
     }catch(error){
      state.busy=false;state.error=error.message;state.queue={steering,followUp:[selected,...rest]};changed();throw error;
     }
     return;
    }
    if(action==='abort'){
     let cleared={steering:[],followUp:[]};
     try{cleared=await rpc.request('clear_queue',{},15000)||cleared;}catch{}
     await rpc.request('abort');state.busy=false;state.queue={steering:[],followUp:[]};for(const m of state.messages){if(m.status==='streaming')m.status='stopped';for(const t of m.tools)if(t.status==='running')t.status='stopped';}changed();reply(200,{ok:true,cleared});return;
    }
    if(action==='model'){ensureIdle();const model=(await models()).find(m=>m.id===data.id&&m.provider===data.provider);if(!model)throw new Error('Модель недоступна.');await rpc.request('set_model',{provider:model.provider,modelId:model.id});onModelSelected(model);active.model={id:model.id,name:model.name,provider:model.provider};changed();reply(200,{ok:true});return;}
    if(action==='answer'){const q=state.questions.find(q=>q.id===data.id);if(!q)throw new Error('Запрос уже закрыт.');rpc.respond({id:q.id,...(data.cancelled?{cancelled:true}:q.method==='confirm'?{confirmed:data.confirmed===true}:{value:String(data.value||'')})});state.questions=state.questions.filter(q=>q!==q);changed();reply(200,{ok:true});return;}
    if(action==='edit-message'){
     ensureIdle();const index=Number(data.index);if(!Number.isInteger(index)||index<0||index>=state.messages.length)throw new Error('Неверный индекс сообщения.');if(state.messages[index].role!=='user')throw new Error('Можно редактировать только сообщения пользователя.');const text=String(data.text||'').trim();if(!text)throw new Error('Введите текст сообщения.');
     const result=await branchAt(index,{text,name:data.name});reply(200,result);return;
    }
    if(action==='switch-version'){const index=Number(data.index);if(!Number.isInteger(index)||index<0||index>=state.messages.length)throw new Error('Неверный индекс сообщения.');const versionKey=`${active.id}-${index}`;const versions=messageVersions.get(versionKey);if(!versions||versions.length<2)throw new Error('Нет других версий.');const versionIndex=Number(data.versionIndex);if(!Number.isInteger(versionIndex)||versionIndex<0||versionIndex>=versions.length)throw new Error('Неверный индекс версии.');currentVersionIndex.set(versionKey,versionIndex);state.messages[index].text=versions[versionIndex].text;state.messages[index].timestamp=versions[versionIndex].timestamp;changed();reply(200,{ok:true,currentVersion:versionIndex,totalVersions:versions.length});return;}
    if(action==='branch-from'||action==='fork'){
     ensureIdle();const index=Number(data.index);if(!Number.isInteger(index)||index<0||index>=state.messages.length)throw new Error('Неверный индекс сообщения.');if(state.messages[index].role!=='user')throw new Error('Ответвление можно создать только от сообщения пользователя.');
     const text=data.text===undefined?'':String(data.text).trim();
     const result=await branchAt(index,{text,name:data.name});reply(200,result);return;
    }
    if(action==='rename-branch'){
     const name=String(data.name||'').trim();if(!name)throw new Error('Введите название ветки.');
     await rpc.request('set_session_name',{name:name.slice(0,80)});active={...active,name:name.slice(0,80),named:true};await catalog();changed();reply(200,{ok:true});return;
    }
    reply(404,{error:'Неизвестное действие.'});return;
   }
   const assets={'/':['web/index.html','text/html'],'/app.js':['web/app.js','text/javascript'],'/onboarding.js':['web/onboarding.js','text/javascript'],'/app.css':['web/app.css','text/css'],'/billing-ui.js':['web/billing-ui.js','text/javascript'],'/message-versions.js':['web/message-versions.js','text/javascript'],'/attachments.js':['web/attachments.js','text/javascript'],'/fonts/geist-cyrillic.woff2':['web/fonts/geist-cyrillic.woff2','font/woff2'],'/fonts/geist-latin.woff2':['web/fonts/geist-latin.woff2','font/woff2'],'/fonts/geist-mono-cyrillic.woff2':['web/fonts/geist-mono-cyrillic.woff2','font/woff2'],'/fonts/geist-mono-latin.woff2':['web/fonts/geist-mono-latin.woff2','font/woff2'],'/fonts/OFL-Geist.txt':['web/fonts/OFL-Geist.txt','text/plain'],'/fonts/OFL-Geist-Mono.txt':['web/fonts/OFL-Geist-Mono.txt','text/plain']},asset=assets[url.pathname];
   if(req.method!=='GET'||!asset){reply(404,{error:'Страница не найдена.'});return;}
   // A native reload reaches the local HTML endpoint before scripts and styles finish loading.
   if(url.pathname==='/' && req.headers['sec-fetch-dest']==='document' &&
      (req.headers.cookie||'').split(';').some(v=>v.trim()===`${cookie}=${token}`)){
    navigationDeadline=Date.now()+disconnectGraceMs;
    for(const [id,tab] of tabs)if(!tab.stream)expireTab(id,tab,disconnectGraceMs);
   }
   res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':asset[1]==='font/woff2'?'public, max-age=86400':'no-store'});res.end(await readFile(fileURLToPath(new URL(asset[0],import.meta.url))));
  }catch(error){if(!res.headersSent)reply(400,{error:error.message});else res.end();}
 });
 const heartbeat=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');state.questions=state.questions.filter(q=>!q.expires||q.expires>Date.now());},15000);heartbeat.unref();
 async function close(){if(disposed)return;disposed=true;for(const tab of tabs.values())clearTimeout(tab.timer);tabs.clear();generation++;unsub?.();unsubBilling?.();if(voiceOwned)voice?.cancel();clearInterval(heartbeat);clearTimeout(publishTimer);for(const client of clients)client.end();clients.clear();server.close();server.closeIdleConnections?.();await rpc?.dispose();}
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
 return {url:origin+'/#'+token,origin,browserReady,async close(){confirmBrowser(false);await close();},get closed(){return disposed;}};
}

