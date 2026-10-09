import {centered,buttonRows} from './buttons.mjs';
import { clean, mouseEvent } from './menu.mjs';
import { activityLabel } from './activity.mjs';
import {explainError,wrapText} from './errors.mjs';
// Rasterize centered bars into Braille's four vertical dots per terminal row.
// A single dot column keeps bars thin; empty history stays on the left.
export function voiceWaveform(levels=[],width=0,height=3){
 const columns=Math.max(0,Math.floor(width)),rows=Math.max(1,Math.floor(height)),pixels=rows*4;
 const recent=columns?levels.slice(-columns):[],samples=Array(Math.max(0,columns-recent.length)).fill(0).concat(recent);
 const bits=[1,2,4,64];
 return Array.from({length:rows},(_,row)=>samples.map(value=>{
  const level=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
  const bar=level<.025?0:Math.max(1,Math.round(Math.pow(level,1.5)*pixels));
  const top=Math.ceil((pixels-bar)/2),bottom=top+bar;
  let mask=0;
  for(let dy=0;dy<4;dy++){const y=row*4+dy;if(bar?y>=top&&y<bottom:y===Math.floor(pixels/2))mask|=bits[dy];}
  return mask?String.fromCharCode(0x2800+mask):' ';
 }).join(''));
}
export const palettes = {
 light:{canvas:'255;255;255',sidebar:'242;245;247',text:'31;41;51',muted:'79;92;105',button:'237;241;243',selection:'215;232;250',accent:'0;112;110',onAccent:'255;255;255',bubble:'226;241;242',border:'158;179;190',error:'157;35;42',errorBg:'255;237;237'},
 dark:{canvas:'26;29;33',sidebar:'33;38;43',text:'239;243;247',muted:'177;188;199',button:'49;58;65',selection:'39;73;106',accent:'117;223;185',onAccent:'18;39;31',bubble:'41;59;54',border:'96;115;128',error:'255;186;186',errorBg:'67;36;40'},
};
export function chatMessages(ctx, live) {
 const branch=ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
 const messages=branch.filter(e=>e.type==='message').map(e=>e.message);
 if(live && !messages.some(m=>m===live || (m.role===live.role && m.timestamp===live.timestamp))) messages.push(live);
 else if(live) {const index=messages.findLastIndex(m=>m.role===live.role&&m.timestamp===live.timestamp);if(index>=0)messages[index]=live;}
 return messages.filter(m=>m.role==='user'||m.role==='assistant'||m.role==='toolResult'||(m.role==='custom'&&m.display!==false));
}
export function messageText(message) {
 if(typeof message.content==='string')return message.content;
 return (message.content??[]).filter(c=>c.type==='text'||c.type==='image').map(c=>c.type==='image'?'[Прикреплено изображение]':c.text).join('\n');
}
export function createSurface({tui,delegate,rendering,ctx,actions,state}) {
 let targets=[],dimensions='',scroll=0;
 const {truncate,measure}=rendering;
 const safeText=text=>String(text??'').split('\n').map(clean).join('\n');
 function render(width) {
  const height=tui.terminal.rows,s=state(),p=palettes[s.scheme]??palettes.light;
  dimensions=`${width}:${height}`;targets=[];
  const paint=(text,w,bg=p.canvas,fg=p.text)=>{
   const base=`\x1b[48;2;${bg}m\x1b[38;2;${fg}m`;
   const value=truncate(text,w,'');return base+value.replace(/\x1b\[(?:0)?m/g,base).replace(/\x1b\[39m/g,`\x1b[38;2;${fg}m`).replace(/\x1b\[49m/g,`\x1b[48;2;${bg}m`)+' '.repeat(Math.max(0,w-measure(value)))+'\x1b[0m';
  };
  if(width<44||height<12)return [paint('Увеличьте окно. F2 — меню.',width),...Array(Math.max(0,height-1)).fill(paint('',width))];
  const side=width>=100?26:18,main=width-side,pad=2,cw=main-2*pad;
  const left=Array(height).fill(paint('',side,p.sidebar));
  const right=Array(height).fill(paint('',main));
  const put=(y,text,bg=p.canvas,fg=p.text)=>{if(y>=0&&y<height)right[y]=paint('',pad)+paint(text,cw,bg,fg)+paint('',main-pad-cw);};
  const bold=text=>`\x1b[1m${text}\x1b[22m`;
  const center=(text,w)=>' '.repeat(Math.max(0,Math.floor((w-measure(text))/2)))+text;
  left[1]=paint('  '+bold('Просто pi'),side,p.sidebar,p.text);
  const button=(y,label,run,primary=false,danger=false,disabled=false)=>{
   if(y<3||y+2>=height-2)return;
   const w=side-4,bg=disabled?p.button:danger?p.errorBg:primary?(s.paneOpen?p.selection:p.bubble):p.sidebar,fg=disabled?p.muted:danger?p.error:primary?(s.paneOpen?p.text:p.accent):p.text;
   const rows=buttonRows(label,w,truncate,measure);
   for(let dy=0;dy<3;dy++)left[y+dy]=paint('  ',2,p.sidebar)+paint(rows[dy],w,bg,fg)+paint('  ',2,p.sidebar);
   if(!disabled)targets.push({x:2,y,w,h:3,run});
  };
  if(height>=18)button(4,s.paneOpen?(side<24?'← В чат':'Вернуться к чату'):side<24?'Новый чат':'Новый разговор',actions.newChat,true);
  if(height>=23)button(8,'Проекты',actions.history);
  const utilities=[['Модель',actions.model],[s.scheme==='dark'?'Светлая тема':'Тёмная тема',actions.theme]];
  if(height>=27)utilities.forEach(([label,run],i)=>button(12+i*4,label,run));
  else if(height>=23)button(12,'Ещё',actions.more);
  else if(height>=18)button(height-11,'Ещё',actions.more);
  button(height-7,'Выйти',actions.exit,false,true,!ctx.isIdle());
  left[height-3]=paint('  '+clean(ctx.model?.name||ctx.model?.id||'Выберите модель'),side,p.sidebar,p.muted);
  const quota=(s.statuses??[]).find(v=>/осталось|quota|remaining/i.test(clean(v)));
  if(quota)left[height-2]=paint('  '+clean(quota),side,p.sidebar,p.muted);
  put(1,s.needsProject?'Ваши проекты':s.projectName?'Проект: '+clean(s.projectName):chatMessages(ctx,s.live).length?'Разговор':'Новый разговор',p.canvas,p.muted);
  const send=ctx.isIdle()?(delegate.getText().startsWith('/')?'Выполнить':'Отправить ↑'):'Остановить';
  const voice=s.voice,voiceHint=(s.voiceHintUntil??0)>Date.now(),voiceBusy=['starting','recording','transcribing'].includes(voice?.phase);
  const sendW=measure(send)+4,enabled=!ctx.isIdle()||(!voiceBusy&&Boolean(delegate.getText().trim()));
  const sendHeight=height>=20?3:1,inlineSend=cw>=40;
  const micLabel=voice?.phase==='recording'?'██':'🎤';
  const micW=voice?(sendHeight===3?6:4):0;
  const micEnabled=Boolean(voice)&&(['installing','downloading','loading','error'].includes(voice.phase)||(ctx.isIdle()||voice.phase==='recording')&&['ready','recording'].includes(voice.phase));
  const extra=voiceHint&&!voiceBusy?2:0;
  const editorWidth=Math.max(4,cw-4-(inlineSend?sendW+2+(micW?micW+1:0):0));
  let editorAll=delegate.render(editorWidth);
  const rule=line=>/^[─━╌┄\s]+$/.test(clean(line));
  if(editorAll.length>=3&&rule(editorAll[0])&&rule(editorAll.at(-1)))editorAll=editorAll.slice(1,-1);
  const editorLimit=Math.min(5,Math.max(1,height-10-extra-(inlineSend?0:micW?sendHeight:0)));
  const cursorLine=editorAll.findIndex(line=>line.includes("\x1b_pi:c\x07"));
  const editorStart=Math.min(Math.max(0,cursorLine-editorLimit+2),Math.max(0,editorAll.length-editorLimit));
  const editorLines=editorAll.slice(editorStart,editorStart+editorLimit);
  const innerHeight=extra+(inlineSend?Math.max(editorLines.length,sendHeight):editorLines.length+sendHeight+(micW?sendHeight:0));
  const editorTop=height-innerHeight-4;
  const actionY=editorTop+1+(inlineSend?innerHeight-sendHeight:extra+editorLines.length+(micW?sendHeight:0));
  const micY=inlineSend?actionY:actionY-sendHeight;
  put(editorTop,'╭'+'─'.repeat(cw-2)+'╮',p.canvas,p.border);
  for(let i=0;i<innerHeight;i++){
   const y=editorTop+1+i,hasSend=y>=actionY&&y<actionY+sendHeight,hasMic=micW&&y>=micY&&y<micY+sendHeight;
   if(i<extra){
    const label=i===0?'← Для голосового ввода':'дождитесь загрузки голосовой модели';
    put(y,'│ '+centered(label,cw-4,truncate,measure)+' │',p.canvas,p.accent);continue;
   }
   const contentWidth=inlineSend?editorWidth:cw-4-(hasSend?sendW:hasMic?micW:0);
   const contentHeight=inlineSend?innerHeight:editorLines.length;
   const voiceRow=Math.floor(contentHeight/2);
   let text=(editorLines[i-extra]??'').replace(/\x1b\[[0-9;]*m/g,'');
   if(voiceBusy){
    text='';
    if(voice.phase==='recording')text=voiceWaveform(voice.levels,contentWidth,contentHeight)[i]??'';
    else if(i===voiceRow)text=centered(voice.phase==='transcribing'?`Распознаю · ${Math.round(voice.percent??0)}%`:'Включаю микрофон…',contentWidth,truncate,measure);
   }
   const sendButton=hasSend?paint(sendHeight===3?buttonRows(send,sendW,truncate,measure)[y-actionY]:centered(send,sendW,truncate,measure),sendW,enabled?p.accent:p.button,enabled?p.onAccent:p.muted):inlineSend?paint('',sendW):'';
   const micButton=hasMic?paint(sendHeight===3?buttonRows(micLabel,micW,truncate,measure)[y-micY]:centered(micLabel,micW,truncate,measure),micW,voice.phase==='recording'?p.errorBg:p.button,micEnabled?(voice.phase==='recording'?p.error:p.text):p.muted):inlineSend&&micW?paint('',micW):'';
   const middle=inlineSend?paint(text,editorWidth,p.canvas,voiceBusy?p.accent:p.text)+paint('',2)+(micW?micButton+paint('',1):'')+sendButton:paint(text,cw-4-(hasSend?sendW:hasMic?micW:0))+micButton+sendButton;
   right[y]=paint('',pad)+paint('│ ',2,p.canvas,p.border)+middle+paint(' │',2,p.canvas,p.border)+paint('',main-pad-cw);
  }
  if(micW&&micEnabled)targets.push({x:inlineSend?side+pad+cw-sendW-micW-3:side+pad+cw-micW-2,y:micY,w:micW,h:sendHeight,run:actions.voice});
  if(enabled)targets.push({x:side+pad+cw-sendW-2,y:actionY,w:sendW,h:sendHeight,run:ctx.isIdle()?actions.submit:()=>ctx.abort()});
  put(editorTop+innerHeight+1,'╰'+'─'.repeat(cw-2)+'╯',p.canvas,p.border);
  if(!delegate.getText())put(editorTop-1,'Сообщение',p.canvas,p.muted);
  let info=s.notice||s.activity||'';
  const widgetLines=[];
  for(const widget of s.widgets??[]) {try {widgetLines.push(...(Array.isArray(widget)?widget:widget.render(cw)));}catch{}}
  if(widgetLines.length && !s.notice)info=clean(widgetLines.at(-1));
  if(info)put(editorTop-1,truncate(clean(info),cw,''),p.canvas,s.notice?p.accent:p.muted);
  if(voice?.phase==='recording'){const seconds=Math.floor(voice.seconds??0);put(editorTop-1,`● ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Enter — закончить запись`,p.canvas,p.accent);}
  if(voice&&['installing','downloading','loading','error'].includes(voice.phase)){
   const pct=Number.isFinite(voice.percent)?` ${voice.percent}%`:'';
   const sideLabel=voice.phase==='error'?'Повторить голос':voice.phase==='downloading'?'Модель'+pct:voice.label||'Подготовка голоса';
   const sy=height-8,voiceBg=voiceHint?p.selection:p.sidebar;if(sy>=3)left[sy]=paint('  '+sideLabel,side,voiceBg,voiceHint?p.text:voice.phase==='error'?p.error:p.muted);
   if(height>=31&&Number.isFinite(voice.percent)){
    const fill=Math.max(0,Math.min(10,Math.round(voice.percent/10)));left[sy-1]=paint('  '+'━'.repeat(fill)+'─'.repeat(10-fill),side,voiceBg,p.accent);
   }
   if(voice.phase==='error'&&sy>=3){
    targets.push({x:2,y:sy,w:side-4,h:1,run:actions.voice});
    if(height>=31)left[sy-1]=paint('  '+clean(voice.error||'Ошибка загрузки'),side,voiceBg,p.error);
   }
  }
  const status=(s.statuses??[]).filter(v=>v!==quota).map(clean).join(' · ');
  if(status)put(height-1,truncate(status,cw,''),p.canvas,p.muted);
  const messages=chatMessages(ctx,s.live),last=messages.at(-1);
  const failure=s.error || (last?.role==='assistant' && (last.errorMessage||last.stopReason==='error') ? {raw:last.errorMessage||'Сервис завершил запрос с ошибкой'} : undefined);
  const items=failure?[]:s.suggestions??[];
  const count=Math.min(items.length,5,Math.max(0,editorTop-5));
  let contentBottom=editorTop-2;
  if(count){
   const start=Math.max(0,s.selected-count+1);contentBottom-=count+1;
   for(let n=0;n<count;n++) {
    const item=items[start+n],y=contentBottom+1+n,label=' /'+clean(item.label).replace(/^\//,'');
    put(y,truncate(label+'  '+clean(item.description),cw,''),start+n===s.selected?p.bubble:p.sidebar);
    targets.push({x:side+pad,y,w:cw,h:1,run:()=>actions.complete(item)});
   }
  }
  if(failure){
   const friendly=explainError(failure.raw,failure.kind),space=Math.max(3,editorTop-3);
   const detailLines=wrapText(friendly.help,cw-4),titleLines=wrapText('! '+friendly.title,cw-4);
   const body=[...titleLines,...detailLines];
   const lines=body.slice(0,Math.max(1,space-2)),top=editorTop-lines.length-3;
   lines.forEach((line,n)=>put(top+n,'  '+line,p.errorBg,p.error));
   const label=' Подробнее › ',y=top+lines.length;
   put(y,centered(label,cw,truncate,measure),p.errorBg,p.error);
   targets.push({x:side+pad,y,w:cw,h:1,run:()=>actions.errorDetails?.(failure.raw)});
   contentBottom=top-1;
  }
  let content=[],previousRole;
  const results=new Map(messages.filter(m=>m.role==='toolResult').map(m=>[m.toolCallId,m]));
  for(const message of messages){
   if(message.role==='toolResult')continue;
   const tools=Array.isArray(message.content)?message.content.filter(c=>c.type==='toolCall'):[];
   const text=messageText(message);
   if(!text.trim() && !tools.length && !message.errorMessage)continue;
   const user=message.role==='user',blockWidth=user?Math.max(12,Math.floor(cw*.8)):cw;
   const inset=user?cw-blockWidth:0;
   if(user||previousRole!==message.role)content.push({text:user?'Вы':'Помощник',muted:true,inset,blockWidth});
   previousRole=message.role;
   const lines=rendering.markdown?rendering.markdown(safeText(text),blockWidth-4,p):safeText(text).split('\n').flatMap(l=>wrapText(l,blockWidth-4));
   if(text){
    for(const line of lines)content.push({text:'  '+line,user,inset,blockWidth,card:true});
   }
   for(const call of tools){
    const result=results.get(call.id),step=(s.steps??[]).find(step=>step.id===call.id);
    const status=result?(result.isError?'error':'done'):step?.status;
    const marker=status==='done'?'✓':status==='error'?'!':status==='running'?'◌':'·';
    const args=call.arguments??{};
    let label=activityLabel(call.name,args);
    if(status==='done')label=label.replace('Создаю файл','Файл записан').replace('Обновляю файл','Файл изменён').replace('Читаю файл','Файл прочитан');
    const file=clean(args.path||args.file_path||'');
    if(file)label=label.replace(file.split(/[\\/]/).at(-1),file);
    if(call.name==='write'&&typeof args.content==='string')label+=' · строк: '+args.content.replace(/\n$/,'').split('\n').length;
    for(const row of wrapText(marker+' '+label,cw-4))content.push({text:'  '+row,card:true,tool:true,error:status==='error'});
   }
   if(message.errorMessage)content.push({text:'! '+explainError(message.errorMessage).title,error:true});
   content.push({text:''});
  }
  const capacity=Math.max(0,contentBottom-3);
  scroll=Math.min(scroll,Math.max(0,content.length-capacity));
  const start=Math.max(0,content.length-capacity-scroll);
  if(!content.length && !failure && editorTop>7){const y=Math.max(4,Math.floor(editorTop/2)-1);put(y,center(bold(s.needsProject?'С чего начнём?':'Чем могу помочь?'),cw));put(y+2,center(s.needsProject?'Новый проект — отдельная папка для вашей задачи.':'Напишите, что хотите сделать.',cw),p.canvas,p.muted);}
  content.slice(start,start+capacity).forEach((line,n)=>{const inset=line.inset??0,w=line.blockWidth??cw;right[3+n]=paint('',pad+inset)+paint(line.text,w,line.error?p.errorBg:line.card?(line.user?p.bubble:p.sidebar):p.canvas,line.error?p.error:line.tool?p.accent:line.muted?p.muted:p.text)+paint('',main-pad-inset-w);});
  if(scroll>0)put(2,'↑ История · прокрутите вниз к новым сообщениям',p.canvas,p.muted);
  return left.map((line,i)=>line+right[i]);
 }
 return {render,invalidate(){},navigate(data){const e=mouseEvent(data);const hit=e&&targets.find(t=>e.x>=t.x&&e.x<t.x+t.w&&e.y>=t.y&&e.y<t.y+t.h);return hit?.run();},onMouse(data){
  const event=mouseEvent(data);if(!event)return false;
  if(dimensions!==`${tui.terminal.columns}:${tui.terminal.rows}`){tui.requestRender();return true;}
  if(event.press&&event.button===0){const hit=targets.find(t=>event.x>=t.x&&event.x<t.x+t.w&&event.y>=t.y&&event.y<t.y+t.h);if(hit)void hit.run();}
  if(event.press&&(event.button===64||event.button===65))scroll=Math.max(0,scroll+(event.button===64?3:-3));
  tui.requestRender();return true;
 },resetScroll(){scroll=0;}};
}
