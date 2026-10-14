import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, verify, randomUUID} from 'node:crypto';
import {publicKey} from './trust.mjs';

const origin = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/';
export const channelURL = origin + 'main/updates/stable.json';
const hash = data => createHash('sha256').update(data).digest('hex');
const validHash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const safeFile = s => typeof s === 'string' && /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(s) && !s.split('/').some(p => p === '.' || p === '..');
export async function atomic(file, value) {
  const temp = file + '.tmp-' + randomUUID();
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, {force:true}).catch(()=>{}); }
}
export function descriptor(bytes, key = publicKey) {
  const envelope = JSON.parse(bytes);
  if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw Error('Invalid signature');
  const payload = Buffer.from(envelope.payload, 'base64');
  if (!verify(null, payload, key, Buffer.from(envelope.signature, 'base64'))) throw Error('Invalid signature');
  const d = JSON.parse(payload);
  if (d.schema !== 1 || !Number.isSafeInteger(d.sequence) || d.sequence < 1 || !/^[a-f0-9]{40}$/.test(d.revision) || !validHash(d.manifestHash) || typeof d.version !== 'string' || d.minNodeMajor !== 22) throw Error('Invalid release');
  return d;
}
async function read(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function verifyBundle(directory, expected, builtin = false) {
  const raw = await fs.readFile(path.join(directory, 'bundle.json'));
  if (expected && hash(raw) !== expected) throw Error('Invalid manifest hash');
  const manifest = JSON.parse(raw);
  const entries = Object.entries(manifest.files ?? {});
  if (entries.length < 3 || entries.length > 200 || !manifest.embeddedRouter || !manifest.files['index.ts'] || !manifest.files['router/index.ts']) throw Error('Invalid bundle');
  let total = 0;
  for (const [file, digest] of entries) {
    if (!safeFile(file) || !validHash(digest)) throw Error('Invalid bundle path');
    const location = path.join(directory, builtin && file === 'index.ts' ? 'bundled.ts' : file);
    const stat = await fs.lstat(location);
    if (!stat.isFile() || stat.size > 8*1024*1024 || (total += stat.size) > 32*1024*1024) throw Error('Invalid bundle size');
    if (hash(await fs.readFile(location)) !== digest) throw Error('Invalid file hash');
  }
  const pkg = await read(path.join(directory, 'package.json'));
  if (pkg.name !== 'pi-friendly' || pkg.version !== manifest.version) throw Error('Invalid package');
  return manifest;
}
// Only complete immutable versions are candidates. The built-in version is never
// overwritten by the worker. No network calls are made on the startup path.
export async function candidates(root, key = publicKey) {
  const result = [];
  let rejected;
  try { rejected=(await read(path.join(root,'.updates','rejected.json'))).id; } catch {}
  for (const file of ['ready.json','current.json']) {
    try {
      const envelope = await fs.readFile(path.join(root, '.updates', file));
      const d = descriptor(envelope, key);
      if(d.manifestHash===rejected)continue;
      if (result.some(x=>x.id===d.manifestHash)) continue;
      const directory = path.join(root, '.updates', 'versions', d.manifestHash);
      const manifest = await verifyBundle(directory, d.manifestHash);
      if (manifest.version !== d.version) continue;
      result.push({id:d.manifestHash, sequence:d.sequence, directory, entry:path.join(directory,'index.ts'), envelope});
    } catch { /* An interrupted download or damaged update cannot hide fallback. */ }
  }
  result.sort((a,b)=>b.sequence-a.sequence);
  result.push({id:'builtin', sequence:0, directory:root, entry:path.join(root,'bundled.ts')});
  return result;
}
export async function confirm(root, candidate) {
  if (candidate.envelope) await atomic(path.join(root,'.updates','current.json'),candidate.envelope);
}
export async function reject(root,candidate) {
  if(candidate.id!=='builtin')await atomic(path.join(root,'.updates','rejected.json'),JSON.stringify({id:candidate.id}));
}
async function download(url, fetcher, signal, limit) {
  const response = await fetcher(url,{signal,redirect:'error',headers:{Accept:'application/octet-stream'}});
  if (!response.ok || !response.body) throw Error('Update unavailable');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>limit)throw Error('Update too large'); chunks.push(value); }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function checkUpdate(root, {fetcher=fetch, key=publicKey, signal=AbortSignal.timeout(90000), hook=async()=>{}} = {}) {
  const store=path.join(root,'.updates'); await fs.mkdir(store,{recursive:true,mode:0o700});
  const lock=path.join(store,'lock.json'), nonce=randomUUID();
  // Dead worker locks can be recovered; a live worker never has its lock stolen.
  try { const h=await fs.open(lock,'wx',0o600); await h.writeFile(JSON.stringify({pid:process.pid,nonce}));await h.close(); }
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    try { const owner=await read(lock); try { process.kill(owner.pid,0); return false; } catch(e) { if(e.code!=='ESRCH')return false; } }
    catch { const stat=await fs.stat(lock);if(Date.now()-stat.mtimeMs<120000)return false; }
    await fs.rename(lock,lock+'.stale-'+nonce).catch(()=>{}); return false;
  }
  let stage;
  try {
    const envelope=await download(channelURL,fetcher,signal,65536), d=descriptor(envelope,key);
    if(Number(process.versions.node.split('.')[0])<d.minNodeMajor)return false;
    try { if((await read(path.join(store,'rejected.json'))).id===d.manifestHash)return false; } catch {}
    const available=await candidates(root,key);
    if(available.some(x=>x.sequence>=d.sequence))return false; // No rollback / replay.
    for(const name of await fs.readdir(store)) {
      if(!/^stage-[a-f0-9-]{36}$/.test(name))continue;
      const target=path.join(store,name), stat=await fs.lstat(target);
      if(stat.isDirectory()&&!stat.isSymbolicLink()&&Date.now()-stat.mtimeMs>86400000)await fs.rm(target,{recursive:true,force:true});
    }
    const base=origin+d.revision+'/installer/pi-friendly/';
    const raw=await download(base+'bundle.json',fetcher,signal,128*1024);
    if(hash(raw)!==d.manifestHash)throw Error('Invalid manifest hash');
    const m=JSON.parse(raw), entries=Object.entries(m.files??{});
    if(entries.length>200 || entries.length<3 || m.version!==d.version)throw Error('Invalid manifest');
    stage=path.join(store,'stage-'+nonce);await fs.mkdir(stage,{mode:0o700});
    let total=0;
    for(const [file,digest] of entries) {
      if(!safeFile(file)||!validHash(digest))throw Error('Invalid bundle path');
      const data=await download(base+file,fetcher,signal,8*1024*1024);
      if((total+=data.length)>32*1024*1024 || hash(data)!==digest)throw Error('Invalid download');
      await fs.mkdir(path.dirname(path.join(stage,file)),{recursive:true,mode:0o700});
      await atomic(path.join(stage,file),data); await hook('file');
    }
    await atomic(path.join(stage,'bundle.json'),raw);
    await verifyBundle(stage,d.manifestHash); await hook('verified');
    const versions=path.join(store,'versions');await fs.mkdir(versions,{recursive:true,mode:0o700});
    const destination=path.join(versions,d.manifestHash);
    try { await fs.rename(stage,destination); stage=undefined; }
    catch(error) { if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error; await verifyBundle(destination,d.manifestHash); }
    await hook('published');
    if((await read(lock)).nonce!==nonce)throw Error('Lost lock');
    await atomic(path.join(store,'ready.json'),envelope); // The only commit point.
    return true;
  } finally {
    if(stage)await fs.rm(stage,{recursive:true,force:true}).catch(()=>{});
    try { if((await read(lock)).nonce===nonce)await fs.rm(lock); } catch {}
  }
}
