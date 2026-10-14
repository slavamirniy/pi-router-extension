import {checkUpdate} from './update.mjs';
// No secrets in arguments, no inherited API keys used, no shell, no npm hooks.
await checkUpdate(process.argv[2]).catch(()=>{});
