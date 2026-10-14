import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {checkUpdate,candidates,confirm} from './autoupdate/update.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const keys=generateKeyPairSync('ed25519');
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pi-updates-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'bundled.ts'),'original working fallback');
 const files={'index.ts':'export default function(pi){pi.on("test",()=>{})}', 'router/index.ts':'export default function(){}','package.json':JSON.stringify({name:'pi-friendly',version:'0.12.5'})};
 const manifest=JSON.stringify({version:'0.12.5',embeddedRouter:true,files:Object.fromEntries(Object.entries(files).map(([f,s])=>[f,hash(s)]))});
 const d={schema:1,sequence:1,revision:'a'.repeat(40),manifestHash:hash(manifest),version:'0.12.5',minNodeMajor:22};
 const payload=Buffer.from(JSON.stringify(d));
 const envelope=JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,keys.privateKey).toString('base64')});
 const fetcher=async(url,options)=>{
  assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');
  let content=url.endsWith('/stable.json')?envelope:url.endsWith('/bundle.json')?manifest:files[url.split('/installer/pi-friendly/')[1]];
  return new Response(content??'',{status:content===undefined?404:200});
 };
 return {root,fetcher,envelope,d,files};
}
test('background publication preserves loaded fallback; next launch selects verified update',async t=>{
 const f=await fixture(t),before=await candidates(f.root,keys.publicKey);
 assert.equal(before[0].id,'builtin');
 assert.equal(await checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey}),true);
 assert.equal(await fs.readFile(before[0].entry,'utf8'),'original working fallback');
 const next=await candidates(f.root,keys.publicKey);assert.equal(next[0].id,f.d.manifestHash);
 await confirm(f.root,next[0]);assert.equal(await checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey}),false);
});
for(const phase of ['file','verified','published'])test('interruption at '+phase+' keeps old runtime',async t=>{
 const f=await fixture(t);
 await assert.rejects(checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey,hook:async p=>{if(p===phase)throw Error('power loss')}}));
 assert.equal((await candidates(f.root,keys.publicKey))[0].id,'builtin');
 assert.equal(await checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey}),true);
});
test('signature, content corruption, offline and oversized payload fail closed',async t=>{
 for(const bad of ['signature','content','offline','size']){
  const f=await fixture(t);
  const fetcher=async(url,opts)=>{
   if(bad==='offline')throw Error('offline');
   if(bad==='signature'&&url.endsWith('stable.json'))return new Response(f.envelope.replace(/"signature":"./,'"signature":"!'));
   if(bad==='content'&&url.endsWith('/index.ts'))return new Response('changed');
   if(bad==='size'&&url.endsWith('stable.json'))return new Response('x'.repeat(65537));
   return f.fetcher(url,opts);
  };
  await assert.rejects(checkUpdate(f.root,{fetcher,key:keys.publicKey}));
  assert.equal((await candidates(f.root,keys.publicKey))[0].id,'builtin');
 }
});
test('concurrent checks have one writer, downloaded corruption falls back',async t=>{
 const f=await fixture(t);let unblock;const gate=new Promise(r=>unblock=r);let reached;
 const entered=new Promise(r=>reached=r);
 const one=checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey,hook:async phase=>{if(phase==='verified'){reached();await gate;}}});
 await entered;assert.equal(await checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey}),false);unblock();await one;
 const next=await candidates(f.root,keys.publicKey);
 await fs.writeFile(next[0].entry,'broken');assert.equal((await candidates(f.root,keys.publicKey))[0].id,'builtin');
});
test('killed worker leaves fallback intact and a recoverable lock',async t=>{
 const f=await fixture(t);
 const manifest=JSON.stringify({version:'0.12.5',embeddedRouter:true,files:Object.fromEntries(Object.entries(f.files).map(([file,s])=>[file,hash(s)]))});
 const opts={root:f.root,key:keys.publicKey.export({type:'spki',format:'pem'}),envelope:f.envelope,files:f.files,manifest};
 const code=`import {checkUpdate} from ${JSON.stringify(new URL('./autoupdate/update.mjs',import.meta.url).href)};
 const o=JSON.parse(process.env.UPDATE_TEST);await checkUpdate(o.root,{key:o.key,fetcher:async url=>new Response(url.endsWith('stable.json')?o.envelope:url.endsWith('bundle.json')?o.manifest:o.files[url.split('/installer/pi-friendly/')[1]]),hook:async phase=>{if(phase==='verified'){process.send('verified');await new Promise(()=>{});}}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,UPDATE_TEST:JSON.stringify(opts)},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 const watchdog=setTimeout(()=>child.kill(),10000);t.after(()=>{clearTimeout(watchdog);child.kill();});
 assert.equal((await once(child,'message'))[0],'verified');
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 assert.equal((await candidates(f.root,keys.publicKey))[0].id,'builtin');
 assert.equal(await checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey}),false);
 assert.equal(await checkUpdate(f.root,{fetcher:f.fetcher,key:keys.publicKey}),true);
});
