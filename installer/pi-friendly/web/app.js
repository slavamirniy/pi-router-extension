const $=id=>document.getElementById(id);
const paths={back:'M19 12H5M11 6l-6 6 6 6',search:'M10 3a7 7 0 100 14 7 7 0 000-14M15 15l6 6',new:'M12 5v14M5 12h14',projects:'M3 7h7l2 2h9v11H3zM3 7V4h7l2 3',models:'M8 4h8v16H8zM4 8h16M4 16h16',theme:'M20 14A8 8 0 0110 4a8 8 0 1010 10',mic:'M9 5a3 3 0 016 0v7a3 3 0 01-6 0zM5 11v1a7 7 0 0014 0v-1M12 19v3M8 22h8',exit:'M9 3H3v18h6M9 12h12M17 8l4 4-4 4',chat:'M3 4h18v13H8l-5 4z',arrow:'M9 5l7 7-7 7',stop:'M7 7h10v10H7z',folder:'M3 7h7l2 2h9v11H3zM3 7V4h7l2 3',folderUp:'M10 9l4-4 4 4M14 5v8',copy:'M8 8h12v12H8zM4 16V4h12',attach:'M20 11l-8 8a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8'};
function icon(name){const e=document.createElementNS('http://www.w3.org/2000/svg','svg');e.setAttribute('viewBox','0 0 24 24');e.setAttribute('aria-hidden','true');const p=document.createElementNS(e.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.chat);e.append(p);return e;}
function el(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
function button(text,run,cls){const e=el('button',text,cls);e.type='button';e.onclick=()=>task(run);return e;}
for(const b of document.querySelectorAll('[data-nav]')){const t=b.textContent;b.setAttribute('aria-label',t);b.title=t;b.replaceChildren(icon(b.dataset.nav),el('span',t,'nav-text'));b.onclick=()=>task(()=>navigate(b.dataset.nav));}
$('theme').replaceChildren(icon('theme'),el('span','Тёмная тема','nav-text'));
$('exit').setAttribute('aria-label','Выйти');$('exit').replaceChildren(icon('exit'),el('span','Выйти'));
const brand=document.querySelector('.brand');brand.childNodes.forEach(n=>{if(n.nodeType===3&&n.textContent.trim()){const span=el('span',n.textContent,'brand-name');n.replaceWith(span);}});brand.onclick=e=>{e.preventDefault();task(()=>navigate('projects'));};
let renderedMessages;
let page='projects',projectId=null,catalog=[],modelList=[],state={},source,connected=false,working=false,lastChat,questionId,dictationId,searchValue='',searchOpen=false,operationLabel='',uploading=false;
const draftKey=id=>'pf-draft-'+(id||'new');
function saved(id){try{return localStorage.getItem(draftKey(id))||'';}catch{return '';}}
function store(id,text){try{localStorage.setItem(draftKey(id),text);}catch{}}
function showError(text){if($('error-text').textContent!==(text||''))$('error').open=false;$('error-text').textContent=text||'';$('error').hidden=!text;}
async function api(path,data){const res=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const value=await res.json();if(!res.ok)throw new Error(value.error||'Не удалось выполнить действие.');return value;}
let hintTimer;function showHint(text){clearTimeout(hintTimer);$('ui-hint').textContent=text;$('ui-hint').hidden=!text;hintTimer=setTimeout(()=>$('ui-hint').hidden=true,6000);}
async function task(fn){try{await fn();}catch(error){showHint(error.message);} }
function canSwitch(){if(working||uploading||state.busy||state.loading||['starting','recording','transcribing'].includes(state.voice?.phase))throw new Error('Дождитесь завершения действия или остановите ответ.');}
async function loadCatalog(){catalog=(await api('catalog')).projects;}
function navigate(next){return task(async()=>{if(working||state.loading)return;store(state.active?.id,$('draft').value);searchValue='';searchOpen=false;
 if(next==='new'){canSwitch();if(state.active?.projectId){await openAction('new-chat',{project:state.active.projectId});return;}next='projects';}
 if(next==='projects'){working=true;operationLabel='Загружаю проекты…';renderStatus();try{await loadCatalog();projectId=null;}finally{working=false;renderStatus();}}
 if(next==='models'){if(!state.active||state.active.readOnly)throw new Error('Сначала откройте или создайте чат в проекте.');modelList=(await api('models')).models;}
 page=next;renderRoute();
});}
async function openAction(action,data){canSwitch();working=true;operationLabel=action==='create-project'?'Создаю проект…':action==='new-chat'?'Создаю разговор…':'Открываю разговор…';renderStatus();try{const next=await api(action,data);applyState(next);page='chat';renderRoute();await loadCatalog();}finally{working=false;renderStatus();}}
function plural(n,one,few,many){const mod=n%100;return n+' '+(mod>=11&&mod<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many);}
function titleForPage(){return page==='projects'?'Ваши проекты':page==='create'?'Новый проект':page==='models'?'Выбор модели':page==='chats'?catalog.find(p=>p.id===projectId)?.name||'Разговоры':state.active?.projectName||'Разговор';}
function renderRoute(){
 $('page').hidden=page==='chat';$('chat').hidden=page!=='chat';$('breadcrumb').textContent=titleForPage();
 for(const b of document.querySelectorAll('[data-nav]'))b.classList.toggle('active',b.dataset.nav==='projects'&&['projects','chats','create'].includes(page)||b.dataset.nav===page);
 const returning=page!=='chat'&&Boolean(state.active);
 $('new-chat').classList.toggle('returning',returning);
 $('new-chat').replaceChildren(icon(returning?'back':'new'),el('span',returning?'Вернуться к чату':'Новый разговор','nav-text'));
 $('new-chat').title=returning?'Вернуться к чату':'Новый разговор';
 $('new-chat').setAttribute('aria-label',$('new-chat').querySelector('.nav-text').textContent);
 $('new-chat').onclick=()=>task(()=>page!=='chat'&&state.active?(page='chat',renderRoute()):navigate('new'));
 if(page==='chat'){renderedMessages=undefined;renderMessages();renderStatus();autoGrow();return;}
 const root=el('div',null,'page-inner');$('page').replaceChildren(root);
 if(page==='create'){
  root.classList.add('new-project');root.append(button('← Все проекты',()=>navigate('projects'),'back'),el('h1','Новый проект'),el('p','Дайте задаче понятное название. Для её файлов будет создана отдельная папка.','intro'));
  const form=el('form'),label=el('label','Название проекта'),input=el('input');input.id='project-name';label.htmlFor=input.id;input.placeholder='Например, сайт пекарни';input.maxLength=60;input.required=true;input.autocomplete='off';const error=el('div','','form-error');error.setAttribute('role','alert');
  const submit=el('button','Создать проект','primary');submit.type='submit';const actions=el('div',null,'form-actions');actions.append(submit,button('Отмена',()=>navigate('projects')));
  form.append(label,input,error,actions);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await openAction('create-project',{name:input.value});}catch(err){error.textContent=err.message;}finally{submit.disabled=false;}};root.append(form);input.focus();return;
 }
 if(page==='chats')root.append(button('← Все проекты',()=>navigate('projects'),'back'));
 root.append(el('h1',titleForPage()),el('p',page==='projects'?'Выберите проект, чтобы продолжить работу.':page==='models'?'Модель можно сменить для текущего разговора.':'Общие файлы проекта, отдельная переписка в каждом чате.','intro'));
 const toolbar=el('div',null,'toolbar'),search=el('input',null,'search');search.type='search';search.placeholder=page==='projects'?'Найти проект…':page==='models'?'Найти модель…':'Найти разговор…';search.setAttribute('aria-label',search.placeholder);search.value=searchValue;search.id='list-search';search.hidden=!searchOpen&&page!=='models';
 const controls=el('div',null,'list-actions');const toggle=button('',()=>{searchOpen=!searchOpen;search.hidden=!searchOpen;toggle.setAttribute('aria-expanded',String(searchOpen));if(searchOpen)search.focus();else{search.value='';renderList();toggle.focus();}},'search-toggle');toggle.setAttribute('aria-controls',search.id);toggle.setAttribute('aria-expanded',String(searchOpen));toggle.replaceChildren(icon('search'));toggle.setAttribute('aria-label','Поиск');toggle.title='Поиск';if(page!=='models')controls.append(toggle);else toolbar.append(search);
 search.onkeydown=e=>{if(e.key==='Escape'&&page!=='models'){e.stopPropagation();if(searchOpen)toggle.click();}};
 if(page==='projects')toolbar.append(button('Выбрать папку на компьютере',openFolderDialog,'attach-folder'));
 if(page==='projects')controls.append(button('Создать проект',()=>{canSwitch();page='create';renderRoute();},'primary'));
 if(page==='chats')controls.append(button('Новый чат',()=>openAction('new-chat',{project:projectId}),'primary'));
 if(page!=='models'){toolbar.append(controls);root.append(toolbar,search);}else root.append(toolbar);const list=el('div',null,'list');root.append(list);
 const renderList=()=>{list.replaceChildren();const q=search.value.toLocaleLowerCase();searchValue=search.value;
  const entries=page==='projects'?catalog:page==='models'?modelList:catalog.find(p=>p.id===projectId)?.chats||[];
  const filtered=entries.filter(e=>(e.name+' '+(e.provider||'')).toLocaleLowerCase().includes(q));
  if(!filtered.length){const empty=el('div',null,'empty');empty.append(el('h2',q?'Ничего не найдено':page==='projects'?'Начните с первого проекта':'Пока нет разговоров'),el('p',q?'Попробуйте другое название.':page==='projects'?'Проект объединяет файлы и разговоры об одной задаче.':'Нажмите «Новый чат», чтобы начать.'));list.append(empty);return;}
  for(const item of filtered){const b=button('',async()=>{
   if(page==='projects'){if(working)return;working=true;operationLabel='Открываю проект…';renderStatus();try{await api('open-project',{project:item.id});projectId=item.id;page='chats';searchValue='';searchOpen=false;renderRoute();}finally{working=false;renderStatus();}}
   else if(page==='models'){canSwitch();await api('model',{chat:state.active.id,id:item.id,provider:item.provider});page='chat';renderRoute();}
   else await openAction('open',{id:item.id});
  },'item');const copy=el('span',null,'copy');copy.append(el('strong',item.name));copy.append(el('small',page==='projects'?plural(item.chats.length,'разговор','разговора','разговоров'):page==='models'?item.provider+(state.active?.model?.id===item.id&&state.active?.model?.provider===item.provider?' · выбрана':''):`${new Date(item.modified).toLocaleDateString('ru-RU')} · ${plural(item.count,'сообщение','сообщения','сообщений')}${item.terminal?' · открыт в консоли':''}`));b.append(icon(page==='projects'?'projects':page==='models'?'models':'chat'),copy,icon('arrow'));list.append(b);}
 };search.oninput=renderList;renderList();
}
/* ---------- Веб-обозреватель папок ---------- */
const folderDialog=$('folder-dialog');
let browserPath='',browserChosen=null,browserRequest=0;
async function browseFolders(path){
 const request=++browserRequest;$('folder-choose').disabled=true;$('browser-status').textContent='Загружаю папки…';
 try{const data=await api('browse-folders'+(path?'?path='+encodeURIComponent(path):''));
 if(request!==browserRequest||!folderDialog.open)return;
 browserPath=data.path;browserChosen=data.path;renderBrowser(data);return data;
 }catch(error){if(request===browserRequest&&folderDialog.open)$('browser-status').textContent=error.message;}
}
function renderBrowser({path,parent,entries}){
 $('folder-path').value=path;$('browser-status').textContent='Откройте нужную папку и нажмите «Выбрать эту папку».';
 const list=$('browser-list');list.replaceChildren();
 const up=button('',()=>task(()=>browseFolders(parent)),'browser-row parent');up.disabled=!parent;up.setAttribute('aria-label','На уровень выше');
 up.append(icon('folderUp'),el('span','На уровень выше','browser-name'));list.append(up);
 for(const entry of entries.filter(entry=>!entry.name.startsWith('.'))){
  const row=button('',()=>task(async()=>{try{await browseFolders(entry.path);}catch(error){showHint(error.message);}}),'browser-row');
  row.append(icon('folder'),el('span',entry.name,'browser-name'));list.append(row);
 }
 if(!entries.length)list.append(el('p','В этой папке нет вложенных папок.','browser-empty'));
 $('folder-choose').disabled=false;
}
function openFolderDialog(){
 return task(async()=>{
  canSwitch();
  browserChosen=null;
  $('folder-choose').disabled=true;
  folderDialog.showModal();
  await browseFolders(browserPath);
 });
}
folderDialog.addEventListener('close',()=>{browserRequest++;browserChosen=null;});
$('folder-path-form').onsubmit=e=>{e.preventDefault();task(()=>browseFolders($('folder-path').value));};
$('folder-home').onclick=()=>task(()=>browseFolders(''));
$('folder-close').onclick=()=>folderDialog.close();
$('folder-cancel').onclick=()=>folderDialog.close();
$('folder-choose').onclick=()=>task(async()=>{
 if(!browserChosen||$('folder-choose').disabled)return;const chosen=browserChosen;folderDialog.close();
 working=true;operationLabel='Подключаю папку…';renderStatus();
 try{const result=await api('attach-project',{path:chosen});if(!result.cancelled){catalog=result.projects;projectId=result.project;page='chats';searchOpen=false;searchValue='';renderRoute();showHint('Папка подключена как проект.');}}finally{working=false;renderStatus();}
});
/* ---------- Загрузка файлов в проект ---------- */
$('attach').replaceChildren(icon('attach'));
$('attach').onclick=()=>{if(!$('attach').disabled)$('file-input').click();};
$('file-input').onchange=()=>task(async()=>{
 const files=[...($('file-input').files||[])];$('file-input').value='';
 if(!files.length)return;
 const project=state.active?.projectId;if(!project)throw new Error('Сначала откройте чат в проекте.');
 const payload=[];for(const f of files){
  if(f.size>50*1024*1024){showHint(`«${f.name}» больше 50 МБ и был пропущен.`);continue;}
  const buf=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<buf.length;i+=0x8000)binary+=String.fromCharCode(...buf.subarray(i,i+0x8000));
  payload.push({name:f.name,content:btoa(binary),truncated:false});
 }
 if(!payload.length)return;
 uploading=true;renderStatus();
 try{const result=await api('upload',{project,files:payload});
  if(result.saved?.length)showHint(result.saved.length===1?`Файл «${result.saved[0]}» сохранён в проекте.`:`Сохранено файлов: ${result.saved.length}.`);
 }finally{uploading=false;renderStatus();}
});
/* ---------- Сообщения ---------- */
function inline(parent,text){const re=/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;let last=0;for(const match of text.matchAll(re)){parent.append(document.createTextNode(text.slice(last,match.index)));const t=match[0];if(t.startsWith('`'))parent.append(el('code',t.slice(1,-1)));else if(t.startsWith('**'))parent.append(el('strong',t.slice(2,-2)));else{const [,name,url]=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);const a=el('a',name);a.href=url;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}last=match.index+t.length;}parent.append(document.createTextNode(text.slice(last)));}
function markdown(parent,text){let code=null;for(const line of text.split('\n')){if(line.startsWith('```')){if(code){parent.append(code);code=null;}else code=el('pre');continue;}if(code){code.textContent+=line+'\n';continue;}if(!line.trim())continue;const heading=/^(#{1,3})\s+(.*)/.exec(line);const node=el(heading?'h3':'p');inline(node,heading?heading[2]:line);parent.append(node);}if(code)parent.append(code);}
const expandedDetails=new Map();
function disclosure(key,label,body,cls){const box=el('details',null,cls);box.open=expandedDetails.get(key)||false;box.append(el('summary',label),body);box.ontoggle=()=>expandedDetails.set(key,box.open);return box;}
function copyButton(text,label='Копировать'){const b=el('button',null,'copy-btn');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.replaceChildren(icon('copy'));b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.classList.add('copied');b.title='Скопировано';setTimeout(()=>{b.classList.remove('copied');b.title=label;},1500);}catch{showHint('Не удалось скопировать.');}};return b;}
function renderMessages(){if(page!=='chat')return;const signature=JSON.stringify([state.messages||[],Boolean(state.busy)]);if(signature===renderedMessages)return;renderedMessages=signature;const area=$('messages'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<120,oldTop=area.scrollTop;const frag=document.createDocumentFragment();
 (state.messages||[]).forEach((m,i)=>{
  if(!m.text&&!m.thinking&&!m.tools?.length&&!m.error&&m.status!=='streaming')return;
  const key=(state.active?.id||'')+':'+i,user=m.role==='user';
  const row=el('article',null,'message '+(user?'user':'assistant'));
  if(user){
   const body=el('div',null,'user-bubble');markdown(body,m.text||'');row.append(body);
  }else{
   row.append(el('div','π','assistant-mark'));
   const content=el('div',null,'assistant-body');
   if(m.thinking){const body=el('div',null,'reasoning-text');markdown(body,m.thinking);content.append(disclosure(key+':thinking',m.status==='streaming'&&!m.text?'Размышляет…':'Размышления',body,'reasoning'));}
   const text=el('div',null,'answer');markdown(text,m.text||'');content.append(text);
   if(m.status==='streaming'&&!m.text&&!m.thinking&&!m.tools?.length)content.append(el('p','Готовлю ответ…','stream-label generating-message'));
   const statusLabels={pending:'Подготовка',running:'Выполняется',done:'Готово',error:'Ошибка',stopped:'Остановлено'};
   for(const t of m.tools||[]){const status=t.status||'pending',body=el('div',null,'tool-detail');if(t.path)body.append(el('p',t.path,'file-path'));if(t.command)body.append(el('pre',t.command));if(t.output)body.append(el('pre',t.output));if(!body.childNodes.length)body.append(el('p',status==='running'?'Ожидаю результат…':status==='error'?'Действие завершилось с ошибкой.':'Дополнительных сведений нет.'));const label=status==='done'?t.label.replace('Создаю файл','Файл записан').replace('Обновляю файл','Файл изменён').replace('Читаю файл','Файл прочитан'):t.label;content.append(disclosure(key+':'+t.id,`${label} · ${statusLabels[status]}`,body,'tool-card '+status));}
   if(m.error&&!state.busy&&!state.messages.slice(i+1).some(n=>n.role==='assistant'&&!n.error&&(n.text||n.tools?.length))){content.append(disclosure(key+':error','Не удалось получить ответ · Подробнее',el('pre',m.error),'message-error'));}
   if(m.status==='stopped')content.append(el('p','Ответ прерван. Полученная часть сохранена.','stream-label'));
   if(m.retained)content.append(el('p','Сохранённый фрагмент: сервис не вернул его в итоговой истории.','stream-label'));
   if(m.versions?.length){const body=el('div');for(const v of m.versions)body.append(el('pre',v.text||v.thinking));content.append(disclosure(key+':versions','Предыдущий фрагмент ответа · сервис заменил текст',body,'reasoning'));}
   const foot=el('div',null,'assistant-foot');
   if(m.usage?.output>0)foot.append(el('span',`${m.usage.output.toLocaleString('ru-RU')} токенов`,'token-count'));
   if(m.status!=='streaming'&&m.text)foot.append(copyButton(m.text,'Копировать ответ'));
   if(foot.childNodes.length)content.append(foot);
   row.append(content);
  }
  frag.append(row);
 });
 if(!frag.childNodes.length){const welcome=el('div',null,'empty chat-empty');welcome.append(el('div','π','welcome-mark'),el('h2','Чем могу помочь?'),el('p','Опишите задачу своими словами — файлы появятся в папке проекта.'));frag.append(welcome);}area.replaceChildren(frag);area.scrollTop=nearBottom?area.scrollHeight:oldTop;
}
function renderQuestion(){const q=(state.questions||[]).find(q=>!q.expires||q.expires>Date.now());if(q?.id===questionId)return;questionId=q?.id;$('question').replaceChildren();if(!q)return;
 const box=el('div',null,'question');box.append(el('h2',q.title||'Нужен ваш ответ'));if(q.message)box.append(el('p',q.message));const actions=el('div',null,'question-actions');const answer=data=>api('answer',{chat:state.active?.id,id:q.id,...data});
 if(q.method==='select')for(const option of q.options||[])actions.append(button(option,()=>answer({value:option})));
 else if(q.method==='confirm')actions.append(button('Да',()=>answer({confirmed:true}),'primary'),button('Нет',()=>answer({confirmed:false})));
 else{const input=el(q.method==='editor'?'textarea':'input');input.value=q.prefill||'';input.placeholder=q.placeholder||'';input.setAttribute('aria-label',q.title||'Ответ');box.append(input);actions.append(button('Продолжить',()=>answer({value:input.value}),'primary'));}
 actions.append(button('Отмена',()=>answer({cancelled:true})));box.append(actions);$('question').append(box);
}
function renderStatus(){
 const navigating=working||state.loading;$('navigation-loading').hidden=!navigating;$('navigation-loading').textContent=navigating?(operationLabel||'Открываю разговор…'):'';$('page').inert=Boolean(navigating);$('page').setAttribute('aria-busy',String(Boolean(navigating)));
 $('activity').classList.toggle('generating',Boolean(state.busy));const busy=working||state.loading||state.busy,v=state.voice,record=['starting','recording','transcribing'].includes(v?.phase);$('exit').disabled=Boolean(busy||record);
 $('send').disabled=!connected||working||state.loading||record||uploading||state.active?.readOnly||(!state.busy&&!$('draft').value.trim());
 $('send').textContent=state.busy?'■':'↑';$('send').title=state.busy?'Остановить ответ (Esc)':'Отправить (Enter)';$('send').classList.toggle('stop',Boolean(state.busy));
 $('draft').disabled=Boolean(state.active?.readOnly||!connected);$('readonly').hidden=!state.active?.readOnly;
 $('attach').hidden=!(page==='chat'&&state.active&&!state.active.readOnly);$('attach').disabled=!connected||busy||record;
 $('mic').disabled=!connected||!state.active||state.active.readOnly||working||state.loading||state.busy||uploading||v?.phase==='transcribing';$('mic').replaceChildren(icon(v?.phase==='recording'?'stop':'mic'));$('mic').setAttribute('aria-label',v?.phase==='recording'?'Закончить запись':'Начать диктовку');
 $('activity').textContent=uploading?'Загружаю файлы в проект…':working||state.loading?(operationLabel||'Открываю разговор…'):state.busy?(state.messages?.flatMap(m=>m.tools||[]).findLast(t=>t.status==='running')?.label||((state.messages?.at(-1)?.thinking&&!state.messages?.at(-1)?.text)?'Размышляет…':'Пишет ответ…')):state.questions?.length?'Нужен ваш ответ':'';
 $('voice-view').hidden=!record;$('draft').style.visibility=record?'hidden':'visible';
 if(record){$('voice-label').textContent=v.phase==='recording'?`${Math.floor((v.seconds||0)/60)}:${String((v.seconds||0)%60).padStart(2,'0')} · Enter — закончить`:v.phase==='transcribing'?`Распознаю · ${Math.round(v.percent||0)}%`:'Включаю микрофон…';drawWave(v.levels||[]);}
 const setup=$('voice-setup');setup.replaceChildren();if(v&&['installing','downloading','loading','error'].includes(v.phase)){setup.append(el('span',v.phase==='error'?'Голос не загрузился':v.label||'Подготовка голоса'));if(Number.isFinite(v.percent)){setup.append(el('span',` · ${Math.round(v.percent)}%`));const p=el('progress');p.max=100;p.value=v.percent;setup.append(p);}}
 const widgetLines=Object.values(state.widgets||{}).flat();$('widgets').hidden=!widgetLines.length;$('widget-content').replaceChildren(...widgetLines.map(line=>el('div',line)));
 $('model-foot').textContent=state.active?.model?.name||'Локальный интерфейс pi';$('quota').textContent=Object.values(state.statuses||{}).join('\n');
 $('notice').textContent=state.notice||'';$('notice').hidden=!state.notice;renderQuestion();
}
function drawWave(levels){const canvas=$('wave'),width=canvas.clientWidth;if(!width)return;canvas.width=width*devicePixelRatio;canvas.height=42*devicePixelRatio;const ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent');const count=Math.floor(width/5),samples=levels.slice(-count);for(let i=0;i<count;i++){const value=samples[i-(count-samples.length)]||0,h=Math.max(2,Math.pow(value,.7)*34);ctx.fillRect(i*5,21-h/2,2,h);}}
function applyState(next){const previous=state.active?.id;state=next;
 if(previous!==state.active?.id){store(previous,$('draft').value);$('draft').value=saved(state.active?.id);questionId=undefined;}
 if(state.dictation&&state.dictation.id!==dictationId&&saved('dictation-'+state.dictation.chat)!==state.dictation.id){dictationId=state.dictation.id;store('dictation-'+state.dictation.chat,dictationId);const d=state.dictation,old=d.chat===state.active?.id?$('draft').value:saved(d.chat),text=d.replace?d.text:old+(old?' ':'')+d.text;store(d.chat,text);if(d.chat===state.active?.id)$('draft').value=text;}
 if(state.error&&!state.messages?.some(m=>m.error===state.error))showError(state.error);else if(!state.error||state.messages?.some(m=>m.error===state.error))showError('');if(state.active&&!lastChat){lastChat=state.active.id;page='chat';renderRoute();}renderMessages();renderStatus();
}
function autoGrow(){const area=$('draft');area.style.height='auto';area.style.height=Math.min(area.scrollHeight,230)+'px';}
$('draft').oninput=()=>{store(state.active?.id,$('draft').value);renderStatus();autoGrow();};
$('draft').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(state.voice?.phase==='recording'){e.stopPropagation();task(()=>api('voice',{chat:state.active?.id}));}else if(!state.busy)$('composer').requestSubmit();}};
$('composer').onsubmit=e=>{e.preventDefault();task(async()=>{if(state.busy){await api('abort',{chat:state.active.id});return;}if(!state.active){await navigate('projects');return;}const text=$('draft').value,chat=state.active.id;if(!text.trim())return;$('draft').value='';store(chat,'');autoGrow();renderStatus();try{await api('prompt',{chat,text});showError('');}catch(error){if(!saved(chat)){store(chat,text);if(state.active?.id===chat&&!$('draft').value)$('draft').value=text;}throw error;}finally{autoGrow();renderStatus();}});};
$('mic').onclick=()=>task(async()=>{if(['installing','downloading','loading'].includes(state.voice?.phase)){$('voice-setup').classList.add('highlight');setTimeout(()=>$('voice-setup').classList.remove('highlight'),2500);throw new Error('← Для голосового ввода дождитесь загрузки голосовой модели.');}await api('voice',{chat:state.active?.id});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.busy&&!$('draft').value&&!state.questions?.length){task(()=>api('abort',{chat:state.active.id}));return;}if(e.key==='Enter'&&!e.isComposing&&state.voice?.phase==='recording'){e.preventDefault();task(()=>api('voice',{chat:state.active?.id}));}});
function theme(value){document.documentElement.dataset.theme=value;try{localStorage.setItem('pf-theme',value);}catch{}$('theme').querySelector('.nav-text').textContent=value==='dark'?'Светлая тема':'Тёмная тема';$('theme').setAttribute('aria-label',$('theme').querySelector('.nav-text').textContent);}
try{theme(localStorage.getItem('pf-theme')||'light');}catch{theme('light');}$('theme').onclick=()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark');
$('exit').onclick=()=>{if(!$('exit').disabled)$('exit-dialog').showModal();};$('cancel-exit').onclick=()=>$('exit-dialog').close();$('confirm-exit').onclick=()=>task(async()=>{await api('close',{});source?.close();connected=false;$('exit-dialog').close();$('connection').textContent='Веб-интерфейс закрыт';renderStatus();showHint('Работа завершена. pi закрыт. Если вкладка осталась открытой, закройте её вручную.');window.close();});
window.addEventListener('beforeunload',()=>store(state.active?.id,$('draft').value));
await task(async()=>{const token=location.hash.slice(1);if(token){await api('auth',{token});history.replaceState(null,'',location.pathname);}await loadCatalog();renderRoute();source=new EventSource('/api/events');source.onopen=()=>{connected=true;$('connection').textContent='На этом компьютере';renderStatus();};source.onmessage=e=>applyState(JSON.parse(e.data));source.onerror=()=>{connected=false;$('connection').textContent='Соединение прервано';renderStatus();};});
