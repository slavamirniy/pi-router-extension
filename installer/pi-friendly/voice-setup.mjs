import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,open,readFile,rename,unlink,chmod,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

export const MODEL_BYTES=224893347;
export const MODEL_REVISION='322c3b29492673eb7d0b434bfa9dfb8653e34d02';
const base=`https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/${MODEL_REVISION}/`;
const files=[
 ['v3_e2e_ctc.int8.onnx',MODEL_BYTES,'2e3fcb7a7b66030336fd10c2fcfb033bd1dc7e1bf238fe5cfd83b1d0cfc9d28e'],
 ['v3_e2e_ctc_vocab.txt',2007,'142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd'],
 ['config.json',135,'0641fcf73f4af791c73f05083e38a658ff5dcbee3534a0c61396c10f4b97f0fe'],
];
const assets={
 'win32-x64':['x86_64-pc-windows-msvc.zip','7c38608c8a18ee137d748a1773053b07ec8f3a30fab49aebaa6f4e4efeceb019'],
 'win32-arm64':['aarch64-pc-windows-msvc.zip','4b783bda5cc44bbae0651a837223873a7acee31152381aef5fc86ef6bef25997'],
 'darwin-x64':['x86_64-apple-darwin.tar.gz','4fa82e37cb94767661f532b001e470b67a186c7260e305bd84ddb78fd545c0b6'],
 'darwin-arm64':['aarch64-apple-darwin.tar.gz','0c4346de7abdb49495b393b9ec809fe387aa43e586be20fecb972216c1e71732'],
 'linux-x64':['x86_64-unknown-linux-gnu.tar.gz','b4dfaef47d491a7296981f8374a4595f55dbf84e8937c8ecd2983574d8bb3da6'],
 'linux-arm64':['aarch64-unknown-linux-gnu.tar.gz','5231be65f496304623895dacdbf1de8504fec90303684bdf05805aa34414dd21'],
};
export function platformAsset(platform=process.platform,arch=process.arch){
 const supported=platform==='darwin'?['x64','arm64'].includes(arch):['win32','linux'].includes(platform)&&arch==='x64';
 const value=supported&&assets[`${platform}-${arch}`];if(!value)throw Error('Голос доступен для Windows/Linux x64 и macOS 13+ (Intel/Apple Silicon).');return value;
}
export async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function download(url,path,sha,onProgress=()=>{},signal){
 try{if(await hashFile(path)===sha)return;}catch{}
 const partial=path+'.part';
 const saved=await stat(partial).then(s=>s.size).catch(()=>0);
 if(saved&&await hashFile(partial)===sha){await rename(partial,path);onProgress(saved,saved);return;}
 const response=await fetch(url,{headers:saved?{Range:`bytes=${saved}-`}:{},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(3600000)]):AbortSignal.timeout(3600000)});
 if(!response.ok||!response.body)throw Error(`Не удалось скачать файлы голоса (HTTP ${response.status}). Нажмите «Повторить».`);
 const resume=response.status===206&&response.headers.get('content-range')?.startsWith(`bytes ${saved}-`);
 if(response.status===206&&!resume)throw Error('Сервер вернул неверный фрагмент модели. Повторите загрузку.');
 const total=(Number(response.headers.get('content-length'))||0)+(resume?saved:0);
 const hash=createHash('sha256');
 if(resume)for await(const chunk of createReadStream(partial))hash.update(chunk);
 const handle=await open(partial,resume?'a':'w');let received=resume?saved:0,last=0;
 try{
  for await(const chunk of response.body){signal?.throwIfAborted();await handle.write(chunk);hash.update(chunk);received+=chunk.length;if(Date.now()-last>150){onProgress(received,total);last=Date.now();}}
 }finally{await handle.close();}
 if(hash.digest('hex')!==sha){await unlink(partial).catch(()=>{});throw Error('Проверка файлов голоса не прошла. Нажмите «Повторить».');}
 await rename(partial,path);onProgress(received,received);
}
export function run(file,args,{env=process.env,signal,onChild=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe'],signal});onChild(child);let output='';
  const collect=b=>{output=(output+b.toString()).slice(-4000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error(`Подготовка голоса завершилась с ошибкой (${code}). ${output.slice(-1500)}`)));
 });
}
async function acquireLock(path,signal,status){
 for(let n=0;n<1200;n++){
  signal?.throwIfAborted();
  try{const h=await open(path,'wx');await h.writeFile(JSON.stringify({pid:process.pid,time:Date.now()}));await h.close();return ()=>unlink(path).catch(()=>{});}catch(e){if(e.code!=='EEXIST')throw e;}
  try{const owner=JSON.parse(await readFile(path,'utf8'));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH'){await unlink(path).catch(()=>{});continue;}}}catch{if(Date.now()-(await stat(path)).mtimeMs>60000){await unlink(path).catch(()=>{});continue;}}
  status({phase:'installing',label:'Подготовка в другом окне…'});
  await new Promise(r=>setTimeout(r,1000));
 }
 throw Error('Подготовка голоса занята другим окном. Закройте его и повторите.');
}
export async function prepareVoice(root,status,{signal,onChild}={}){
 const [asset,sha]=platformAsset();await mkdir(root,{recursive:true});
 const unlock=await acquireLock(join(root,'setup.lock'),signal,status);
 try{
  const envRoot=join(root,`runtime-v1-${process.platform}-${process.arch}`),python=join(envRoot,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const modelDir=join(root,'gigaam-v3-e2e-ctc-int8');await mkdir(modelDir,{recursive:true});
  let installed=false;try{installed=(await readFile(join(envRoot,'ready'),'utf8'))==='1';}catch{}
  if(!installed){
   status({phase:'installing',label:'Среда голоса…'});
   const uvRoot=join(root,'uv-0.12.24');await mkdir(uvRoot,{recursive:true});
   const archive=join(uvRoot,'uv-'+asset);
   await download(`https://github.com/astral-sh/uv/releases/download/0.12.24/uv-${asset}`,archive,sha,(n,total)=>status({phase:'installing',label:'Загрузчик голоса',percent:total?Math.floor(n/total*100):undefined}),signal);
   await run(process.platform==='win32'?'tar.exe':'tar',['-xf',archive,'-C',uvRoot],{signal,onChild});
   const uv=process.platform==='win32'?join(uvRoot,'uv.exe'):join(uvRoot,'uv-'+asset.replace('.tar.gz',''),'uv');
   if(process.platform!=='win32')await chmod(uv,0o755);
   const env={...process.env,UV_PYTHON_INSTALL_DIR:join(root,'python'),UV_CACHE_DIR:join(root,'cache'),UV_NO_PROGRESS:'1',UV_NO_MODIFY_PATH:'1'};
   status({phase:'installing',label:'Python для голоса…'});
   await run(uv,['venv','--python','3.12','--managed-python','--allow-existing',envRoot],{env,signal,onChild});
   status({phase:'installing',label:'ONNX Runtime…'});
   await run(uv,['pip','install','--python',python,'--only-binary',':all:','onnx-asr==0.12.0',(process.platform==='darwin'?'onnxruntime==1.23.2':'onnxruntime==1.31.0'),'numpy==2.5.3','miniaudio==1.71'],{env,signal,onChild});
   const marker=await open(join(envRoot,'ready'),'w');await marker.writeFile('1');await marker.close();
  }
  status({phase:'downloading',label:'Проверка модели…'});
  for(const [name,size,hash] of files)await download(base+name,join(modelDir,name),hash,(n)=>status({phase:'downloading',label:'GigaAM · 225 МБ',percent:Math.min(100,Math.floor(n/size*100))}),signal);
  return {python,modelDir};
 }finally{await unlock();}
}
