import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export function usesUiModel(ctx, args=process.argv.slice(2)){
 return ctx.mode==='tui' && !args.some(arg=>/^(?:--(?:model|models|provider|session|session-id|continue|resume)|-[cr])(?:=|$)/.test(arg));
}

export function installModelPreference(pi,preference,args=process.argv.slice(2)){
 const preferred=ctx=>usesUiModel(ctx,args)?preference.resolve(ctx.modelRegistry.getAvailable()):undefined;
 pi.on('model_select',(event,ctx)=>{
  if(usesUiModel(ctx,args)&&event.source!=='restore')preference.save(event.model);
 });
 pi.on('session_start',async(event,ctx)=>{
  if(event.reason && event.reason!=='startup')return;
  const model=preferred(ctx);
  if(model&&(model.id!==ctx.model?.id||model.provider!==ctx.model?.provider))await pi.setModel(model);
 });
 return preferred;
}
export function createModelPreference(path){
 return {read(){try{const m=JSON.parse(readFileSync(path,'utf8'));return typeof m.id==='string'&&typeof m.provider==='string'?m:undefined;}catch{return undefined;}},save(model){if(!model?.id||!model?.provider)return;mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({id:model.id,provider:model.provider}),'utf8');},resolve(models){const saved=this.read();return models.find(m=>m.id===saved?.id&&m.provider===saved?.provider);}};
}
