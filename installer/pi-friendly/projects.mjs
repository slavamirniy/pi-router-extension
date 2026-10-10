import {mkdirSync,realpathSync,statSync,readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname,basename,isAbsolute} from 'node:path';
export function folderKey(path){const value=resolve(path);return process.platform==='win32'?value.toLowerCase():value;}
export function validateProjectName(value){
 const name=String(value??'').trim();
 if(!name||name.length>60||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^\.+$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw new Error('Введите название до 60 символов, без символов / \\ : * ? и без точки в конце.');
 return name;
}
export function projectCatalog(sessions,registered=[],current){
 const groups=new Map();
 for(const p of registered)groups.set(folderKey(p.cwd),{...p,chats:[]});
 // A launch directory or a historical chat is not an explicit project choice.
 for(const session of sessions){if(!session.cwd)continue;groups.get(folderKey(session.cwd))?.chats.push(session);}
 for(const p of groups.values())p.chats.sort((a,b)=>+new Date(b.modified)-+new Date(a.modified));
 return [...groups.values()].sort((a,b)=>Number(folderKey(b.cwd)===folderKey(current||'.'))-Number(folderKey(a.cwd)===folderKey(current||'.'))||(+new Date(b.chats[0]?.modified||0)-+new Date(a.chats[0]?.modified||0))||a.name.localeCompare(b.name));
}
export function createProjectStore({root,registry,SessionManager,sessionDir}){
 root=resolve(root);
 const list=()=>{try{const map=new Map();for(const line of readFileSync(registry,'utf8').split('\n')){try{const p=JSON.parse(line);if(p.name&&p.cwd)map.set(folderKey(p.cwd),p);}catch{}}return [...map.values()];}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 const register=cwd=>{const actual=realpathSync(cwd);if(!statSync(actual).isDirectory())throw new Error('Выберите папку, а не файл.');const p={name:basename(actual),cwd:actual};mkdirSync(dirname(registry),{recursive:true});appendFileSync(registry,JSON.stringify(p)+'\n','utf8');return p;};
 const isProject=cwd=>{try{const actual=realpathSync(cwd);return folderKey(actual)!==folderKey(root)&&list().some(p=>folderKey(p.cwd)===folderKey(actual))&&statSync(actual).isDirectory();}catch{return false;}};
 return {root,list,isProject,isHub:cwd=>folderKey(cwd)===folderKey(root),
  create(value){const name=validateProjectName(value);mkdirSync(root,{recursive:true});for(let i=1;i<10000;i++){const cwd=join(root,name+(i===1?'':` (${i})`));try{mkdirSync(cwd);}catch(e){if(e.code==='EEXIST')continue;throw e;}return register(cwd);}throw new Error('Не удалось подобрать свободное имя папки.');},
  attach(value){const cwd=String(value??'').trim().replace(/^"(.*)"$/,'$1');if(!isAbsolute(cwd))throw new Error('Укажите полный путь к папке.');return register(cwd);},
  name(cwd){return list().find(p=>folderKey(p.cwd)===folderKey(cwd))?.name||basename(cwd)||cwd;},
  createChat(cwd){if(!isProject(cwd))throw new Error('Сначала создайте или выберите проект.');const actual=realpathSync(cwd);if(!statSync(actual).isDirectory())throw new Error('Папка проекта недоступна.');const manager=SessionManager.create(actual,sessionDir);const file=manager.getSessionFile();if(!file)throw new Error('Не удалось создать разговор.');writeFileSync(file,JSON.stringify(manager.getHeader())+'\n',{encoding:'utf8',flag:'wx'});return file;},
 };
}
