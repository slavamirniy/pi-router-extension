export function hoverRows(rows,targets,pointer,slice,measure){
 if(!pointer||!slice)return rows;
 const target=targets.find(t=>pointer.x>=t.x&&pointer.x<(t.end??t.x+t.w)&&pointer.y>=t.y&&pointer.y<t.y+(t.h??1));if(!target)return rows;
 const width=target.w??target.end-target.x;
 return rows.map((row,y)=>{if(y<target.y||y>=target.y+(target.h??1))return row;const middle=slice(row,target.x,width).replace(/\x1b\[48;2;(\d+);(\d+);(\d+)m/g,(_,r,g,b)=>'\x1b[48;2;'+[r,g,b].map(v=>Math.round(Number(v)*.9)).join(';')+'m');return slice(row,0,target.x)+'\x1b[0m'+middle+'\x1b[0m'+slice(row,target.x+width,Math.max(0,measure(row)-target.x-width))+'\x1b[0m';});
}
