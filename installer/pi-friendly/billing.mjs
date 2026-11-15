import {randomUUID} from 'node:crypto';
import {appendFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {legal,telegramURL,validConsent} from './legal.mjs';
export function createBilling({getConnection,receiptFile,fetcher=fetch}){
 let state={access:'loading',account:null,stale:true,legal,telegramURL},pending,stopped=false;
 const listeners=new Set(),emit=()=>{for(const f of listeners)f(state);};
 async function request(path,data,id){
  const {baseURL,apiKey}=await getConnection();const u=new URL(baseURL);
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Небезопасный адрес сервиса.');
  if(u.username||u.password||u.search||u.hash||!apiKey)throw Error('Подключение роутера не настроено.');
  const endpoint=u.href.replace(/\/v1\/?$/,'').replace(/\/$/,'')+'/router/'+path;
  const r=await fetcher(endpoint,{method:data===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',...(id?{'Idempotency-Key':id}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)});
  if(r.status===404&&path==='purchases/offers')return {offers:[],test:false};
  let v;try{v=await r.json();}catch{throw Error('Сервис вернул некорректный ответ.');}
  if(!r.ok){const code=v?.error?.code;if(code==='invalid_api_key')state={...state,access:'key_expired',stale:true};else if(code==='insufficient_quota')state={...state,access:'empty'};else if(code==='subscription_expired')state={...state,access:'expired'};emit();throw Error(code==='payments_unavailable'?'Пополнение пока не подключено.':code==='invalid_api_key'?'Обновите доступ через Telegram.':'Не удалось связаться с сервисом. Попробуйте ещё раз.');}return v;
 }
 const refresh=()=>pending??=(async()=>{try{const a=await request('account');state={...state,account:a,stale:false,access:a.expires&&a.expires<=Date.now()?'expired':Number(a.available)<=0?'empty':'ready'};}catch{state={...state,stale:true};}finally{pending=null;if(!stopped)emit();}return state;})();
 return {snapshot:()=>state,subscribe(f){listeners.add(f);return()=>listeners.delete(f);},refresh,
  offers:()=>request('purchases/offers'),
  async buy({plan,id=randomUUID(),consent}){if(!validConsent(consent))throw Error('Отметьте оба согласия перед оплатой.');if(!/^[A-Za-z0-9_-]{16,80}$/.test(id))throw Error('Некорректный номер запроса.');
   if(receiptFile){await mkdir(dirname(receiptFile),{recursive:true});await appendFile(receiptFile,JSON.stringify({requestId:id,acceptedAt:new Date().toISOString(),offer:true,personalData:true,documents:legal})+'\n',{mode:0o600});}
   const o=await request('purchases',{plan_id:plan},id);if(o.checkout_url){const u=new URL(o.checkout_url);if(u.protocol!=='https:'||u.hostname!=='orders.cloudpayments.ru')throw Error('Сервис вернул неизвестный адрес оплаты.');}return o;},
  async order(id){if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Некорректный заказ.');const o=await request('purchases/'+id);if(o.status==='paid')await refresh();return o;},
  dispose(){stopped=true;listeners.clear();}
 };
}
