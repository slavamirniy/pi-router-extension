import routerProgress from './router/index.ts';
import {createBilling} from './billing.mjs';
import {pickProjectFolder} from './folder-picker.mjs';
import {createModelPreference} from './model-preference.mjs';
import {createHostBridge} from './web-host.mjs';
import {startWebServer} from './web-server.mjs';
import {createRpc} from './web-rpc.mjs';
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
  const billing=createBilling({receiptFile:join(getAgentDir(),'purchase-consents.jsonl'),getConnection:async()=>{
    const m=billingContext?.modelRegistry.getAvailable().find((m:any)=>m.provider==='router');
    if(!m)throw Error('Роутер не подключён.');const auth=await billingContext.modelRegistry.getApiKeyAndHeaders(m);if(!auth?.ok)throw Error('Доступ к роутеру не настроен.');const bearer=Object.entries(auth.headers||{}).find(([k])=>k.toLowerCase()==='authorization')?.[1];return {baseURL:auth.baseUrl||m.baseUrl,apiKey:typeof bearer==='string'&&/^Bearer /i.test(bearer)?bearer.slice(7):auth.apiKey};
  }});
  let billingTimer:any;
  pi.on('session_start',async(_event,ctx)=>{billingContext=ctx;if(ctx.mode!=='tui')return;void billing.refresh();clearInterval(billingTimer);billingTimer=setInterval(()=>void billing.refresh(),30000);billingTimer.unref?.();});
  pi.on('agent_end',()=>{void billing.refresh();});
  pi.on('session_shutdown',()=>{clearInterval(billingTimer);billing.dispose();});
  const openExternal=(url:string)=>{const c=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});c.on('error',()=>{});c.unref();};
  const modelPreference=createModelPreference(join(getAgentDir(),'friendly-model.json'));
  pi.on('model_select',(event)=>{if(event.source!=='restore')modelPreference.save(event.model);});
  pi.on('session_start',async(_event,ctx)=>{const model=modelPreference.resolve(ctx.modelRegistry.getAvailable());if(model)await pi.setModel(model);});
  const preferencePath = join(getAgentDir(), "friendly-ui.json");
  const projects=createProjectStore({root:join(homedir(),"Documents","AI DIY Projects"),registry:join(getAgentDir(),"friendly-projects.jsonl"),SessionManager});
  let web: any, opening: Promise<any> | undefined, unlockTerminal: (()=>void) | undefined;
  const hostObservers=new Set<(event:any)=>void>();
  routerProgress(pi,{onSnapshot:(progress:any,ctx:any)=>{const event={type:'friendly_router_progress',progress};if(process.env.PI_FRIENDLY_WEB_CHILD==='1'&&ctx?.mode==='rpc')process.stderr.write('PI_FRIENDLY_PROGRESS '+JSON.stringify(event)+'\n');else for(const emit of hostObservers)emit(event);}});
  for(const type of ['agent_start','agent_end','agent_settled','message_start','message_update','message_end','tool_execution_start','tool_execution_update','tool_execution_end'] as const)pi.on(type,(event:any)=>{for(const emit of hostObservers)emit(event);});
  const openWeb=async(ctx: any, voice: any, getHostStatuses: any=()=>[])=>{
    if(process.env.PI_FRIENDLY_WEB_CHILD==='1')return;
    if((!web||web.closed)&&!ctx.isIdle())throw new Error('Сначала дождитесь ответа или остановите его.');
    if((!web||web.closed)&&voice&&['starting','recording','transcribing'].includes(voice.state.phase))throw new Error('Сначала завершите диктовку.');
    if(!web||web.closed){
      opening??=startWebServer({billing,projects,listSessions:()=>SessionManager.listAll(),readSession:(path: string)=>SessionManager.open(path).buildSessionContext().messages,
        makeHostRpc:({onEvent}:any)=>createHostBridge({pi,ctx,observers:hostObservers,onEvent}),
        pickProjectFolder,onExit:()=>ctx.shutdown(),canExit:()=>ctx.isIdle(),getPreferredModel:()=>modelPreference.resolve(ctx.modelRegistry.getAvailable()),onModelSelected:(model:any)=>modelPreference.save(model),
        getHostStatuses,models:()=>ctx.modelRegistry.getAvailable(),hostSession:()=>ctx.sessionManager.getSessionFile(),voice,
        makeRpc:(options: any)=>createRpc({...options,cli:join(getPackageDir(),'dist','bundle','cli.js'),model:modelPreference.resolve(ctx.modelRegistry.getAvailable())||ctx.model})});
      try{web=await opening;}finally{opening=undefined;}
    }
    unlockTerminal??=ctx.ui.onTerminalInput?.((data:string)=>{if(!web||web.closed)return;if(data==='\r')void openWeb(ctx,voice,getHostStatuses).catch((error:any)=>ctx.ui.notify(error.message,'error'));return {consume:true};});
    const url=web.url;
    try{await new Promise<void>((resolve,reject)=>{
      const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});
      child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
    });}catch(error){await web?.close();unlockTerminal?.();unlockTerminal=undefined;throw error;}
    ctx.ui.notify('Веб-интерфейс открыт в браузере. Оставьте pi запущенным.','info');
  };
  pi.on('session_shutdown',async()=>{await web?.close();web=undefined;unlockTerminal?.();unlockTerminal=undefined;});
  installFriendly(pi, { billing,openExternal,openWeb, isWebActive:()=>Boolean(web&&!web.closed), copyToClipboard, readClipboardText, sliceByColumn, matchesKey, truncate: truncateToWidth, measure: visibleWidth,
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
