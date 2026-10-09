import {appendDictation} from './voice.mjs';
import {requestExit,createExitDialog} from './exit-dialog.mjs';
import { createMenu, clean, mouseEvent } from "./menu.mjs";
import { createWorkspace } from "./workspace.mjs";
import { startActivity, finishActivity } from "./activity.mjs";
import { wrapText, explainError } from "./errors.mjs";
import { createProjectForm } from "./project-form.mjs";
import { projectCatalog } from "./projects.mjs";
import { palettes } from "./surface.mjs";

export function groupProjects(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const cwd = session.cwd || "Проект не указан";
    if (!groups.has(cwd)) groups.set(cwd, []);
    groups.get(cwd).push(session);
  }
  return [...groups].map(([cwd, items]) => ({ cwd, items: items.sort((a, b) => +new Date(b.modified) - +new Date(a.modified)) }));
}

export function installFriendly(pi, rendering) {
  let view = { scheme: rendering.loadPrefs?.()?.scheme === "dark" ? "dark" : "light", live: undefined, notice: "", activity: "" };
  const widgets = new Map();
  const projects=rendering.projects; let pendingDraft,voice,voiceContext,voiceHintTimer;
  const currentFolder=ctx=>ctx.sessionManager?.getCwd?.()||ctx.cwd;
  const hasProject=ctx=>!projects||(projects.isProject?.(currentFolder(ctx))??!projects.isHub(currentFolder(ctx)));
  let restoreUI = () => {}, noticeTimer;
  let opened = false, footerData, activeMenu, startupTimer, stopped = false, workspace, footerRows = 1;
  pi.registerFlag("friendly-no-welcome", { description: "Не открывать стартовое меню Просто pi", type: "boolean", default: false });
  pi.registerFlag("friendly-keep-footer", { description: "Сохранить footer другого расширения (без кликабельных slash-подсказок)", type: "boolean", default: false });
  const statuses = () => [...(footerData?.getExtensionStatuses().values() ?? [])].filter(Boolean);
  const modelLabel = ctx => clean(ctx.model?.name || ctx.model?.id || "Модель не выбрана");
  const notifyError = (ctx, error) => { if (!stopped) ctx.ui.notify(`Не удалось выполнить действие: ${clean(error?.message ?? error)}`, "error"); };
  const safe = (ctx, fn) => async () => { try { await fn(); } catch (error) { notifyError(ctx, error); } };

  async function choose(ctx, title, items, searchable = false, subtitle = "", form = false, bottom = false) {
    return ctx.ui.custom((tui, theme, _keys, done) => {
      let lastFrame;
      const finish=value=>{if((value?.navigation||value?.session||value?.id==='new'||value?.id==='current')&&lastFrame)workspace?.holdFrame(lastFrame);done(value);};
      const inner = form ? createProjectForm({...rendering,tui,done:finish,palette:palettes[view.scheme]}) : createMenu({ ...rendering, tui, theme, done:finish, title, subtitle, items, searchable, bottom, panel: Boolean(workspace), palette: rendering.makeEditor ? palettes[view.scheme] : undefined, statuses: () => [modelLabel(ctx), ...statuses()] });
      activeMenu = !workspace ? inner : {
        invalidate: () => inner.invalidate(), dispose: () => inner.dispose(),
        render(width) {
          const side=width>=100?26:18;
          const background=workspace.renderSurface(width), pane=inner.render(width-side);
          lastFrame=pane.map((row,i)=>rendering.truncate(background[i]||'',side,'')+row);workspace.clearHeldFrame();return lastFrame;
        },
        handleInput(data) {
          const mouse=mouseEvent(data),side=tui.terminal.columns>=100?26:18;
          if(mouse && mouse.x<side){
            if(mouse.press&&mouse.button===0){
              if(tui.terminal.rows>=18&&mouse.y>=4&&mouse.y<7){inner.handleInput("\x1b");return;}
              const release=workspace.holdFrame(lastFrame);inner.handleInput("\x1b");
              setTimeout(async()=>{try{await workspace?.sidebarNavigate(data);}finally{release();}},0);
            }
            return;
          }
          inner.handleInput(mouse ? `\x1b[<${mouse.button};${mouse.x-side+1};${mouse.y+1}${mouse.press?'M':'m'}` : data);
        },
      };
      return activeMenu;
    }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 } });
  }
  async function dialog(ctx, fn) {
    if (ctx.mode !== "tui" || opened || stopped) return;
    opened = true;
    try { return await fn(); }
    finally { activeMenu?.dispose(); activeMenu = undefined; opened = false; }
  }
  async function command(ctx, text) {
    if (!ctx.isIdle()) { ctx.ui.notify("Сначала дождитесь ответа или нажмите «Остановить».", "info"); return; }
    const draft = ctx.ui.getEditorText();
    if (draft.trim() && !await ctx.ui.confirm("Открыть действие?", "Текст в поле ввода будет заменён. Отмените, чтобы сначала отправить или сохранить его.")) return;
    ctx.ui.setEditorText(text);
    if (workspace) workspace.submit();
    else ctx.ui.notify("Нажмите Enter, чтобы выполнить команду.", "info");
  }
  async function selectModel(ctx) {
    if (!ctx.isIdle()) { ctx.ui.notify("Модель можно сменить после завершения ответа.", "info"); return; }
    const models = ctx.modelRegistry.getAvailable();
    if (!models.length) { ctx.ui.notify("Нет доступных моделей. Добавьте подключение через /login.", "warning"); return; }
    const selected = await dialog(ctx, () => choose(ctx, "Выберите модель", models.map(model => ({ model, label: model.name || model.id, description: `${model.provider} / ${model.id}` })), true));
    if (selected && !await pi.setModel(selected.model)) ctx.ui.notify("Модель недоступна: проверьте подключение.", "warning");
  }
  async function switchChat(ctx,path){
    const draft=pendingDraft??ctx.ui.getEditorText();pendingDraft=undefined;
    if(ctx.switchSession){
      try {
        const result=await ctx.switchSession(path,{withSession:async fresh=>{if(draft)fresh.ui.setEditorText(draft);}});
        if(result?.cancelled&&draft)ctx.ui.setEditorText(draft);
      } catch(error) {if(draft){try{ctx.ui.setEditorText(draft);}catch{}}throw error;}
    }else{
      pendingDraft=draft;
      if(!workspace)throw new Error('Окно чата ещё не готово. Попробуйте снова.');
      try{await workspace.executeCommand('/friendly open '+encodeURIComponent(path));}
      finally{workspace?.clearHeldFrame();workspace?.redraw();}
    }
  }
  async function startChat(ctx,cwd){
    if(!ctx.isIdle()){ctx.ui.notify('Сначала остановите текущую работу.','info');return;}
    if(!projects){await command(ctx,'/new');return;}
    await switchChat(ctx,projects.createChat(cwd));
  }
  async function createProject(ctx,onBack){
    const name=await dialog(ctx,()=>choose(ctx,'Новый проект',[],false,'',true));
    if(name?.back){await onBack?.();return;}
    if(!name?.trim())return;
    const project=projects.create(name);await startChat(ctx,project.cwd);
  }
  async function newConversation(ctx){
    if(!ctx.isIdle()){ctx.ui.notify('Сначала остановите текущую работу.','info');return;}
    if(!projects){await command(ctx,'/new');return;}
    const current=hasProject(ctx);
    const choice=await dialog(ctx,()=>choose(ctx,current?'Новый разговор':'Сначала выберите проект',[
      ...(current?[{id:'current',label:'В проекте «'+projects.name(currentFolder(ctx))+'»',description:'Те же файлы · новая переписка'}]:[]),
      {id:'create',navigation:true,kind:'primary',label:'Новый проект',description:'Отдельная папка для новой задачи'},
      {id:'projects',label:'Выбрать проект',description:'Открыть существующий проект и его чаты'},
    ],false,current?'Чаты и файлы сохранятся. Черновик — в новый чат.':'Каждый проект — отдельная папка. Ваш текст сохранён.',false,true));
    if(choice?.id==='current')await startChat(ctx,currentFolder(ctx));
    if(choice?.id==='create')await createProject(ctx,()=>newConversation(ctx));
    if(choice?.id==='projects')await history(ctx);
  }
  async function history(ctx){
    if(!ctx.isIdle()){ctx.ui.notify('Сначала остановите текущую работу.','info');return;}
    const choice=await dialog(ctx,async()=>{
      const sessions=await rendering.listSessions();
      if(!projects){return choose(ctx,'История разговоров',sessions.map(session=>({session,label:session.name||clean(session.firstMessage)||'Без названия',description:session.cwd})),true);}
      const catalog=projectCatalog(sessions,projects.list(),projects.isHub(currentFolder(ctx))?undefined:currentFolder(ctx));
      let project;
      while(!stopped){
        if(!project){
          const picked=await choose(ctx,'Проекты',[
            {id:'create',navigation:true,kind:'primary',label:'+ Новый проект',description:'Создать проект с отдельной папкой'},
            ...catalog.map(p=>({project:p,navigation:true,label:projects.isHub(p.cwd)?'Старые чаты':p.name,description:p.chats.length+' чатов · открыть список чатов'})),
          ],true,'Шаг 1 из 2 · выберите проект');
          if(!picked||picked.id==='create')return picked;
          project=picked.project;
        }
        const name=projects.isHub(project.cwd)?'Старые чаты':project.name;
        const picked=await choose(ctx,name,[
          {id:'back',navigation:true,kind:'back',label:'← Все проекты',description:'Выбрать другой проект'},
          ...((projects.isProject?.(project.cwd)??!projects.isHub(project.cwd))?[{id:'new',kind:'primary',project,label:'+ Новый чат',description:'Начать разговор в этом проекте'}]:[]),
          ...project.chats.map(session=>({session,label:session.name||(session.messageCount?clean(session.firstMessage).slice(0,80):'Новый разговор'),description:new Date(session.modified).toLocaleDateString('ru-RU')+' · сообщений: '+(session.messageCount??0)})),
        ],true,'Шаг 2 из 2 · '+(project.chats.length?'выберите чат':'чатов пока нет — создайте первый'));
        if(picked?.id==='back'){project=undefined;continue;}
        return picked;
      }
    });
    if(choice?.id==='create')await createProject(ctx,()=>history(ctx));
    else if(choice?.session)await switchChat(ctx,choice.session.path);
    else if(choice?.id==='new')await startChat(ctx,choice.project.cwd);
  }

  async function commands(ctx) {
    const selected = await dialog(ctx, async () => {
      let item = await choose(ctx, "Частые команды", [
        { label: "Новый разговор", command: "/friendly new" },
        { label: "История разговоров", command: "/friendly history" },
        { label: "Выбрать модель", command: "/model" },
        { label: "Скопировать ответ", command: "/copy" },
        { label: "Настройки", command: "/settings" },
        { label: "Сжать длинный разговор", command: "/compact" },
        { label: "Другие команды", id: "all", description: "Полный список и поиск" },
      ], true, "Полезные действия без запоминания slash-команд");
      if (item?.id === "all") {
        const all = await workspace?.getCommands() ?? pi.getCommands().map(c => ({ value: c.name, label: c.name, description: c.description }));
        item = await choose(ctx, "Другие команды", all.map(c => ({ label: "/" + c.value.replace(/^\//, ""), description: c.description, command: "/" + c.value.replace(/^\//, "") })), true);
      }
      return item;
    });
    if (selected?.command) await command(ctx, selected.command);
  }
  async function more(ctx) {
    const item = await dialog(ctx, () => choose(ctx, "Действия", [
      {label: "Модель", id:"model"}, {label:"История",id:"history"},
      {label:"Сменить тему",id:"theme"}, {label:"Меню",id:"menu"},
    ], true));
    if(item?.id === "model") await selectModel(ctx);
    if(item?.id === "history") await command(ctx,"/friendly history");
    if(item?.id === "menu") await menu(ctx);
    if(item?.id === "theme") changeTheme(ctx);
  }
  function changeTheme(ctx) {
    view.scheme = view.scheme === "light" ? "dark" : "light";
    ctx.ui.setTheme?.(view.scheme);
    rendering.savePrefs?.({scheme:view.scheme}); workspace?.redraw();
  }
  async function menu(ctx) {
    const active = Boolean(ctx.ui.getEditorText().trim() || ctx.sessionManager?.getEntries().some(entry => entry.type === "message"));
    const action = await dialog(ctx, () => choose(ctx, "Просто pi", [
      { id: "new", label: "Новый разговор", description: "Начать с чистого листа" },
      { id: "history", label: "Проекты и чаты", description: "Открыть проект или любой разговор" },
      ...(active ? [{ id: "chat", label: "Продолжить разговор", description: "Вернуться к текущей задаче" }] : []),
    ], false, "С чего начнём?"));
    if (action?.id === "new") await newConversation(ctx);
    if (action?.id === "history") await command(ctx, "/friendly history");
  }
  pi.registerCommand("friendly", { description: "Новый разговор и история по проектам", handler: async (args, ctx) => safe(ctx, () => args.startsWith("open ") ? switchChat(ctx,decodeURIComponent(args.slice(5))) : args.trim()==="new" ? newConversation(ctx) : args.trim() === "history" ? history(ctx) : args.trim() === "commands" ? commands(ctx) : menu(ctx))() });
  pi.registerShortcut("f2", { description: "Открыть меню Просто pi", handler: ctx => safe(ctx, () => menu(ctx))() });
  pi.on("input",(event,ctx)=>{
    if(ctx.mode!=="tui"||hasProject(ctx))return;
    ctx.ui.setEditorText(event.text);
    clearTimeout(startupTimer);
    startupTimer=setTimeout(()=>{if(!stopped)void safe(ctx,()=>newConversation(ctx))();},0);
    return {action:"handled"};
  });
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    restoreUI(); clearTimeout(noticeTimer);
    voice?.cancel();voiceContext=ctx;clearTimeout(voiceHintTimer);view.voiceHintUntil=0;
    if(!voice&&rendering.createVoice){
      voice=rendering.createVoice({
        onState:state=>{view.voice=state;if(state.phase==='ready'){clearTimeout(voiceHintTimer);view.voiceHintUntil=0;}workspace?.redraw();},
        onError:message=>{if(voiceContext&&!stopped)voiceContext.ui.notify(message,'warning');},
        onText:(text,context)=>{
          if(stopped||context!==voiceContext)return;
          if(text.trim())context.ui.setEditorText(appendDictation(context.ui.getEditorText(),text));
          else context.ui.notify('Речь не распознана. Попробуйте говорить ближе к микрофону.','info');
          workspace?.redraw();
        },
      });
      view.voice=voice.state;void voice.start();
    }
    view.live = undefined; view.notice = ""; view.activity = ""; view.error = undefined; view.steps=[]; view.running=false;
    stopped = false;
    ctx.ui.setToolsExpanded(false);
    ctx.ui.setTheme?.(view.scheme);
    const ui=ctx.ui, originalWidget=ui.setWidget, originalNotify=ui.notify;
    const widgetBridge=(key,content,options)=>{
      if(typeof content === "function") originalWidget.call(ui,key,(...args)=>{const component=content(...args);widgets.set(key,component);return component;},options);
      else {if(content)widgets.set(key,content);else widgets.delete(key);originalWidget.call(ui,key,content,options);}
      workspace?.redraw();
    };
    const noticeBridge=(message,type)=>{view.notice=type==="error"?"":clean(message);if(type==="error")view.error={raw:clean(message)};clearTimeout(noticeTimer);if(type!=="error")noticeTimer=setTimeout(()=>{view.notice="";workspace?.redraw();},6000);originalNotify.call(ui,message,type);workspace?.redraw();};
    ui.setWidget=widgetBridge;ui.notify=noticeBridge;
    restoreUI=()=>{if(ui.setWidget===widgetBridge)ui.setWidget=originalWidget;if(ui.notify===noticeBridge)ui.notify=originalNotify;};
    ctx.ui.setHeader(() => ({ render: () => ["", ""], invalidate() {} }));
    if (!pi.getFlag("friendly-keep-footer")) ctx.ui.setFooter((_tui, theme, data) => {
      footerData = data;
      return { render(width) {
        const rows = [theme.fg("muted", modelLabel(ctx)), ...statuses()].map(row => rendering.truncate(row, width, ""));
        footerRows = rows.length; return rows;
      }, invalidate() {} };
    });
    if (rendering.makeEditor && ctx.ui.setEditorComponent) {
      const previousFactory = ctx.ui.getEditorComponent();
      ctx.ui.setEditorComponent((tui, editorTheme, keys) => {
        workspace?.dispose();
        const delegate = previousFactory ? previousFactory(tui, editorTheme, keys) : rendering.makeEditor(tui, editorTheme, keys);
        workspace = createWorkspace({ delegate, tui, theme: ctx.ui.theme, rendering, ctx,
          cleanView: true, viewState: () => ({...view, paneOpen:opened, projectName:hasProject(ctx)?projects?.name(currentFolder(ctx)):undefined, needsProject:!hasProject(ctx), widgets:[...widgets.values()], statuses:statuses()}),
          footerHeight: () => footerRows, slashEnabled: !pi.getFlag("friendly-keep-footer"),
          actions: {
            newChat: safe(ctx, () => newConversation(ctx)), history: safe(ctx, () => history(ctx)),
            theme: safe(ctx, () => changeTheme(ctx)), more: safe(ctx, () => more(ctx)),
            menu: safe(ctx, () => menu(ctx)), model: safe(ctx, () => selectModel(ctx)),
            commands: safe(ctx, () => commands(ctx)),
            voice:()=>{
              if(voice&&['installing','downloading','loading','error'].includes(voice.state.phase)){
                view.voiceHintUntil=Date.now()+3000;clearTimeout(voiceHintTimer);
                voiceHintTimer=setTimeout(()=>{view.voiceHintUntil=0;workspace?.redraw();},3000);workspace?.redraw();
                if(voice.state.phase==='error')voice.toggle(ctx);
              }else if(ctx.isIdle()||voice?.state.phase==='recording')voice?.toggle(ctx);
            },
            exit: safe(ctx, () => requestExit(ctx,()=>dialog(ctx,()=>ctx.ui.custom((tui,_theme,_keys,done)=>{
              activeMenu=createExitDialog({...rendering,tui,done,palette:palettes[view.scheme],background:width=>workspace.renderSurface(width)});return activeMenu;
            },{overlay:true,overlayOptions:{width:'100%',maxHeight:'100%',row:0,col:0,margin:0}})))),
            errorDetails: raw => safe(ctx,()=>dialog(ctx,()=>choose(ctx,"Подробности ошибки",wrapText(explainError(raw).help+" Причина сервиса: "+raw,50).map(label=>({label})),false,"Текст сервиса · Esc или × Закрыть — обратно")))(),
            details: () => ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded()),
          },
        });
        return workspace.editor;
      });
    }
    clearTimeout(startupTimer);
    // Project hub requires a deliberate project choice before a first prompt.
  });
  for (const name of ["message_start","message_update","message_end"]) pi.on(name, event => {
    if(event.message?.role === "assistant" || event.message?.role === "user") view.live=event.message;
    workspace?.redraw();
  });
  pi.on("agent_start",()=>{view.error=undefined;view.live=undefined;view.notice="";view.steps=[];view.running=true;view.started=Date.now();view.activity="Помощник готовит ответ…";workspace?.redraw();});
  pi.on("agent_end",()=>{view.activity="";view.running=false;workspace?.redraw();});
  pi.on("tool_execution_start",event=>{view.steps=startActivity(view.steps??[],event);view.activity="Выполняю задачу…";workspace?.redraw();});
  pi.on("tool_execution_end",event=>{view.steps=finishActivity(view.steps??[],event);if(event.isError)view.error={kind:"tool",raw:clean(event.result?.content?.filter(c=>c.type==="text").map(c=>c.text).join("\n")||"Инструмент завершился с ошибкой")};workspace?.redraw();});
  pi.on("session_shutdown", event => {
    if(["resume","new","fork"].includes(event?.reason))workspace?.freezeForTransition();
    stopped = true; clearTimeout(voiceHintTimer);voice?.dispose();voice=undefined;voiceContext=undefined; clearTimeout(startupTimer); clearTimeout(noticeTimer); restoreUI(); widgets.clear(); activeMenu?.dispose(); workspace?.dispose(); workspace = undefined;
  });
}
