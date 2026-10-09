import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { modelsURL, mergeModels } from '../models.mjs';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extensionFiles = ['index.ts', 'models.mjs', 'progress.mjs', 'safety.mjs'];
async function readJSON(file, fallback) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Invalid configuration: ${path.basename(file)}`); }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
async function atomic(file, content) {
  await fs.mkdir(path.dirname(file), {recursive:true,mode:0o700});
  const temporary = `${file}.tmp.${process.pid}`;
  try { await fs.writeFile(temporary, content, {mode:0o600}); await fs.rename(temporary,file); if (process.platform !== 'win32') await fs.chmod(file,0o600); }
  finally { await fs.rm(temporary,{force:true}); }
}
async function backup(file, stamp) {
  try { await fs.copyFile(file,`${file}.bak.${stamp}`); if (process.platform !== 'win32') await fs.chmod(`${file}.bak.${stamp}`,0o600); }
  catch(error) { if (error.code !== 'ENOENT') throw error; }
}
async function remoteModels(baseURL,key,fetcher,timeout) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);
  try {
    const response = await fetcher(modelsURL(baseURL),{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:controller.signal,redirect:'error'});
    if (!response.ok || !response.body) throw new Error('Catalogue unavailable');
    const reader=response.body.getReader(); const decoder=new TextDecoder(); let text='',size=0;
    try { while(true){const {value,done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>1024*1024) throw new Error('Catalogue too large'); text+=decoder.decode(value,{stream:true});} text+=decoder.decode(); }
    finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    const body=JSON.parse(text);
    if(!Array.isArray(body.data)||body.has_more===true||body.data.length>5000||body.data.some(m=>!m||typeof m.id!=='string'||!/^[a-zA-Z0-9_.:/-]{1,128}$/.test(m.id))) throw new Error('Incomplete catalogue');
    return {data:body.data};
  } finally { clearTimeout(timer); }
}

export async function configure(options, dependencies={}) {
  const configDir=path.resolve(options.configDir || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(),'.pi','agent'));
  const provider=options.provider || 'router';
  if(!/^[a-zA-Z0-9_.-]{1,64}$/.test(provider)) throw new Error('PI_PROVIDER_NAME must use letters, digits, dots, dashes or underscores');
  if(typeof options.baseURL!=='string'||!options.baseURL.trim()) throw new Error('Set PI_BASE_URL to your OpenAI-compatible API URL, including /v1');
  const url=new URL(options.baseURL.trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error('PI_BASE_URL must be an HTTP(S) URL without credentials or query parameters');
  const baseURL=url.href.replace(/\/+$/,'');
  const modelsFile=path.join(configDir,'models.json'),settingsFile=path.join(configDir,'settings.json');
  const models=await readJSON(modelsFile,{providers:{}}),settings=await readJSON(settingsFile,{});
  if(!object(models)||!object(settings)||(models.providers!==undefined&&!object(models.providers))) throw new Error('Pi configuration must contain JSON objects');
  models.providers??={};
  const existing=models.providers[provider];
  if(existing&&existing.baseUrl?.replace(/\/+$/,'')!==baseURL) throw new Error('This provider name belongs to another API. Choose a different PI_PROVIDER_NAME');
  const key=options.apiKey?.trim() || existing?.apiKey;
  if(typeof key!=='string'||!key||/[\r\n\0]/.test(key)) throw new Error('Set PI_API_KEY to your client API key');
  const template={...existing,api:'openai-completions',baseUrl:baseURL};
  let discovered=Array.isArray(existing?.models)?existing.models:[],refreshed=false;
  try { const catalog=await remoteModels(baseURL,key,dependencies.fetch??globalThis.fetch,dependencies.timeout??10000); discovered=mergeModels(discovered,catalog.data,template);refreshed=true; }
  catch { /* Offline installation keeps the previous list; startup can refresh later. */ }
  models.providers[provider]={...template,apiKey:key,models:discovered};
  let selected=options.defaultModel || undefined;
  if(selected&&!discovered.some(m=>m.id===selected)) throw new Error('PI_DEFAULT_MODEL is not present in the available catalogue');
  selected??=settings.defaultProvider===provider&&discovered.some(m=>m.id===settings.defaultModel)?settings.defaultModel:discovered.find(m=>/^kimi[-_.]?k3$/i.test(m.id.split('/').at(-1)))?.id ?? discovered[0]?.id;
  if(selected){settings.defaultProvider=provider;settings.defaultModel=selected;}
  const contents=await Promise.all(extensionFiles.map(file=>fs.readFile(path.join(source,file))));
  const stamp=`${Date.now()}.${process.pid}`,destination=path.join(configDir,'extensions','llmsrouter-progress');
  await fs.mkdir(configDir,{recursive:true,mode:0o700});
  await backup(modelsFile,stamp);await backup(settingsFile,stamp);
  for(let i=0;i<extensionFiles.length;i++) {const file=path.join(destination,extensionFiles[i]);await backup(file,stamp);await atomic(file,contents[i]);}
  await atomic(modelsFile,JSON.stringify(models,null,2)+'\n');
  await atomic(settingsFile,JSON.stringify(settings,null,2)+'\n');
  return {provider,models:discovered.length,refreshed,defaultModel:selected,extensionInstalled:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const input=readFileSync(0,'utf8');
    const options=input.includes('\0')?Object.fromEntries(['apiKey','baseURL','provider','defaultModel','configDir'].map((k,i)=>[k,input.split('\0')[i]||undefined])):JSON.parse(input);
    const result=await configure(options);
    console.log(`Pi configured: ${result.provider}, ${result.models} models. Extension installed.`);
    if(!result.refreshed) console.warn('Model list could not be refreshed. Previous models retained; pi will try again on startup.');
    if(!result.models) console.warn('No models available yet. Check the API address/key and run /models-refresh in pi.');
  } catch(error) { console.error(`Installation stopped: ${error.message?.includes('PI_')||error.message?.includes('configuration')?error.message:'Could not configure pi; existing files were preserved where possible.'}`);process.exitCode=1; }
}
