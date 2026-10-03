import test from 'node:test';
import assert from 'node:assert/strict';
import { safeExtensionAPI } from './safety.mjs';

test('optional integration failures cannot reject pi lifecycle events or commands', async () => {
  const handlers = new Map(), commands = new Map();
  const safe = safeExtensionAPI({on:(n,h)=>handlers.set(n,h),registerCommand:(n,c)=>commands.set(n,c),registerProvider(){},setModel(){}});
  safe.on('session_start', () => { throw new Error('unavailable registry'); });
  safe.on('after_provider_response', async () => { throw new Error('unavailable UI'); });
  safe.on('message_end', async () => ({ message:{ role:'assistant',content:[] } }));
  safe.registerCommand('models-refresh', {handler:async () => { throw new Error('offline'); }});
  assert.equal(await handlers.get('session_start')(), undefined);
  assert.equal(await handlers.get('after_provider_response')(), undefined);
  assert.equal(await commands.get('models-refresh').handler(), undefined);
  assert.deepEqual(await handlers.get('message_end')(), {message:{role:'assistant',content:[]}});
});
