import {mouseEvent,clean} from './menu.mjs';
import {centered} from './buttons.mjs';
import {acquireMouse} from './mouse.mjs';
export function createModelPicker({tui,models,current,done,palette:p,background,truncate,measure,sliceByColumn,matchesKey}){
 let selected=Math.max(0,models.findIndex(m=>m.id===current?.id&&m.provider===current?.provider)),offset=0,targets=[],disposed=false,pointer,size='';
 const release=acquireMouse(tui.terminal);
 const close=value=>{if(disposed)return;disposed=true;release();done(value);};
 return{invalidate(){},dispose(){if(!disposed){disposed=true;release();}},render(width){
  const height=tui.terminal.rows,side=width>=100?26:18;
  size=`${width}:${height}`;targets=[];
  const w=Math.min(40,width-side-4),x=side+2;
  const capacity=Math.max(1,Math.min(models.length,6,Math.floor((height-7)/3))),h=capacity*3+3,y=Math.max(0,height-h-3);
  if(selected<offset)offset=selected;if(selected>=offset+capacity)offset=selected-capacity+1;
  const rows=background(width);
  const paint=(text,bg=p.sidebar,color=p.text)=>{const value=truncate(text,w,'');return `\x1b[48;2;${bg}m\x1b[38;2;${color}m`+value+' '.repeat(Math.max(0,w-measure(value)))+'\x1b[0m';};
  const put=(row,text,bg,color)=>{rows[row]=truncate(rows[row],x,'')+'\x1b[0m'+paint(text,bg,color)+sliceByColumn(rows[row],x+w,width-x-w)+'\x1b[0m';};
  put(y,centered('Модель',w,truncate,measure),p.button,p.muted);
  for(let i=offset;i<Math.min(models.length,offset+capacity);i++){
   const m=models[i],row=y+1+(i-offset)*3,active=i===selected,hover=pointer&&pointer.x>=x&&pointer.x<x+w&&pointer.y>=row&&pointer.y<row+3;
   const chosen=m.id===current?.id&&m.provider===current?.provider;
   const bg=hover?p.selection:active?p.bubble:p.sidebar;
   put(row,'',bg);
   const duplicate=models.some(other=>other!==m&&(other.name||other.id)===(m.name||m.id));
   put(row+1,centered(clean(m.name||m.id)+(duplicate?' · '+clean(m.provider):'')+(chosen?' ✓':''),w,truncate,measure),bg,active?p.accent:p.text);
   put(row+2,'',bg);
   targets.push({x,y:row,w,h:3,model:m});
  }
  put(y+h-2,'',p.sidebar);put(y+h-1,centered('↑↓ · Enter выбрать · Esc закрыть',w,truncate,measure),p.button,p.muted);
  return rows.map(row=>row.replace(/\x1b_pi:c\x07/g,''));
 },handleInput(data){
  if(disposed)return;const e=mouseEvent(data);
  if(e){if(e.button===35){pointer=e;tui.requestRender();return;}if(size!==`${tui.terminal.columns}:${tui.terminal.rows}`){tui.requestRender();return;}if(e.press&&e.button===0){const hit=targets.find(t=>e.x>=t.x&&e.x<t.x+t.w&&e.y>=t.y&&e.y<t.y+t.h);close(hit?.model);return;}if(e.press&&(e.button===64||e.button===65))selected=Math.max(0,Math.min(models.length-1,selected+(e.button===64?-1:1)));}
  else if(matchesKey(data,'escape')){close();return;}
  else if(matchesKey(data,'enter')){close(models[selected]);return;}
  else if(matchesKey(data,'up')||matchesKey(data,'shift+tab'))selected=(selected-1+models.length)%models.length;
  else if(matchesKey(data,'down')||matchesKey(data,'tab'))selected=(selected+1)%models.length;
  tui.requestRender();
 }};
}
