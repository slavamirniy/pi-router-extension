import {buttonRows,centered} from './buttons.mjs';
import {mouseEvent} from './menu.mjs';
import {acquireMouse} from './mouse.mjs';
export async function requestExit(ctx,confirm){
 if(!ctx.isIdle())return;
 if(await confirm() && ctx.isIdle())ctx.shutdown();
}
export function createExitDialog({tui,done,palette:p,truncate,measure,matchesKey,background}){
 let focus=1,targets=[],size='',disposed=false;
 const release=acquireMouse(tui.terminal);
 const close=value=>{if(disposed)return;disposed=true;release();done(value);};
 return {invalidate(){},dispose(){if(!disposed){disposed=true;release();}},render(width){
  const height=tui.terminal.rows;size=`${width}:${height}`;targets=[];
  const paint=(text,w,bg=p.sidebar,fg=p.text)=>{const value=truncate(text,w,'');return `\x1b[48;2;${bg}m\x1b[38;2;${fg}m`+value+' '.repeat(Math.max(0,w-measure(value)))+'\x1b[0m';};
  const rows=background?.(width)??Array(height).fill(paint('',width,p.canvas));
  const w=Math.min(60,width),left=Math.floor((width-w)/2),top=Math.max(0,Math.floor((height-11)/2));
  const put=(y,text)=>{if(y<height)rows[y]=truncate(rows[y],left,'')+paint(text,w)+paint('',Math.max(0,width-left-w),p.canvas);};
  for(let n=0;n<11;n++)put(top+n,'│'+' '.repeat(Math.max(0,w-2))+'│');
  put(top,'╭'+'─'.repeat(Math.max(0,w-2))+'╮');
  put(top+2,'│'+centered('Вы действительно хотите выйти?',w-2,truncate,measure)+'│');
  put(top+4,'│'+centered('Текущий разговор останется в истории.',w-2,truncate,measure)+'│');
  put(top+10,'╰'+'─'.repeat(Math.max(0,w-2))+'╯');
  const bw=Math.max(4,Math.floor((w-8)/2)),x=left+3,y=top+6;
  ['Выйти','Отмена'].forEach((label,i)=>{
   const bx=x+i*(bw+2),bg=i===0?p.errorBg:focus===1?p.selection:p.button,fg=i===0?p.error:p.text;
   const button=buttonRows(label,bw,truncate,measure);
   for(let n=0;n<3&&y+n<height;n++){
    const before=truncate(rows[y+n],bx,'');
    const tail=' '.repeat(Math.max(0,left+w-bx-bw-1))+'│';
    rows[y+n]=before+paint((focus===i&&n===1?'\x1b[1m':'')+button[n]+'\x1b[22m',bw,bg,fg)+paint(tail,Math.max(0,left+w-bx-bw))+paint('',Math.max(0,width-left-w),p.canvas);
   }
   targets.push({x:bx,y,w:bw,h:3,value:i===0});
  });
  return rows;
 },handleInput(data){
  if(disposed)return;const mouse=mouseEvent(data);
  if(mouse){if(size!==`${tui.terminal.columns}:${tui.terminal.rows}`){tui.requestRender();return;}if(mouse.press&&mouse.button===0){const hit=targets.find(t=>mouse.x>=t.x&&mouse.x<t.x+t.w&&mouse.y>=t.y&&mouse.y<t.y+t.h);if(hit)close(hit.value);}}
  else if(matchesKey(data,'escape'))close(false);
  else if(['tab','shift+tab','left','right'].some(key=>matchesKey(data,key)))focus=1-focus;
  else if(matchesKey(data,'enter'))close(focus===0);
  tui.requestRender();
 }};
}
