import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('personal installer passes credentials without a prompt, restores environment and masks failures', {skip:process.platform!=='win32'}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-entry-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const template=await fs.readFile(new URL('./interactive-windows.ps1',import.meta.url),'utf8');
  for (const fail of [false,true]) {
    const payload=fail ? "throw ('upstream rejected ' + $env:PI_API_KEY)" : `if ($env:PI_API_KEY -ne 'lr-SYNTHETIC_CANARY' -or $env:PI_BASE_URL -ne 'https://example.test/v1') { throw 'wrong configuration' }; Write-Host 'PAYLOAD_OK'`;
    const script=template.replace('# __PERSONAL_CONFIGURATION__',"$taskAccessKey='lr-SYNTHETIC_CANARY'\n$env:PI_BASE_URL='https://example.test/v1'").replace('# __VERIFIED_WINDOWS_INSTALLER__',payload);
    const harness=`$ErrorActionPreference='Stop'\n$env:PI_API_KEY='previous'\n$env:PI_BASE_URL='https://old.example/v1'\nfunction Read-Host { param($Prompt,[switch]$AsSecureString); if ($AsSecureString) { throw 'Unexpected key prompt' } }\ntry {\n${script}\n} catch { Write-Host 'EXPECTED_FAILURE' }\nif ($env:PI_API_KEY -ne 'previous' -or $env:PI_BASE_URL -ne 'https://old.example/v1') { throw 'Environment not restored' }\n`;
    const file=path.join(dir,'test.ps1'); await fs.writeFile(file,harness);
    const result=spawnSync('powershell.exe',['-NoProfile','-File',file],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.status,0,result.stderr);
    assert.ok(!result.stdout.includes('lr-SYNTHETIC_CANARY'));
    if(fail){assert.match(result.stdout,/\[KEY\]/);assert.match(result.stdout,/EXPECTED_FAILURE/);}
    else {assert.match(result.stdout,/PAYLOAD_OK/);assert.doesNotMatch(result.stdout,/EXPECTED_FAILURE/);}
  }
});
