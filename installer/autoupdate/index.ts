import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {spawn} from 'node:child_process';
import {candidates, confirm, reject, verifyBundle} from './update.mjs';

export default async function managedFriendly(pi: any) {
  const root=dirname(fileURLToPath(import.meta.url));
  const list=await candidates(root);
  // A browser RPC child shares the version selected by its parent process.
  const pinned=process.env.PI_DIY_RUNTIME;
  if(process.env.PI_FRIENDLY_WEB_CHILD==='1' && pinned) {
    const prefix=join(root,'.updates','versions');
    const id=dirname(pinned).slice(prefix.length+1);
    if(/^[a-f0-9]{64}$/.test(id)&&pinned===join(prefix,id,'index.ts')&&!list.some((x:any)=>x.entry===pinned)) {
      try { await verifyBundle(dirname(pinned),id);list.unshift({id,entry:pinned,directory:dirname(pinned),sequence:0}); } catch {}
    }
    list.sort((a:any,b:any)=>Number(b.entry===pinned)-Number(a.entry===pinned));
  }
  let loaded=false;
  for(const candidate of list) {
    let factory;
    try { if(candidate.id==='builtin')await verifyBundle(root,undefined,true);factory=(await import(candidate.entry)).default; if(typeof factory!=='function')throw Error('Invalid extension'); }
    catch { await reject(root,candidate).catch(()=>{});continue; }
    // Registration is buffered: a factory throwing during initialization cannot
    // leave duplicate handlers behind when we fall back to the previous version.
    const pending:any[]=[];let recording=true;
    const registration=new Set(['on','registerCommand','registerTool','registerShortcut','registerFlag','registerMessageRenderer','registerProvider']);
    const proxy=new Proxy(pi,{get(target,key){if(recording&&registration.has(String(key)))return (...args:any[])=>{pending.push([key,args]);};return target[key];}});
    try { await factory(proxy); } catch { await reject(root,candidate).catch(()=>{});continue; }
    recording=false;
    for(const [method,args] of pending)pi[method](...args);
    process.env.PI_DIY_RUNTIME=candidate.entry;
    await confirm(root,candidate).catch(()=>{});
    loaded=true;break;
  }
  if(!loaded)return; // Pi itself remains usable if every local copy is damaged.
  if(process.env.PI_FRIENDLY_WEB_CHILD==='1' || process.env.PI_DIY_AUTO_UPDATE==='0')return;
  let started=false;
  pi.on('session_start',()=>{
    if(started)return;started=true;
    try {
      const env:any={};
      for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'])if(process.env[key])env[key]=process.env[key];
      const child=spawn(process.execPath,[join(root,'worker.mjs'),root],{detached:true,windowsHide:true,stdio:'ignore',env});
      child.on('error',()=>{});child.unref();
    } catch {}
  });
}
