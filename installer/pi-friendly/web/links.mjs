export function safeLink(value) {
 if(typeof value!=='string'||/[\x00-\x20\x7f]/.test(value))return null;
 try{const u=new URL(value.startsWith('www.')?'https://'+value:value);return ['http:','https:','mailto:'].includes(u.protocol)?u.href:null;}catch{return null;}
}
function trimURL(value){
 let s=value.replace(/[.,!?;:]+$/,'');
 while((s.endsWith(')')&&(s.match(/\)/g)||[]).length>(s.match(/\(/g)||[]).length)||(s.endsWith(']')&&(s.match(/\]/g)||[]).length>(s.match(/\[/g)||[]).length))s=s.slice(0,-1);
 return s;
}
export function inlineParts(text){
 const re=/`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)|<(?:https?:\/\/|mailto:)[^<>\s]+>|(?:https?:\/\/|www\.)[^\s<>"`]+/gi;
 const parts=[];let last=0;
 for(const m of text.matchAll(re)){
  if(m.index>last)parts.push({type:'text',text:text.slice(last,m.index)});
  const t=m[0];let used=t.length;
  if(t.startsWith('`'))parts.push({type:'code',text:t.slice(1,-1)});
  else if(t.startsWith('**'))parts.push({type:'strong',text:t.slice(2,-2)});
  else {const label=m[1];const raw=m[2]??(t.startsWith('<')?t.slice(1,-1):trimURL(t));const url=safeLink(raw);
   if(!label&&!t.startsWith('<'))used=raw.length;
   parts.push(url?{type:'link',text:label??raw,url}:{type:'text',text:t});
  }
  last=m.index+used;
 }
 if(last<text.length)parts.push({type:'text',text:text.slice(last)});
 return parts;
}

export function safeTerminalLinks(line){
 return line.replace(/\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g,(_all,url)=>`\x1b]8;;${url?(safeLink(url)||''):''}\x07`);
}
