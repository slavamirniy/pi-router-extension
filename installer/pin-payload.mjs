// Run after committing the payload to the public repository, before tagging a release.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = new URL('../', import.meta.url);
const revision = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(revision ?? '')) throw Error('Pass the public payload commit SHA');
const bundle = JSON.parse((await fs.readFile(new URL('installer/pi-friendly/bundle.json', root), 'utf8')).replace(/^\uFEFF/, ''));
const files = ['index.ts','models.mjs','progress.mjs','safety.mjs','installer/configure.mjs','installer/friendly.mjs','installer/pi-friendly/bundle.json', ...Object.keys(bundle.files).map(f=>'installer/pi-friendly/'+f)];
const entries = await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(new URL(f,root))).digest('hex')]));
const source = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/'+revision;
for (const [name, shell] of [['install-pi-windows.ps1','powershell'],['install-pi-linux.sh','bash']]) {
  const url = new URL('installer/'+name,root);
  let script = await fs.readFile(url,'utf8');
  if (shell === 'powershell') {
    script = script.replace(/\$TaskSource = '[^']*'/, `$TaskSource = '${source}'`);
    script = script.replace(/\$TaskManifest = @\{[\s\S]*?\n\}/, '$TaskManifest = @{\n'+entries.map(([f,h])=>`    '${f}' = '${h}'`).join('\n')+'\n}');
  } else {
    script = script.replace(/TASK_SOURCE="[^"]*"/, `TASK_SOURCE="${source}"`);
    script = script.replace(/done <<'MANIFEST'[\s\S]*?\nMANIFEST/, "done <<'MANIFEST'\n"+entries.map(([f,h])=>`${f} ${h}`).join('\n')+'\nMANIFEST');
  }
  await fs.writeFile(url,script.replace(/\r\n/g,'\n'));
}
const commonHash = createHash('sha256').update(await fs.readFile(new URL('installer/install-pi-linux.sh',root))).digest('hex');
const version = JSON.parse(await fs.readFile(new URL('package.json',root),'utf8')).version;
const macURL = new URL('installer/install-pi-macos.sh',root);
let mac = await fs.readFile(macURL,'utf8');
mac = mac.replace(/pi-router-extension\/[^/]+\/installer\/install-pi-linux.sh/,`pi-router-extension/v${version}/installer/install-pi-linux.sh`);
mac = mac.replace(/\n(?:TASK_COMMON_HASH='[^']*'\n[^\n]*\n)?bash "\$TASK_MAC_TMP\/common.sh"/, `\nTASK_COMMON_HASH='${commonHash}'\n[[ "$(shasum -a 256 "$TASK_MAC_TMP/common.sh" | cut -d ' ' -f 1)" == "$TASK_COMMON_HASH" ]] || { echo 'Installer integrity check failed.' >&2; exit 1; }\nbash "$TASK_MAC_TMP/common.sh"`);
await fs.writeFile(macURL,mac.replace(/\r\n/g,'\n'));
console.log(`Pinned ${entries.length} payload files in ${fileURLToPath(root)}`);
