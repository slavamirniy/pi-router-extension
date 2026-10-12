// Map native editor rendering back to source offsets, anchored at its public cursor.
const marker='\x1b_pi:c\x07';
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export function cursorOffset(editor){const c=editor.getCursor?.();return c?editor.getText().split('\n').slice(0,c.line).reduce((n,s)=>n+s.length+1,0)+c.col:0;}
export function editorMap(editor,rendered){
 const source=editor.getText(),padding=editor.getPaddingX?.()??0;
 const raw=rendered.map(s=>s.replace(/\x1b\[[0-9;]*m/g,'').slice(padding));
 const rows=raw.map(s=>({text:s.replace(marker,'').trimEnd(),start:0}));
 let anchor=raw.findIndex(s=>s.includes(marker));
 if(anchor<0)anchor=0;
 if(!rows.length)return [];
 rows[anchor].start=raw[anchor].includes(marker)?Math.max(0,cursorOffset(editor)-raw[anchor].indexOf(marker)):Math.max(0,source.indexOf(rows[anchor].text));
 for(let i=anchor-1;i>=0;i--){const end=rows[i+1].start;rows[i].start=rows[i].text?source.lastIndexOf(rows[i].text,Math.max(0,end-rows[i].text.length)):Math.max(0,end-1);}
 for(let i=anchor+1;i<rows.length;i++){const start=rows[i-1].start+rows[i-1].text.length;rows[i].start=rows[i].text?source.indexOf(rows[i].text,start):Math.min(source.length,start+(source[start]==='\n'?1:0));}
 return rows.map(row=>({...row,start:Math.max(0,row.start),padding}));
}
export function offsetAt(row,column,measure){
 if(!row)return 0;
 let cells=row.padding,offset=0;
 for(const {segment} of segmenter.segment(row.text)){const width=measure(segment);if(cells+width/2>column)break;cells+=width;offset+=segment.length;}
 return row.start+offset;
}
export function moveCursor(editor,target){
 // Use host navigation, preserving its paste markers, history and undo state.
 for(let n=0;n<=editor.getText().length+1;n++){
  const before=cursorOffset(editor);if(before===target)return;
  editor.handleInput(before<target?'\x1b[C':'\x1b[D');
  const after=cursorOffset(editor);if(after===before||(before<target&&after>target)||(before>target&&after<target))return;
 }
}
export function createSelection(editor){
 let range,source;
 const get=()=>{if(source!==editor.getText())range=undefined;return range;};
 return {get,clear(){range=undefined;},set(a,b){source=editor.getText();range=[Math.min(a,b),Math.max(a,b)];},
 text(){const r=get();return r?editor.getText().slice(...r):'';},
 remove(){const r=get();range=undefined;if(!r||r[0]===r[1])return false;moveCursor(editor,r[1]);while(cursorOffset(editor)>r[0]){const before=cursorOffset(editor);editor.handleInput('\x7f');if(cursorOffset(editor)===before)break;}return true;}
 };
}
