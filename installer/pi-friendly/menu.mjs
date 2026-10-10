import {centered,navigationRows,buttonRows} from './buttons.mjs';
import { acquireMouse } from "./mouse.mjs";
// A full-width, top-left overlay: mouse coordinates never depend on chat scrollback.
export function clean(value) {
  return String(value ?? "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

export function mouseEvent(data) {
  const m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
  return m ? { button: Number(m[1]), x: Number(m[2]) - 1, y: Number(m[3]) - 1, press: m[4] === "M" } : undefined;
}

export function createMenu({ tui, theme, done, title, subtitle = "", items, statuses = () => [], searchable = false, truncate, measure, matchesKey, palette, panel = false, bottom = false, layout = 'cards' }) {
  let query = "", selected = 0, offset = 0, targets = [], dimensions = "", disposed = false;
  const terminal = tui.terminal;
  // Save and restore terminal mouse modes; only capture mouse while this dialog is open.
  const releaseMouse = acquireMouse(terminal);
  const backItem=panel||layout==='list'?items.find(item=>item.kind==='back'):undefined;
  const isAction=item=>item.kind==='primary'||item.kind==='action';
  const filtered = () => items.filter(item => item!==backItem).filter(item => layout==='list'&&isAction(item)||clean(`${item.label} ${item.description ?? ""}`).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const close = value => { if (!disposed) { component.dispose(); done(value); } };
  const component = {
    invalidate() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseMouse();
    },
    render(width) {
      const height = Math.max(1, terminal.rows);
      dimensions = `${terminal.columns}:${terminal.rows}`;
      targets = [];
      const line = text => truncate(text, Math.max(1, width), "");
      if (height < 9 || width < 24) return [line("Увеличьте окно. Esc — назад.")];
      if(layout==='list') {
        const p=palette, fg=(text,color)=>p?`\x1b[38;2;${color}m${text}\x1b[39m`:text;
        const paint=(text,w,selected=false)=>{
          const fitted=truncate(text,w,'');
          const row=fitted+' '.repeat(Math.max(0,w-measure(fitted)));
          return p?`\x1b[48;2;${selected?p.selection||p.bubble:p.canvas}m`+fg(row,p.text)+'\x1b[0m':row;
        };
        const cw=Math.min(80,width-4),left=Math.floor((width-cw)/2),rows=Array(height).fill(paint('',width));
        const put=(y,text,selected=false)=>{if(y>=0&&y<height)rows[y]=paint('',left)+paint(text,cw,selected)+paint('',width-left-cw);};
        const color=(text,key)=>fg(text,p?.[key]);
        const list=filtered(),actions=list.filter(isAction),entries=list.filter(item=>!isAction(item));
        selected=Math.min(selected,Math.max(0,list.length-1));
        put(0,color(clean(title),'accent'));
        const close='× Закрыть',closeX=width-11;
        rows[1]=paint(backItem?'  ← Все проекты':'',closeX)+paint(close,11);
        targets.push({y:1,x:closeX,end:width,index:-1});
        if(backItem)targets.push({y:1,x:0,end:Math.min(closeX,18),index:-2});
        const compact=height<16;
        if(!compact)put(3,color(clean(subtitle),'muted'));
        let y=compact?2:5;
        for(const action of actions){
          const index=list.indexOf(action);
          put(y,color((selected===index?'› ':'  ')+clean(action.label),'accent'),selected===index);
          targets.push({y,x:left,end:left+cw,index});y++;
        }
        if(searchable)put(y++,color('Поиск: '+(query||'название или папка…'),'muted'));
        const start=y,step=!compact&&height-start>=6?2:1,capacity=Math.max(1,Math.floor((height-start-2)/step));
        const entryIndex=Math.max(0,selected-actions.length);
        offset=Math.max(0,Math.min(offset,Math.max(0,entries.length-capacity)));
        if(selected>=actions.length){if(entryIndex<offset)offset=entryIndex;if(entryIndex>=offset+capacity)offset=entryIndex-capacity+1;}
        for(let i=offset;i<Math.min(entries.length,offset+capacity);i++){
          const item=entries[i],index=list.indexOf(item),active=index===selected,row=start+(i-offset)*step;
          put(row,(active?'› ':'  ')+clean(item.label)+(item.current?' · текущий':''),active);
          if(step===2)put(row+1,color('  '+clean(item.description),'muted'),active);
          for(let n=0;n<step;n++)targets.push({y:row+n,x:left,end:left+cw,index});
        }
        if(!entries.length)put(start,color(query?'Ничего не найдено':'Список пока пуст','muted'));
        put(height-1,color('↑↓ выбор · Enter открыть · Esc закрыть'+(entries.length>capacity?` · ${Math.min(entryIndex+1,entries.length)}/${entries.length}`:''),'muted'));
        return rows;
      }
      if(panel && palette) {
        const p=palette, fg=(text,color=p.text)=>`\x1b[38;2;${color}m${text}\x1b[39m`;
        const paint=(text,w,bg=p.canvas)=>`\x1b[48;2;${bg}m`+fg(truncate(text,w,''))+' '.repeat(Math.max(0,w-measure(truncate(text,w,''))))+'\x1b[0m';
        const rows=Array(height).fill(paint('',width));
        const cw=Math.min(72,width-6),left=Math.max(2,Math.floor((width-cw)/2));
        const put=(y,text,bg=p.canvas)=>{if(y<height)rows[y]=paint('',left)+paint(text,cw,bg)+paint('',width-left-cw);};
        const nav=navigationRows(width,p,truncate,measure);
        nav.rows.forEach((row,y)=>{rows[y]=row;targets.push({y,x:width-nav.width-2,end:width-2,index:-1});});
        if(backItem){
          const bw=Math.min(20,width-nav.width-6),back=buttonRows('← Все проекты',bw,truncate,measure);
          // Rebuild both controls explicitly so ANSI byte lengths never determine placement.
          back.forEach((row,y)=>{rows[y]=paint('  ',2)+paint(row,bw,p.button)+paint('',width-bw-nav.width-4)+paint(buttonRows('× Закрыть',nav.width,truncate,measure)[y],nav.width,p.button)+paint('  ',2);targets.push({y,x:2,end:2+bw,index:-2});});
        }
        const list=filtered();selected=Math.min(selected,Math.max(0,list.length-1));
        const step=height>=18?5:1,capacity=Math.max(1,Math.floor((height-10)/step));
        const shift=bottom?Math.max(0,height-10-Math.min(list.length,capacity)*step):0;
        put(3+shift,fg(clean(title),p.accent));
        put(4+shift,fg(clean(subtitle),p.muted));
        put(6+shift,searchable?'Поиск: '+(query||'начните печатать…'):'Выберите действие');
        offset=Math.max(0,Math.min(offset,Math.max(0,list.length-capacity)));
        if(selected<offset)offset=selected;
        if(selected>=offset+capacity)offset=selected-capacity+1;
        for(let i=offset;i<Math.min(list.length,offset+capacity);i++){
          const y=8+shift+(i-offset)*step,item=list[i];
          const primary=item.kind==='primary',bg=primary?p.accent:i===selected?(p.selection||p.bubble):item.kind==='back'?p.button:p.sidebar;
          const color=primary?p.onAccent:p.text;
          if(step===5){
            put(y,fg('╭'+'─'.repeat(cw-2)+'╮',color),bg);
            put(y+1,fg('│'+centered(clean(item.label),cw-2,truncate,measure)+'│',color),bg);
            put(y+2,fg('│'+centered(clean(item.description||'Нажмите, чтобы выбрать'),cw-2,truncate,measure)+'│',primary?p.onAccent:p.muted),bg);
            put(y+3,fg('╰'+'─'.repeat(cw-2)+'╯',color),bg);
          }else put(y,fg(centered(clean(item.label),cw,truncate,measure),color),bg);
          for(let n=0;n<(step===5?4:1);n++)targets.push({y:y+n,x:left,end:left+cw,index:i});
        }
        if(!list.length)put(8,'Ничего не найдено');
        put(height-2,fg('↑↓ выбор · Enter открыть · Esc закрыть'+(list.length>capacity?` · ${selected+1}/${list.length}`:''),p.muted));
        return rows;
      }
      const contentWidth = Math.min(width - 4, searchable ? 76 : 48);
      const left = Math.max(2, Math.floor((width - contentWidth) / 2));
      const inset = " ".repeat(left);
      const rows = [line(inset + theme.fg("accent", theme.bold(clean(title)))), line(inset + theme.fg("muted", truncate(clean(subtitle), contentWidth, "")))];
      rows.push(line(inset + (searchable ? `Поиск: ${query || "начните печатать…"}` : "Выберите действие")), "");
      const list = filtered();
      selected = Math.min(selected, Math.max(0, list.length - 1));
      const cardHeight = !searchable && height >= 16 ? 2 : 1;
      const capacity = Math.max(1, Math.floor((height - 8) / cardHeight));
      offset = Math.max(0, Math.min(offset, Math.max(0, list.length - capacity)));
      if (selected < offset) offset = selected;
      if (selected >= offset + capacity) offset = selected - capacity + 1;
      for (let i = offset; i < Math.min(list.length, offset + capacity); i++) {
        const item = list[i];
        const paint = text => {
          const fitted = centered(text.trim(), contentWidth, truncate, measure);
          const padded = fitted + " ".repeat(Math.max(0, contentWidth - measure(fitted)));
          return inset + theme.bg(i === selected ? "selectedBg" : "userMessageBg", i === selected ? theme.fg("accent", theme.bold(padded)) : padded);
        };
        for (let n = 0; n < cardHeight; n++) targets.push({ y: rows.length + n, x: left, end: left + contentWidth, index: i });
        rows.push(paint(` ${clean(item.label)}${cardHeight === 1 && item.description ? " · " + clean(item.description) : ""}`));
        if (cardHeight === 2) {
          rows.push(paint(`   ${clean(item.description || "Нажмите, чтобы открыть")}`));
        }
      }
      if (!list.length) rows.push(line("  Ничего не найдено. Backspace — изменить поиск."));
      rows.push("", line(inset + theme.fg("muted", `Мышь · ↑↓ · Enter · Esc${list.length > capacity ? ` · ${selected + 1}/${list.length}` : ""}`)));
      rows.push(line(inset + theme.fg("muted", clean(statuses().join(" · ")))));
      const back = "  Назад к разговору  ";
      targets.push({ y: rows.length, x: left, end: Math.min(width, left + measure(back)), index: -1 });
      rows.push(line(inset + theme.bg("userMessageBg", back)));
      // Occupy the whole viewport so scrollback growth cannot shift hit targets,
      // and the underlying conversation does not leak through the menu.
      while (rows.length < height) rows.push("");
      return rows.slice(0, height).map(row => {
        if (!palette) return row;
        const base=`\x1b[48;2;${palette.canvas}m\x1b[38;2;${palette.text}m`;
        return base+row.replace(/\x1b\[(?:0)?m/g,base).replace(/\x1b\[39m/g,`\x1b[38;2;${palette.text}m`).replace(/\x1b\[49m/g,`\x1b[48;2;${palette.canvas}m`)+" ".repeat(Math.max(0,width-measure(row)))+"\x1b[0m";
      });
    },
    handleInput(data) {
      if (disposed) return;
      const list = filtered();
      const mouse = mouseEvent(data);
      if (mouse) {
        if (!mouse.press) return;
        if (dimensions !== `${terminal.columns}:${terminal.rows}`) { tui.requestRender(); return; }
        if (mouse.button === 64 || mouse.button === 65) selected = Math.max(0, Math.min(list.length - 1, selected + (mouse.button === 64 ? -1 : 1)));
        else if (mouse.button === 0) {
          const hit = targets.find(t => t.y === mouse.y && mouse.x >= t.x && mouse.x < t.end);
          if (hit) close(hit.index === -1 ? undefined : hit.index === -2 ? backItem : list[hit.index]);
        }
      } else if (matchesKey(data, "escape")) close(undefined);
      else if (matchesKey(data, "up") || matchesKey(data, "shift+tab")) selected = (selected - 1 + list.length) % (list.length || 1);
      else if (matchesKey(data, "down") || matchesKey(data, "tab")) selected = (selected + 1) % (list.length || 1);
      else if (matchesKey(data, "enter")) { if (list[selected]) close(list[selected]); }
      else if (searchable && matchesKey(data, "backspace")) { query = [...query].slice(0, -1).join(""); offset=0;selected=layout==='list'&&query?filtered().filter(isAction).length:0; }
      else if (searchable && data && !/[\x00-\x1f\x7f-\x9f]/.test(data)) { query = (query + data).slice(0, 120); offset=0;selected=layout==='list'?filtered().filter(isAction).length:0; }
      tui.requestRender();
    },
  };
  return component;
}
