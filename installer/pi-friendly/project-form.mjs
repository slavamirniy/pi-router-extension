import {buttonRows,navigationRows} from './buttons.mjs';
import {mouseEvent,clean} from './menu.mjs';
import {acquireMouse} from './mouse.mjs';
import {validateProjectName} from './projects.mjs';
export function createProjectForm({tui,done,palette:p,makeInput,truncate,measure,matchesKey}){
 const input=makeInput();input.focused=true;let error='',focus=0,targets=[],size='',disposed=false;
 const release=acquireMouse(tui.terminal);
 const close=value=>{if(disposed)return;disposed=true;release();done(value);};
 const submit=()=>{try{close(validateProjectName(input.getValue()));}catch(e){error=e.message;tui.requestRender();}};
 input.onSubmit=submit;input.onEscape=()=>close(undefined);
 return {dispose(){if(!disposed){disposed=true;release();}},invalidate(){input.invalidate?.();},render(width){
  const h=tui.terminal.rows;size=`${tui.terminal.columns}:${h}`;targets=[];
  const paint=(s,w,bg=p.canvas,fg=p.text)=>{s=truncate(s,w,'');return `\x1b[48;2;${bg}m\x1b[38;2;${fg}m`+s+' '.repeat(Math.max(0,w-measure(s)))+'\x1b[0m';};
  const rows=Array(h).fill(paint('',width));const w=Math.max(8,Math.min(64,width-6)),left=Math.max(0,Math.floor((width-w)/2));
  const put=(y,s,bg=p.canvas,fg=p.text)=>{if(y>=0&&y<h)rows[y]=paint('',left)+paint(s,w,bg,fg)+paint('',Math.max(0,width-left-w));};
  if(h<14||width<26){put(1,'Увеличьте окно · Esc — отмена');return rows;}
  const top=Math.max(3,h-12);
  put(top,'Новый проект',p.canvas,p.accent);
  put(top+1,'Будет создана отдельная папка.',p.canvas,p.muted);
  put(top+3,'Название проекта');
  put(top+4,'╭'+'─'.repeat(w-2)+'╮',p.canvas,focus===0?p.accent:p.border);
  put(top+5,'│ '+input.render(w-4)[0]+' │',p.sidebar);
  put(top+6,'╰'+'─'.repeat(w-2)+'╯',p.canvas,focus===0?p.accent:p.border);
  put(top+7,error?'Название: до 60 символов, без / \\ : * ?':'Например: Сайт пекарни',p.canvas,error?p.error:p.muted);
  const y=top+8,half=Math.floor((w-2)/2);
  const primary=buttonRows('Создать проект',half,truncate,measure),secondary=buttonRows('Отмена',w-half-2,truncate,measure);
  for(let n=0;n<3;n++)rows[y+n]=paint('',left)+paint(primary[n],half,p.accent,p.onAccent)+paint('',2)+paint(secondary[n],w-half-2,focus===2?p.selection:p.button,focus===2?p.accent:p.text)+paint('',width-left-w);
  if(focus===1)rows[y+1]=rows[y+1].replace('Создать проект','\x1b[1mСоздать проект\x1b[22m');
  targets=[{x:left,y:top+4,w,h:3,run:()=>{focus=0;input.focused=true;}},{x:left,y,w:half,h:3,run:submit},{x:left+half+2,y,w:w-half-2,h:3,run:()=>close(undefined)}];
  const nav=navigationRows(width,p,truncate,measure);
  nav.rows.forEach((row,y)=>rows[y]=row);
  targets.push({x:width-nav.width-2,y:0,w:nav.width,h:3,run:()=>close(undefined)});
  return rows;
 },handleInput(data){if(disposed)return;const mouse=mouseEvent(data);
  if(mouse){if(size!==`${tui.terminal.columns}:${tui.terminal.rows}`){tui.requestRender();return;}if(mouse.press&&mouse.button===0)targets.find(t=>mouse.x>=t.x&&mouse.x<t.x+t.w&&mouse.y>=t.y&&mouse.y<t.y+t.h)?.run();}
  else if(matchesKey(data,'escape'))close(undefined);
  else if(matchesKey(data,'tab')||matchesKey(data,'shift+tab')){focus=(focus+(matchesKey(data,'tab')?1:2))%3;input.focused=focus===0;}
  else if(matchesKey(data,'enter')&&focus!==0){if(focus===1)submit();else close(undefined);}
  else if(focus===0){error='';input.handleInput(data);}
  tui.requestRender();
 }};
}
