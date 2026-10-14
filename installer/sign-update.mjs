// node installer/sign-update.mjs <payload commit SHA> <monotonic sequence>
// PI_UPDATE_SIGNING_KEY_FILE must point to a private Ed25519 PEM outside this repo.
import fs from 'node:fs/promises';
import {createHash,sign,verify} from 'node:crypto';
import {publicKey} from './autoupdate/trust.mjs';
const revision=process.argv[2], sequence=Number(process.argv[3]);
if(!/^[a-f0-9]{40}$/.test(revision??'')||!Number.isSafeInteger(sequence)||sequence<1)throw Error('Pass payload revision and positive sequence');
const raw=await fs.readFile(new URL('./pi-friendly/bundle.json',import.meta.url));
const payload=Buffer.from(JSON.stringify({schema:1,sequence,revision,manifestHash:createHash('sha256').update(raw).digest('hex'),version:JSON.parse(raw).version,minNodeMajor:22}));
const signature=sign(null,payload,await fs.readFile(process.env.PI_UPDATE_SIGNING_KEY_FILE));
if(!verify(null,payload,publicKey,signature))throw Error('Signing key does not match installer trust key');
const target=new URL('../updates/',import.meta.url);await fs.mkdir(target,{recursive:true});
await fs.writeFile(new URL('stable.json',target),JSON.stringify({payload:payload.toString('base64'),signature:signature.toString('base64')},null,2)+'\n');
console.log('Signed runtime channel sequence',sequence);
