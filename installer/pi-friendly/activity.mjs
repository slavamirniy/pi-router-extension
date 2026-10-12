import {clean} from './menu.mjs';
export function activityLabel(name,args={}) {
 const file=clean(args.path||args.file_path||'').split(/[\\/]/).filter(Boolean).at(-1);
 const suffix=file?' · '+file:'';
 if(name==='write')return 'Создаю файл'+suffix;
 if(name==='edit')return 'Обновляю файл'+suffix;
 if(name==='read')return 'Читаю файл'+suffix;
 if(name==='bash'){
  const command=String(args.command||'');
  if(/\b(test|vitest|pytest|jest)\b/.test(command))return 'Запускаю тесты';
  if(/\b(build|tsc)\b/.test(command))return 'Проверяю сборку';
  if(/\b(install|add|ci)\b/.test(command)&&/\b(npm|pnpm|yarn|bun)\b/.test(command))return 'Устанавливаю зависимости';
  return 'Выполняю команду';
 }
 return 'Выполняю действие · '+clean(name);
}
export function startActivity(steps,event,now=Date.now()) {
 return [...steps.filter(s=>s.id!==event.toolCallId),{id:event.toolCallId,label:activityLabel(event.toolName,event.args),status:'running',started:now}].slice(-30);
}
export function finishActivity(steps,event,now=Date.now()) {
 return steps.map(step=>step.id===event.toolCallId?{...step,status:event.isError?'error':'done',ended:now}:step);
}
