const MAX_BYTES = 1024 * 1024;
const VALID_ID = /^[a-zA-Z0-9_.:/-]{1,128}$/;
export function modelsURL(baseURL) {
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
  url.search = ''; url.hash = ''; return url.href;
}
function integer(value, maximum) {
  if (typeof value === 'string') {
    const m = /^(\d+)([kKmM]?)$/.exec(value.trim());
    if (!m) return undefined;
    value = Number(m[1]) * (/m/i.test(m[2]) ? 1048576 : /k/i.test(m[2]) ? 1024 : 1);
  }
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : undefined;
}
function limit(item, keys, maximum) {
  const values = [item, item.limits, item.architecture].filter(Boolean).flatMap(source => keys.map(k => integer(source[k], maximum))).filter(Boolean);
  return values.length ? Math.min(...values) : undefined;
}
function glmProfile(id) {
  // Official GLM-5.3 / Flash / FlashX: 1M context, 128K output.
  return /^(?:z-ai[-_.]|zai[-_.]|zhipu[-_.])?glm[-_.]5[-_.]3(?:[-_.](?:flash|flashx))?$/i.test(id.split('/').at(-1));
}
export function discoveredModel(item, previous, template) {
  if (!item || !VALID_ID.test(item.id) || item.capabilities?.completion_chat === false) return undefined;
  if (item.capabilities?.completion_chat !== true && /embed|rerank|moderation|whisper|tts|audio|image-gen|image-edit|dall-e|gpt-image|realtime|transcrib|speech|video/i.test(item.id)) return undefined;
  const profile = glmProfile(item.id);
  const contextWindow = limit(item, ['context_window','contextWindow','context_length','max_context_length','max_context_tokens','max_position_embeddings'], 2000000) ?? (profile ? 1048576 : previous?.contextWindow ?? 32768);
  const maxTokens = Math.min(contextWindow, limit(item, ['max_output_tokens','max_completion_tokens','max_tokens','maxTokens'], 1000000) ?? (profile ? 131072 : previous?.maxTokens ?? 8192));
  const reasoning = typeof item.reasoning === 'boolean' ? item.reasoning : previous?.reasoning || profile;
  let input = previous?.input ?? ['text'];
  if (Array.isArray(item.input_modalities)) input = item.input_modalities.includes('image') ? ['text','image'] : ['text'];
  if (typeof item.capabilities?.vision === 'boolean') input = item.capabilities.vision ? ['text','image'] : ['text'];
  const result = { ...previous, id:item.id, name:previous?.name ?? item.id, api:previous?.api ?? template.api, baseUrl:previous?.baseUrl ?? template.baseUrl, reasoning:!!reasoning, input, cost:previous?.cost ?? {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow,maxTokens };
  delete result.provider;
  if (profile && result.api === 'openai-completions') {
    result.compat = {...template.compat,...previous?.compat,supportsReasoningEffort:true};
    result.thinkingLevelMap = {off:'low',minimal:'low',low:'low',medium:'high',high:'high',xhigh:'max'};
  }
  return result;
}
export function mergeModels(existing, data, template, authoritative = false) {
  const byID = new Map(existing.map(m => [m.id, m]));
  const found = data.map(item => discoveredModel(item, byID.get(item?.id), template)).filter(Boolean);
  const models = new Map((authoritative ? [] : existing).map(m => [m.id, m]));
  for (const model of found) models.set(model.id, model);
  return [...models.values()];
}
async function catalogue(response) {
  if (!response.ok || !response.body) throw new Error('Models unavailable');
  const reader = response.body.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
  try {
    while (true) { const {value,done} = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('Models too large'); text += decoder.decode(value,{stream:true}); }
    text += decoder.decode();
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  const body = JSON.parse(text);
  if (!Array.isArray(body.data) || body.has_more === true || body.data.length > 5000) throw new Error('Incomplete catalogue');
  // Invalid rows must not turn an authoritative catalogue into accidental deletion.
  if (body.data.some(item => !item || typeof item.id !== 'string' || !VALID_ID.test(item.id))) throw new Error('Invalid catalogue');
  return body.data;
}
export function installModelRefresh(pi, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  let running, active = new Set(), revision = 0;
  async function refresh(ctx) {
    if (running) return running;
    const generation = revision;
    running = (async () => {
      const all = ctx.modelRegistry.getAll(); const groups = new Map();
      let configured = {};
      try { configured = await options.loadConfigured?.() ?? {}; } catch { /* existing registry remains usable */ }
      const entries = [...all];
      for (const [provider,config] of Object.entries(configured)) {
        if (!config || !config.baseUrl || all.some(m=>m.provider===provider&&m.baseUrl===config.baseUrl)) continue;
        entries.push({provider,id:'catalog-discovery',baseUrl:config.baseUrl,api:config.api??'openai-completions',compat:config.compat,bootstrap:true});
      }
      for (const model of entries) {
        if (!model.baseUrl || !ctx.modelRegistry.hasConfiguredAuth(model)) continue;
        const key = JSON.stringify([model.provider, model.baseUrl]);
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(model);
      }
      const jobs = [...groups.values()]; const results = []; let next = 0;
      await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
        while (next < jobs.length && generation === revision) {
          const models = jobs[next++], template = models[0]; let controller, timeout;
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(template);
            if (!auth?.ok) continue;
            const headers = {...template.headers,...auth.headers,Accept:'application/json'};
            if (!Object.keys(headers).some(k=>k.toLowerCase()==='authorization') && auth.apiKey) headers.Authorization = `Bearer ${auth.apiKey}`;
            if (!auth.apiKey && !Object.keys(headers).some(k=>/authorization|x-api-key/i.test(k))) continue;
            controller = new AbortController(); active.add(controller);
            timeout = setTimeout(()=>controller.abort(), options.timeout ?? 7000);
            const response = await fetcher(modelsURL(auth.baseUrl ?? template.baseUrl), {headers,signal:controller.signal,redirect:'error'});
            const data = await catalogue(response);
            const authoritative = response.headers.get('x-router-catalog') === 'v1';
            results.push({provider:template.provider,baseURL:template.baseUrl,models:mergeModels(models.filter(m=>!m.bootstrap),data,{...template,baseUrl:auth.baseUrl ?? template.baseUrl},authoritative),authoritative});
          } catch { /* retain configured models when discovery is unavailable */ }
          finally { clearTimeout(timeout); if (controller) active.delete(controller); }
        }
      }));
      if (generation !== revision) return;
      const providers = new Map();
      for (const result of results) {
        const old = providers.get(result.provider) ?? all.filter(m=>m.provider===result.provider);
        providers.set(result.provider,[...old.filter(m=>m.baseUrl!==result.baseURL),...result.models]);
      }
      for (const [provider,models] of providers) {
        try { pi.registerProvider(provider,{...ctx.modelRegistry.getRegisteredProviderConfig?.(provider),models}); } catch { /* preserve original provider on registration failure */ }
      }
      const selected = ctx.model && ctx.modelRegistry.find(ctx.model.provider,ctx.model.id);
      if (selected && ctx.isIdle?.()) await pi.setModel(selected);
      return {providers:providers.size,models:results.reduce((sum,r)=>sum+r.models.length,0)};
    })();
    try { return await running; } finally { running = undefined; }
  }
  pi.on('session_start',async (_event,ctx)=>{await refresh(ctx)});
  pi.on('session_shutdown',()=>{revision++;for(const controller of active)controller.abort();active.clear()});
  pi.registerCommand('models-refresh',{description:'Обновить модели настроенных подключений',handler:async(_args,ctx)=>{const result=await refresh(ctx);if(ctx.hasUI)ctx.ui.notify(`Каталог обновлён: подключений ${result?.providers??0}`,'info')}});
  return {refresh};
}
