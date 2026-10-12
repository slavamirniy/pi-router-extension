export function createBillingUI(){
 const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text)x.textContent=text;if(cls)x.className=cls;return x;};
 const dialog=el('dialog',null,'billing-dialog');dialog.setAttribute('aria-labelledby','billing-title');document.body.append(dialog);
 // Close only when both the press and release are on the backdrop.
 const outside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
 let backdropPress=false;
 dialog.addEventListener('pointerdown',e=>{backdropPress=outside(e);});
 dialog.addEventListener('pointercancel',()=>{backdropPress=false;});
 dialog.addEventListener('click',e=>{if(backdropPress&&outside(e))dialog.close();backdropPress=false;});
 let state={},shown='',epoch=0,order,pollTimer;
 const request=async(path,data)=>{const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});const v=await r.json();if(!r.ok)throw Error(v.error||'Не удалось выполнить действие.');return v;};
 const link=(text,url)=>{const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 function shell(title){epoch++;dialog.replaceChildren();const head=el('div',null,'billing-head'),h=el('h2',title);h.id='billing-title';const close=el('button','×','billing-close');close.setAttribute('aria-label','Закрыть');close.onclick=()=>dialog.close();head.append(h,close);dialog.append(head);if(!dialog.open)dialog.showModal();return epoch;}
 function auth(){shell('Обновите доступ');dialog.append(el('p','Ключ больше не действует. Откройте нашего Telegram-бота, получите новый доступ и обновите подключение через инструкцию бота.','billing-intro'));const a=link('Получить новый доступ в Telegram →',state.telegramURL);a.className='billing-primary';dialog.append(a);}
 async function show(){if(state.access==='key_expired'){auth();return;}const version=shell(state.access==='empty'?'Токены закончились':state.access==='expired'?'Срок пакета закончился':'Пополнить баланс');
  const available=Number(state.account?.available);const box=el('div',null,'billing-summary');box.append(el('span','Сейчас доступно'),el('strong',Number.isFinite(available)?Math.max(0,available).toLocaleString('ru-RU')+' токенов':'—'));dialog.append(box);
  const status=el('p','Загружаю пакеты…','billing-status');status.setAttribute('role','status');dialog.append(status);
  try{const result=await request('offers');if(version!==epoch||!dialog.open)return;const offers=result.offers||[];if(!offers.length){status.textContent='Пополнение пока не подключено. Обратитесь в Telegram-бот.';dialog.append(link('Открыть Telegram →',state.telegramURL));return;}
   status.textContent=result.test?'Тестовый режим — реальные деньги не списываются.':'Выберите пакет. Оплата откроется на защищённой странице CloudPayments.';
   const choices=el('fieldset',null,'billing-plans');choices.append(el('legend','Пакет токенов'));let selected=offers[0];
   for(const o of offers){const label=el('label',null,'billing-plan'),radio=el('input');radio.type='radio';radio.name='billing-plan';radio.value=o.plan_id;radio.checked=o===selected;const copy=el('span');copy.append(el('strong',o.name),el('small',Number(o.tokens).toLocaleString('ru-RU')+' токенов · '+Math.round(o.duration_seconds/86400)+' дн.'));label.append(radio,copy,el('b',(o.price_kopecks/100).toLocaleString('ru-RU')+' ₽'));radio.onchange=()=>{selected=o;id=crypto.randomUUID();update();};choices.append(label);}dialog.append(choices);
   if(result.payments_available===false){status.textContent='Тарифы актуальны. Онлайн-оплата пока не подключена.';dialog.append(link('Открыть Telegram',state.telegramURL));return;}
   const consents=el('div',null,'billing-consents');const check=(parts)=>{const label=el('label'),input=el('input');input.type='checkbox';const copy=el('span');for(const p of parts)copy.append(typeof p==='string'?document.createTextNode(p):p);label.append(input,copy);consents.append(label);return input;};
   if(!state.legal?.offer||!state.legal?.consent||!state.legal?.privacy){status.textContent='Документы оплаты пока недоступны.';return;}
   const a=check(['Принимаю ',link('оферту',state.legal.offer.url),' и ознакомился с ',link('политикой конфиденциальности',state.legal.privacy.url)]);
   const b=check(['Даю ',link('согласие на обработку персональных данных',state.legal.consent.url)]);dialog.append(consents);
   const pay=el('button',null,'billing-primary');let sending=false,id=crypto.randomUUID();const update=()=>{pay.disabled=sending||!a.checked||!b.checked;pay.textContent=sending?'Готовлю оплату…':'Перейти к оплате · '+(selected.price_kopecks/100).toLocaleString('ru-RU')+' ₽';};a.onchange=b.onchange=update;update();
   pay.onclick=async()=>{sending=true;update();choices.disabled=true;try{const result=await request('buy',{plan:selected.plan_id,id,consent:{offer:a.checked,personalData:b.checked,versions:Object.fromEntries(Object.entries(state.legal).map(([k,v])=>[k,v.version]))}});order=result.id;if(version!==epoch)return;const checkout=link('Открыть страницу оплаты →',result.checkout_url);checkout.className='billing-primary';pay.replaceWith(checkout);status.textContent='После оплаты баланс обновится автоматически. Эту вкладку можно оставить открытой.';void checkOrder();}catch(e){status.textContent=e.message;sending=false;choices.disabled=false;update();}};dialog.append(pay);
  }catch(e){if(version!==epoch)return;status.textContent=e.message;const retry=el('button','Попробовать снова');retry.onclick=show;dialog.append(retry);}
 }
 async function checkOrder(){clearTimeout(pollTimer);if(!order)return;try{const o=await request('order',{id:order});if(o.status==='paid'){order=null;shell('Баланс пополнен');dialog.append(el('p','Токены уже доступны. Можно продолжать разговор.'));const done=el('button','Вернуться к работе','billing-primary');done.onclick=()=>dialog.close();dialog.append(done);return;}if(['failed','cancelled'].includes(o.status)){order=null;return;}}catch{}pollTimer=setTimeout(checkOrder,5000);}
 document.getElementById('billing-open').onclick=show;
 return {update(next,busy=false){if(!next)return;state=next;const access=state.access;if(access==='ready'){shown='';return;}if(['empty','expired','key_expired'].includes(access)&&shown!==access&&!dialog.open&&!busy){shown=access;void show();}}};
}
