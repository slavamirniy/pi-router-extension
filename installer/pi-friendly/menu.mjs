import {hoverRows} from './hover.mjs';
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

export function createMenu({ tui, theme, done, title, subtitle = "", items, statuses = () => [], searchable = false, truncate, measure, matchesKey, palette, panel = false, bottom = false, layout = 'cards', sliceByColumn }) {
  let pointer;
  let searchOpen=layout!=="list", query = "", selected = 0, offset = 0, targets = [], dimensions = "", disposed = false;
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
          return p?`\x1b[48;2;${selected===true?p.bubble:selected==='card'?p.sidebar:p.canvas}m`+fg(row,p.text)+'\x1b[0m':row;
        };
        const cw=Math.min(64,width-4),left=Math.floor((width-cw)/2),rows=Array(height).fill(paint('',width));
        const put=(y,text,selected=false)=>{if(y>=0&&y<height)rows[y]=paint('',left)+paint(text,cw,selected)+paint('',width-left-cw);};
        const color=(text,key)=>fg(text,p?.[key]);
        const list=filtered(),actions=list.filter(isAction),entries=list.filter(item=>!isAction(item));
        selected=Math.min(selected,Math.max(0,list.length-1));
        const compact=height<16;
        const nav=p?navigationRows(width,p,truncate,measure):{width:12,rows:buttonRows('× Закрыть',12,truncate,measure).map(row=>' '.repeat(width-14)+row+'  ')};
        nav.rows.forEach((row,n)=>rows[n]=row);
        targets.push({y:0,h:3,x:width-nav.width-2,end:width-2,index:-1});
        if(backItem){const bw=Math.min(20,width-nav.width-4);buttonRows('← Все проекты',bw,truncate,measure).forEach((row,n)=>{rows[n]=paint(row,bw,'card')+paint('',width-bw-nav.width-2)+paint(buttonRows('× Закрыть',nav.width,truncate,measure)[n],nav.width,'card')+paint('',2);});targets.push({y:0,h:3,x:0,end:bw,index:-2});}
        put(3,color(centered(clean(title),cw,truncate,measure),'accent'));
        if(!compact)put(5,color(centered(clean(subtitle),cw,truncate,measure),'muted'));
        let y=compact?4:7;
        for(const action of actions.filter(item=>!item.toolbar)){
          const index=list.indexOf(action);
          put(y,color((selected===index?'› ':'  ')+clean(action.label),'accent'),selected===index);
          targets.push({y,x:left,end:left+cw,index});y+=compact?1:2;
        }
        const toolbar=actions.find(item=>item.toolbar);
        if(toolbar||searchable){
          const bh=compact?1:3,sw=searchable?(compact?2:6):0,bw=toolbar?Math.min(22,cw-sw):0,bx=left+cw-sw-bw,index=toolbar?list.indexOf(toolbar):-1;
          for(let n=0;n<bh;n++){
            const mid=n===Math.floor(bh/2),glass=mid?centered('🔍',sw,truncate,measure):' '.repeat(sw),label=mid&&toolbar?centered(clean(toolbar.label),bw,truncate,measure):' '.repeat(bw);
            rows[y+n]=paint('',bx)+paint(glass,sw,searchOpen?true:'card')+paint(label,bw,index===selected?true:'card')+paint('',width-bx-sw-bw);
          }
          if(searchable)targets.push({y,x:bx,end:bx+sw,index:-3,h:bh});
          if(toolbar)for(let n=0;n<bh;n++)targets.push({y:y+n,x:bx+sw,end:bx+sw+bw,index});
          if(searchable)for(let n=1;n<bh;n++)targets.push({y:y+n,x:bx,end:bx+sw,index:-3});
          y+=bh;
          if(searchOpen&&searchable)put(y++,color('Поиск: '+(query||'начните печатать…'),'muted'));
        }
        const start=y+(compact?0:1),step=!compact&&height-y>=10?5:3,capacity=Math.max(1,Math.floor((height-start-2)/step));
        const entryIndex=Math.max(0,selected-actions.length);
        offset=Math.max(0,Math.min(offset,Math.max(0,entries.length-capacity)));
        if(selected>=actions.length){if(entryIndex<offset)offset=entryIndex;if(entryIndex>=offset+capacity)offset=entryIndex-capacity+1;}
        for(let i=offset;i<Math.min(entries.length,offset+capacity);i++){
          const item=entries[i],index=list.indexOf(item),active=index===selected,row=start+(i-offset)*step;
          const hovered=pointer&&pointer.x>=left&&pointer.x<left+cw&&pointer.y>=row&&pointer.y<row+3;
          const bg=active||hovered?true:'card';
          const label=clean(item.label)+(item.current?' · текущий':'');
          buttonRows(label,cw,truncate,measure).forEach((text,n)=>put(row+n,text,bg));
          if(step===5)put(row+3,color(centered(clean(item.description),cw,truncate,measure),'muted'));
          targets.push({y:row,h:step===5?4:3,x:left,end:left+cw,index});
        }
        if(!entries.length)put(start,color(query?'Ничего не найдено':'Список пока пуст','muted'));
        put(height-1,color('↑↓ выбор · Enter открыть · Ctrl+F поиск · Esc закрыть'+(entries.length>capacity?` · ${Math.min(entryIndex+1,entries.length)}/${entries.length}`:''),'muted'));
        return rows;
      }
      if(panel && palette && layout==='billing') {
        const p=palette;
        const paint=(text,w,bg=p.canvas,color=p.text)=>{
          const value=truncate(text,Math.max(0,w),'');
          return `\x1b[48;2;${bg}m\x1b[38;2;${color}m${value}`+' '.repeat(Math.max(0,w-measure(value)))+'\x1b[0m';
        };
        const rows=Array(height).fill(paint('',width));
        const cw=Math.min(48,width-4),left=Math.floor((width-cw)/2);
        const put=(y,text,bg=p.canvas,color=p.text)=>{if(y>=0&&y<height)rows[y]=paint('',left)+paint(text,cw,bg,color)+paint('',width-left-cw);};
        const nav=navigationRows(width,p,truncate,measure);
        nav.rows.forEach((row,y)=>rows[y]=row);
        targets.push({y:0,h:3,x:width-nav.width-2,end:width-2,index:-1});
        put(4,centered(clean(title),cw,truncate,measure),p.canvas,p.accent);
        put(6,centered(clean(subtitle),cw,truncate,measure),p.canvas,p.muted);
        const list=filtered();selected=Math.min(selected,Math.max(0,list.length-1));
        const start=height<18?8:9,step=height<18?4:5;
        const capacity=Math.max(1,Math.floor((height-start-1)/step));
        offset=Math.max(0,Math.min(offset,Math.max(0,list.length-capacity)));
        if(selected<offset)offset=selected;
        if(selected>=offset+capacity)offset=selected-capacity+1;
        for(let i=offset;i<Math.min(list.length,offset+capacity);i++){
          const item=list[i],y=start+(i-offset)*step,active=i===selected;
          const hovered=pointer&&pointer.x>=left&&pointer.x<left+cw&&pointer.y>=y&&pointer.y<y+3;
          const base=active?p.bubble:p.button;
          const bg=hovered?base.split(';').map(v=>Math.round(Number(v)*.94)).join(';'):base;
          buttonRows(clean(item.label),cw,truncate,measure).forEach((row,n)=>put(y+n,row,bg,active?p.accent:p.text));
          targets.push({y,h:3,x:left,end:left+cw,index:i});
          if(item.description)put(y+3,centered(clean(item.description),cw,truncate,measure),p.canvas,p.muted);
        }
        put(height-1,centered('↑↓ выбрать · Enter · Esc закрыть'+(list.length>capacity?` · ${selected+1}/${list.length}`:''),cw,truncate,measure),p.canvas,p.muted);
        return rows;
      }
      if(panel && palette) {
        const p=palette, fg=(text,color=p.text)=>`\x1b[38;2;${color}m${text}\x1b[39m`;
        const paint=(text,w,bg=p.canvas)=>`\x1b[48;2;${bg}m`+fg(truncate(text,w,''))+' '.repeat(Math.max(0,w-measure(truncate(text,w,''))))+'\x1b[0m';
        const rows=Array(height).fill(paint('',width));
        const cw=Math.min(layout==='billing'?48:72,width-6),left=Math.max(2,Math.floor((width-cw)/2));
        const put=(y,text,bg=p.canvas)=>{if(y<height)rows[y]=paint('',left)+paint(text,cw,bg)+paint('',width-left-cw);};
        const nav=navigationRows(width,p,truncate,measure);
        nav.rows.forEach((row,y)=>{rows[y]=row;targets.push({y,x:width-nav.width-2,end:width-2,index:-1});});
        if(backItem){
          const bw=Math.min(20,width-nav.width-6),back=buttonRows('← Все проекты',bw,truncate,measure);
          // Rebuild both controls explicitly so ANSI byte lengths never determine placement.
          back.forEach((row,y)=>{rows[y]=paint('  ',2)+paint(row,bw,p.button)+paint('',width-bw-nav.width-4)+paint(buttonRows('× Закрыть',nav.width,truncate,measure)[y],nav.width,p.button)+paint('  ',2);targets.push({y,x:2,end:2+bw,index:-2});});
        }
        const list=filtered();selected=Math.min(selected,Math.max(0,list.length-1));
        const step=layout==='billing'?(height>=14?3:2):height>=18?5:1,capacity=Math.max(1,Math.floor((height-10)/step));
        const shift=bottom?Math.max(0,height-10-Math.min(list.length,capacity)*step):0;
        put(3+shift,fg(clean(title),p.accent));
        put(4+shift,fg(clean(subtitle),p.muted));
        if(layout!=='billing')put(6+shift,searchable?'Поиск: '+(query||'начните печатать…'):'Выберите действие');
        offset=Math.max(0,Math.min(offset,Math.max(0,list.length-capacity)));
        if(selected<offset)offset=selected;
        if(selected>=offset+capacity)offset=selected-capacity+1;
        for(let i=offset;i<Math.min(list.length,offset+capacity);i++){
          const y=8+shift+(i-offset)*step,item=list[i];
          const primary=item.kind==='primary',bg=primary?p.accent:i===selected?(p.selection||p.bubble):item.kind==='back'?p.button:p.sidebar;
          const color=primary?p.onAccent:p.text;
          if(layout==='billing'){put(y,fg(centered(clean(item.label),cw,truncate,measure),color),bg);put(y+1,fg(centered(clean(item.description||''),cw,truncate,measure),p.muted),bg);}else if(step===5){
            put(y,fg('┌'+'─'.repeat(cw-2)+'┐',color),bg);
            put(y+1,fg('│'+centered(clean(item.label),cw-2,truncate,measure)+'│',color),bg);
            put(y+2,fg('│'+centered(clean(item.description||'Нажмите, чтобы выбрать'),cw-2,truncate,measure)+'│',primary?p.onAccent:p.muted),bg);
            put(y+3,fg('└'+'─'.repeat(cw-2)+'┘',color),bg);
          }else put(y,fg(centered(clean(item.label),cw,truncate,measure),color),bg);
          for(let n=0;n<(layout==='billing'?2:step===5?4:1);n++)targets.push({y:y+n,x:left,end:left+cw,index:i});
        }
        if(!list.length)put(8,'Ничего не найдено');
        put(height-2,fg('↑↓ выбор · Enter · Esc закрыть'+(list.length>capacity?` · ${selected+1}/${list.length}`:''),p.muted));
        return hoverRows(rows,targets,pointer,sliceByColumn,measure);
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
        if(mouse.button===35){pointer=mouse;tui.requestRender();return;}
        if (!mouse.press) return;
        if (dimensions !== `${terminal.columns}:${terminal.rows}`) { tui.requestRender(); return; }
        if (mouse.button === 64 || mouse.button === 65) selected = Math.max(0, Math.min(list.length - 1, selected + (mouse.button === 64 ? -1 : 1)));
        else if (mouse.button === 0) {
          const hit = targets.find(t => mouse.y >= t.y && mouse.y < t.y+(t.h??1) && mouse.x >= t.x && mouse.x < t.end);
          if(hit?.index===-3){searchOpen=!searchOpen;query="";selected=0;offset=0;tui.requestRender();return;}
          if (hit) close(hit.index === -1 ? undefined : hit.index === -2 ? backItem : list[hit.index]);
        }
      } else if(searchable&&matchesKey(data,"ctrl+f")){searchOpen=!searchOpen;query="";selected=0;offset=0;}
      else if (matchesKey(data, "escape")) {if(searchOpen&&layout==="list"){searchOpen=false;query="";selected=0;offset=0;}else close(undefined);}
      else if (matchesKey(data, "up") || matchesKey(data, "shift+tab")) selected = (selected - 1 + list.length) % (list.length || 1);
      else if (matchesKey(data, "down") || matchesKey(data, "tab")) selected = (selected + 1) % (list.length || 1);
      else if (matchesKey(data, "enter")) { if (list[selected]) close(list[selected]); }
      else if (searchable && searchOpen && matchesKey(data, "backspace")) { query = [...query].slice(0, -1).join(""); offset=0;selected=layout==='list'&&query?filtered().filter(isAction).length:0; }
      else if (searchable && searchOpen && data && !/[\x00-\x1f\x7f-\x9f]/.test(data)) { query = (query + data).slice(0, 120); offset=0;selected=layout==='list'?filtered().filter(isAction).length:0; }
      tui.requestRender();
    },
  };
  return component;
}
