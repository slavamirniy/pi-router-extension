import {spawn} from 'node:child_process';
export async function pickProjectFolder({platform=process.platform,spawnProcess=spawn}={}){
 const windowsScript="[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = 'Выберите папку проекта'; $picker.ShowNewFolderButton = $true; try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($picker.SelectedPath) } } finally { $picker.Dispose() }";
 const commands=platform==='win32'?[['powershell.exe',['-NoProfile','-STA','-Command',windowsScript]]]:platform==='darwin'?[['osascript',['-e','POSIX path of (choose folder with prompt "Выберите папку проекта")']]]:[['zenity',['--file-selection','--directory','--title=Выберите папку проекта']],['kdialog',['--getexistingdirectory','.','--title','Выберите папку проекта']]];
 for(const [command,args] of commands){try{return await new Promise((resolve,reject)=>{
  const child=spawnProcess(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks=[],errors=[];let finished=false;
  const finish=(error,path)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(path);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Выбор папки закрыт по тайм-ауту. Попробуйте снова.'));},300000);timer.unref?.();
  child.stdout.on('data',data=>chunks.push(data));child.stderr.on('data',data=>errors.push(data));
  child.once('error',error=>finish(error));child.once('close',code=>{const err=Buffer.concat(errors).toString('utf8');if(code===0)finish(null,Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'')||undefined);else if(/-128|cancel/i.test(err)||code===1&&platform!=='win32'&&!err.trim())finish(null,undefined);else finish(new Error('Не удалось открыть выбор папки. '+err.trim().slice(0,500)));});
 });}catch(error){if(error.code!=='ENOENT')throw error;}}
 throw new Error('Для выбора папки установите системный диалог zenity или kdialog.');
}
