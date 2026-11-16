import { Type } from '@earendil-works/pi-ai';
import { IMAGE_SIZES, runImageTool, setImageTitle } from './image-tool.mjs';
import routerProgress from './router/index.ts';
import {createBilling} from './billing.mjs';
import {pickProjectFolder,pickChatFiles} from './folder-picker.mjs';
import {createModelPreference, installModelPreference} from './model-preference.mjs';
import {createHostBridge} from './web-host.mjs';
import {startWebServer} from './web-server.mjs';
import {canAutoOpen,launchBrowser} from './browser-start.mjs';
import {createRpc} from './web-rpc.mjs';
import {createTitleGenerator, createImageTitleGenerator, finalImageTitle} from './title.mjs';
import {spawn} from 'node:child_process';
import {readClipboardText} from './clipboard.mjs';
import { createVoiceService } from './voice.mjs';
import { copyToClipboard, CustomEditor, SessionManager, getAgentDir, getPackageDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, sliceByColumn, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createProjectStore } from "./projects.mjs";
import { join } from "node:path";
import { installFriendly } from "./friendly.mjs";
export default function friendly(pi: ExtensionAPI) {
  let billingContext:any;
  const getConnection=async()=>{
    const m=billingContext?.modelRegistry.getAvailable().find((m:any)=>m.provider==='router');
    if(!m)throw Error('Роутер не подключён.');const auth=await billingContext.modelRegistry.getApiKeyAndHeaders(m);if(!auth?.ok)throw Error('Доступ к роутеру не настроен.');const bearer=Object.entries(auth.headers||{}).find(([k])=>k.toLowerCase()==='authorization')?.[1];return {baseURL:auth.baseUrl||m.baseUrl,apiKey:typeof bearer==='string'&&/^Bearer /i.test(bearer)?bearer.slice(7):auth.apiKey};
  };
  const billing=createBilling({receiptFile:join(getAgentDir(),'purchase-consents.jsonl'),getConnection});
  pi.registerTool({
    name:'generate_image',label:'Новое изображение',
    description:'Generate an image from a description, or edit a project image using its relative path. Uses a paid image credit operation. Use only when the user asks to generate or edit an image. Optional size must be one of the supported image sizes.',
    parameters:Type.Object({
      prompt:Type.String(),
      source:Type.Optional(Type.String({description:'Relative path to a source PNG or JPEG in this project'})),
      size:Type.Optional(Type.String({enum:IMAGE_SIZES,description:'auto, 1024x1024, 1024x1536, 1536x1024, 1920x1080, 1080x1920, 2048x1152, 2048x2048 or 2560x1440'})),
    }),
    async execute(_id:any,params:any,signal:any,_update:any,ctx:any){
      const result=await runImageTool({...params,sessionId:ctx.sessionManager.getSessionId()},ctx.cwd,await getConnection(),signal);
      await applyImageTitle(result,params.prompt,ctx);
      void billing.refresh();
      return result;
    }
  });
  let billingTimer:any;
  pi.on('session_start',async(_event,ctx)=>{billingContext=ctx;if(ctx.mode!=='tui')return;void billing.refresh();clearInterval(billingTimer);billingTimer=setInterval(()=>void billing.refresh(),30000);billingTimer.unref?.();});
  pi.on('agent_end',()=>{void billing.refresh();});
  pi.on('session_shutdown',()=>{clearInterval(billingTimer);billing.dispose();});
  const openExternal=(url:string)=>{const c=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});c.on('error',()=>{});c.unref();};
  const modelPreference=createModelPreference(join(getAgentDir(),'friendly-model.json'));
  const preferredModel=installModelPreference(pi,modelPreference);
  async function applyImageTitle(result:any,prompt:string,ctx:any,cwd:string=ctx.cwd){
    const image=result?.details?.image;
    if(!image)return result;
    let raw='';
    try{
      const generate=createImageTitleGenerator({complete:(model:any,context:any,options:any)=>ctx.modelRegistry.complete(model,context,options),resolveModel:()=>preferredModel(ctx)||ctx.model});
      raw=await generate(prompt,AbortSignal.timeout(15000));
    }catch{}
    const title=finalImageTitle(raw,prompt);
    image.title=title;
    for(const item of result.details?.images||[])if(item.id===image.id)item.title=title;
    await setImageTitle(cwd,image,title);
    return result;
  }
  const preferencePath = join(getAgentDir(), "friendly-ui.json");
  const projects=createProjectStore({root:join(homedir(),"Documents","AI DIY Projects"),registry:join(getAgentDir(),"friendly-projects.jsonl"),SessionManager});
  let web: any, launching: Promise<void> | undefined, sessionGeneration=0, unlockTerminal: (()=>void) | undefined;
  const hostObservers=new Set<(event:any)=>void>();
  routerProgress(pi,{onSnapshot:(progress:any,ctx:any)=>{const event={type:'friendly_router_progress',progress};if(process.env.PI_FRIENDLY_WEB_CHILD==='1'&&ctx?.mode==='rpc')process.stderr.write('PI_FRIENDLY_PROGRESS '+JSON.stringify(event)+'\n');else for(const emit of hostObservers)emit(event);}});
  for(const type of ['agent_start','agent_end','agent_settled','message_start','message_update','message_end','tool_execution_start','tool_execution_update','tool_execution_end'] as const)pi.on(type,(event:any)=>{for(const emit of hostObservers)emit(event);});
  const launchWeb=async(ctx: any, voice: any, getHostStatuses: any=()=>[])=>{
    const generation=sessionGeneration;
    if(process.env.PI_FRIENDLY_WEB_CHILD==='1')return;
    if((!web||web.closed)&&!ctx.isIdle())throw new Error('Сначала дождитесь ответа или остановите его.');
    if((!web||web.closed)&&voice&&['starting','recording','transcribing'].includes(voice.state.phase))throw new Error('Сначала завершите диктовку.');
    if(!web||web.closed){
      const started=await startWebServer({billing,projects,listSessions:()=>SessionManager.listAll(),readSession:(path: string)=>SessionManager.open(path).buildSessionContext().messages,
        makeHostRpc:({onEvent}:any)=>createHostBridge({pi,ctx,observers:hostObservers,onEvent}),
        pickProjectFolder,pickChatFiles,sessionDirFor:(cwd:string)=>SessionManager.create(cwd).getSessionDir(),generateImage:async(options:any)=>{const result=await runImageTool(options,options.cwd,await getConnection(),options.signal);await applyImageTitle(result,options.prompt,ctx,options.cwd);void billing.refresh();return result;},onExit:async()=>{try{if(!ctx.isIdle())await ctx.abort();}finally{ctx.shutdown();}},canExit:()=>ctx.isIdle(),getPreferredModel:()=>preferredModel(ctx),onModelSelected:(model:any)=>modelPreference.save(model),
        getHostStatuses,models:()=>ctx.modelRegistry.getAvailable(),hostSession:()=>ctx.sessionManager.getSessionFile(),voice,
        generateTitle:createTitleGenerator({complete:(model:any,context:any,options:any)=>ctx.modelRegistry.complete(model,context,options),resolveModel:()=>preferredModel(ctx)||ctx.model}),
        makeRpc:(options: any)=>createRpc({...options,cli:join(getPackageDir(),'dist','bundle','cli.js'),model:preferredModel(ctx)||ctx.model})});
      if(generation!==sessionGeneration){await started.close();return;}
      web=started;
    }
    const server=web;
    try{await launchBrowser(server.url,server.browserReady);}
    catch(error){
      if(generation!==sessionGeneration)return;
      if(!unlockTerminal){web=undefined;await server.close();}
      throw error;
    }
    if(generation!==sessionGeneration||server.closed)return;
    unlockTerminal??=ctx.ui.onTerminalInput?.((data:string)=>{if(!web||web.closed)return;if(data==='\r')void openWeb(ctx,voice,getHostStatuses).catch((error:any)=>ctx.ui.notify(error.message,'error'));return {consume:true};});
    ctx.ui.notify('Веб-интерфейс открыт в браузере. Оставьте pi запущенным.','info');
  };
  const openWeb=(ctx:any,voice:any,getHostStatuses:any=()=>[])=>{
    if(launching)return launching;
    const task:Promise<void>=launchWeb(ctx,voice,getHostStatuses).finally(()=>{if(launching===task)launching=undefined;});
    launching=task;return task;
  };
  pi.on('session_shutdown',async()=>{sessionGeneration++;launching=undefined;const server=web;web=undefined;unlockTerminal?.();unlockTerminal=undefined;await server?.close();});
  installFriendly(pi, { billing,openExternal,canAutoOpen,openWeb, isWebActive:()=>Boolean(unlockTerminal&&web&&!web.closed), copyToClipboard, readClipboardText, sliceByColumn, matchesKey, truncate: truncateToWidth, measure: visibleWidth,
    makeInput: () => new Input(),
    createVoice: callbacks => createVoiceService({root:join(getAgentDir(),'friendly-voice'),...callbacks}),
    makeEditor: (tui, theme, keys) => new CustomEditor(tui, theme, keys),
    listSessions: () => SessionManager.listAll(),
    projects,
    loadPrefs: () => { try { return JSON.parse(readFileSync(preferencePath, "utf8")); } catch { return {}; } },
    savePrefs: prefs => writeFileSync(preferencePath, JSON.stringify(prefs), "utf8"),
    markdown: (text, width, palette) => {
      const color = value => s => `\x1b[38;2;${value}m${s}\x1b[39m`;
      const accent = color(palette.accent), muted = color(palette.muted);
      return new Markdown(text, 0, 0, {
        heading: accent, link: accent, linkUrl: muted, code: accent, codeBlock: s => s,
        codeBlockBorder: muted, quote: muted, quoteBorder: muted, hr: muted, listBullet: accent,
        bold: s => `\x1b[1m${s}\x1b[22m`, italic: s => `\x1b[3m${s}\x1b[23m`,
        strikethrough: s => s, underline: s => s,
      }).render(width);
    },
  });
}
