import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Read only after the user explicitly chooses Paste; never poll the clipboard.
export async function readClipboardText({platform=process.platform,execute=run}={}){
 const commands=platform==='win32'?[['powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $text = Get-Clipboard -Raw; if ($null -ne $text) { [Console]::Write($text) }']]]:platform==='darwin'?[['/usr/bin/pbpaste',[]]]:[['wl-paste',['--no-newline']],['xclip',['-selection','clipboard','-o']],['xsel',['--clipboard','--output']]];
 for(const [file,args] of commands){try{return (await execute(file,args,{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:8*1024*1024})).stdout;}catch{}}
 throw new Error('Не удалось прочитать буфер обмена. Используйте сочетание вставки вашего терминала.');
}
