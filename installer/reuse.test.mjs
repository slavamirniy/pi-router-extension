import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

test('Windows keeps an already installed different PI version without invoking npm', {skip:process.platform!=='win32'}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-reuse-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const pi=path.join(dir,'pi.cmd');await fs.writeFile(pi,'@echo off\r\necho 9.9.9\r\nexit /b 0\r\n');
  const script=await fs.readFile(new URL('./install-pi-windows.ps1',import.meta.url),'utf8');
  const functions=script.slice(script.indexOf('function Install-OrUpdatePi {'),script.indexOf("if ($env:PI_SKIP_INSTALL"));
  const testScript=`$ErrorActionPreference='Stop'\n$PackageVersion='0.84.4'\n$UserNpmPrefix='unused'\nfunction Write-Step($Message) {}\nfunction Write-Ok($Message) { Write-Output $Message }\nfunction Add-UserPathEntry($Entry) {}\nfunction Refresh-ProcessPath {}\nfunction Get-NpmCommand { @{Source='npm-must-not-run'} }\nfunction Get-PiCommand { @{Source=$env:TEST_PI} }\n${functions}\nInstall-OrUpdatePi\n`;
  const file=path.join(dir,'test.ps1');await fs.writeFile(file,testScript);
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file],{encoding:'utf8',windowsHide:true,env:{...process.env,TEST_PI:pi},timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Using installed Pi 9\.9\.9/);
});

test('Bash keeps an already installed different PI version without invoking npm',async()=>{
  const script=await fs.readFile(new URL('./install-pi-linux.sh',import.meta.url),'utf8');
  const fn=script.match(/install_or_update_pi\(\) \{[\s\S]*?\n\}/)[0];
  const command=`set -eu\npi(){ echo 9.9.9; }\nnpm(){ echo NPM_MUST_NOT_RUN >&2; return 99; }\nok(){ echo "$1"; }\nstep(){ :; }\n${fn}\ninstall_or_update_pi`;
  const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
  const result=spawnSync(bash,['-c',command],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Using installed Pi 9\.9\.9/);
});
