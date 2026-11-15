import {randomUUID} from 'node:crypto';
import {createMenu,clean} from './menu.mjs';
// The pane exists before networking starts; Escape always remains available.
export function createBillingPanel(options){
 const {billing,openExternal=()=>{},done,tui}=options;
 let inner,closed=false,epoch=0,timer,offers=[],selected,offerConsent=false,personalConsent=false,requestId;
 const tokens=n=>Number.isFinite(Number(n))?Math.max(0,Number(n)).toLocaleString('ru-RU')+' токенов':'Баланс уточняется';
 const balance=()=>{const b=billing.snapshot();return b.account?'Доступно: '+tokens(b.account.available):'Баланс пока неизвестен';};
 const price=o=>(o.price_kopecks/100).toLocaleString('ru-RU')+' ₽';
 const summary=o=>tokens(o.tokens)+' · '+Math.round(o.duration_seconds/86400)+' дн.';
 function close(){if(closed)return;closed=true;++epoch;clearTimeout(timer);inner?.dispose();done();}
 function show(title,subtitle,items){if(closed)return;inner?.dispose();inner=createMenu({...options,title,subtitle,searchable:false,layout:'billing',panel:true,statuses:()=>[],items:[...items,{id:'close',label:'Вернуться к чату',description:'Проект и переписка сохранятся'}],done:item=>{if(!item||item.id==='close'){close();return;}void act(item);}});tui.requestRender();}
 async function pending(title,run,success,retry){const id=++epoch;show(title,balance(),[]);
  try{const result=await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Сервис не ответил вовремя.')),15000);})]);if(closed||id!==epoch)return;clearTimeout(timer);success(result);}
  catch(e){if(closed||id!==epoch)return;clearTimeout(timer);show('Не удалось загрузить оплату',clean(e.message),[{id:retry,label:'Попробовать снова',description:'Повторить запрос к сервису'}]);}
 }
 function catalogue(){show('Пополнить баланс',balance(),offers.map(o=>({id:'plan',plan:o,label:o.name+' · '+price(o),description:summary(o)})));}
 let payments=true,test=false;
 function checkout(){show('Пополнить · '+price(selected),summary(selected),[
  {id:'offer',label:(offerConsent?'[x] ':'[ ] ')+'Принимаю оферту',description:'И ознакомился с политикой конфиденциальности'},
  {id:'personal',label:(personalConsent?'[x] ':'[ ] ')+'Согласие на обработку ПД',description:'Отдельное согласие на персональные данные'},
  {id:'docs',label:'Прочитать документы'},
  {id:'pay',label:'Перейти к оплате · '+price(selected),description:offerConsent&&personalConsent?(test?'Тестовая оплата · CloudPayments':'Защищённая страница CloudPayments'):'Сначала отметьте оба согласия'},
  {id:'plans',label:'Другой пакет',description:balance()}
 ]);}
 function load(){return pending('Загружаю пакеты…',()=>billing.offers(),result=>{offers=result.offers||[];payments=result.payments_available!==false;test=Boolean(result.test);if(!offers.length){show('Пополнение пока недоступно',balance(),[{id:'reload',label:'Обновить пакеты'},{id:'telegram',label:'Открыть Telegram',description:'Уточнить доступные пакеты у бота'}]);return;}catalogue();},'reload');}
 async function act(item){try{
  if(item.id==='reload')return load();
  if(item.id==='telegram'){await openExternal(billing.snapshot().telegramURL);catalogue();return;}
  if(item.id==='plans'){catalogue();return;}
  if(item.id==='plan'){selected=item.plan;offerConsent=false;personalConsent=false;requestId=randomUUID();if(!payments){show('Онлайн-оплата пока не подключена',summary(selected)+' · '+price(selected),[{id:'telegram',label:'Пополнить через Telegram'},{id:'plans',label:'Другой пакет'}]);return;}checkout();return;}
  if(item.id==='offer'){offerConsent=!offerConsent;checkout();return;}
  if(item.id==='personal'){personalConsent=!personalConsent;checkout();return;}
  if(item.id==='docs'){show('Документы оплаты','Откроются в браузере',[{id:'doc',key:'offer',label:'Оферта'},{id:'doc',key:'privacy',label:'Политика конфиденциальности'},{id:'doc',key:'consent',label:'Согласие на обработку ПД'},{id:'checkout',label:'Вернуться к оплате'}]);return;}
  if(item.id==='doc'){await openExternal(billing.snapshot().legal[item.key].url);checkout();return;}
  if(item.id==='checkout'){checkout();return;}
  if(item.id==='pay'){if(!offerConsent||!personalConsent){checkout();return;}return pending('Готовлю страницу оплаты…',()=>billing.buy({plan:selected.plan_id,id:requestId,consent:{offer:true,personalData:true,versions:Object.fromEntries(Object.entries(billing.snapshot().legal).map(([k,v])=>[k,v.version]))}}),order=>{show('Страница оплаты готова',summary(selected),[{id:'open',url:order.checkout_url,label:'Открыть оплату · '+price(selected),description:'Оплата в браузере на CloudPayments'}]);},'pay');}
  if(item.id==='open'){await openExternal(item.url);show('Оплата открыта в браузере',balance(),[{id:'refresh',label:'Обновить баланс'}]);return;}
  if(item.id==='refresh')return pending('Обновляю баланс…',()=>billing.refresh(),()=>catalogue(),'refresh');
 }catch(e){show('Не удалось открыть действие',clean(e.message),[{id:selected?'checkout':'reload',label:'Попробовать снова'}]);}}
 if(billing.snapshot().access==='key_expired')show('Обновите доступ',balance(),[{id:'telegram',label:'Получить новый ключ в Telegram'}]);else void load();
 return {render:w=>inner.render(w),handleInput:data=>inner.handleInput(data),invalidate:()=>inner?.invalidate(),dispose(){closed=true;++epoch;clearTimeout(timer);inner?.dispose();}};
}
