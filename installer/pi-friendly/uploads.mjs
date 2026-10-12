const SAFE=/^[\p{L}\p{N}][\p{L}\p{N} _.\-()]{0,180}$/u;
export function sanitizeUploadName(value){
 let name=String(value??'').trim().replace(/[\\/]+/g,'_').replace(/[\x00-\x1f]/g,'').replace(/^\.+/,'');
 if(!name||name==='.'||name==='..')return null;
 if(!SAFE.test(name))name=name.replace(/[^\p{L}\p{N} _.\-()]/gu,'_').slice(0,181);
 if(!name||/^[.\s]*$/.test(name))return null;
 return name;
}
