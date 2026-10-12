import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function createModelPreference(path){
 return {read(){try{const m=JSON.parse(readFileSync(path,'utf8'));return typeof m.id==='string'&&typeof m.provider==='string'?m:undefined;}catch{return undefined;}},save(model){if(!model?.id||!model?.provider)return;mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({id:model.id,provider:model.provider}),'utf8');},resolve(models){const saved=this.read();return models.find(m=>m.id===saved?.id&&m.provider===saved?.provider);}};
}
