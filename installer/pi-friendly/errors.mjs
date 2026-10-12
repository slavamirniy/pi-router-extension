import {clean} from './menu.mjs';
// Classify known provider failures without exposing raw JSON/stack traces in the chat.
export function explainError(raw,kind='response') {
 const text=clean(raw),s=text.toLowerCase();
 if(/quota|insufficient.?credit|balance|payment|billing|квот|баланс/.test(s))return {title:'Закончился лимит сервиса',help:'Проверьте остаток квоты или выберите другую модель.'};
 if(/\b401\b|unauthori|invalid.?api.?key|authentication/.test(s))return {title:'Сервис не принял ключ доступа',help:'Проверьте подключение через /login или выберите другую модель.'};
 if(/\b403\b|forbidden|permission denied/.test(s))return {title:'Нет доступа к этому действию',help:'Проверьте разрешения. Для модели попробуйте другое подключение.'};
 if(/\b429\b|rate.?limit|too many requests/.test(s))return {title:'Слишком много запросов',help:'Подождите немного и отправьте запрос снова.'};
 if(/context.?length|context.?window|too many tokens|maximum context/.test(s))return {title:'Разговор стал слишком длинным',help:'Начните новый чат или сократите текущий командой /compact.'};
 if(/timeout|timed out|etimedout/.test(s))return {title:'Сервис не ответил вовремя',help:'Попробуйте отправить запрос позже или смените модель.'};
 if(/fetch failed|connection|network|econn|enotfound|сеть/.test(s))return {title:'Не удалось связаться с сервисом',help:'Проверьте интернет и доступность сервиса, затем повторите запрос.'};
 if(/\b50[0-9]\b|\b52[0-9]\b|overloaded|unavailable|internal server/.test(s))return {title:'Сервис временно недоступен',help:'Попробуйте позже или выберите другую модель.'};
 return {title:kind==='tool'?'Не удалось выполнить действие':'Не удалось получить ответ',help:'Откройте «Подробнее», чтобы узнать причину. Сообщения остаются в чате.'};
}
export function wrapText(text,width) {
 const lines=[];let line='';
 for(const word of clean(text).split(/\s+/)){
  if(line && line.length+1+word.length>width){lines.push(line);line='';}
  let rest=word;while(rest.length>width){if(line){lines.push(line);line='';}lines.push(rest.slice(0,width));rest=rest.slice(width);}
  line+=(line?' ':'')+rest;
 }
 if(line)lines.push(line);return lines;
}
