import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const bundle = fileURLToPath(new URL('./pi-friendly/', import.meta.url));

// Read and verify the complete runtime before changing an existing installation.
export async function prepareFriendly(settings, configDir, source = bundle) {
  const manifest = JSON.parse((await fs.readFile(path.join(source, 'bundle.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const contents = new Map();
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file) || file.split('/').some(p => p === '.' || p === '..')) throw new Error('Invalid UI bundle path');
    const data = await fs.readFile(path.join(source, file));
    if (createHash('sha256').update(data).digest('hex') !== hash) throw new Error('UI bundle integrity check failed');
    contents.set(file, data);
  }
  const pkg = JSON.parse(contents.get('package.json'));
  if (pkg.name !== 'pi-friendly' || pkg.version !== manifest.version || !contents.has('index.ts') || !manifest.embeddedRouter || !contents.has('router/index.ts')) throw new Error('Invalid UI bundle');

  // Install a stable loader once. Background updates only publish immutable
  // runtime versions, never overwrite this loader or the bundled fallback.
  contents.set('bundled.ts', contents.get('index.ts'));
  for (const file of ['index.ts','update.mjs','worker.mjs','trust.mjs']) {
    contents.set(file, await fs.readFile(new URL('./autoupdate/'+file, import.meta.url)));
  }

  async function isFriendly(entry) {
    const value = typeof entry === 'string' ? entry : entry?.source;
    if (typeof value !== 'string') return false;
    if (/^(?:git:)?(?:https:\/\/)?github\.com\/slavamirniy\/pi-router-extension(?:\.git)?(?:@[^\s]+)?\/?$/.test(value)) return true;
    if (/^(?:git\+https:\/\/|git@)github\.com[:/]slavamirniy\/pi-router-extension(?:\.git)?(?:#[^\s]+)?$/.test(value)) return true;
    if (/^(?:git:)?(?:https:\/\/)?github\.com\/slavamirniy\/pi-friendly(?:\.git)?(?:@[^\s]+)?\/?$/.test(value)) return true;
    if (/^(?:git\+https:\/\/|git@)github\.com[:/]slavamirniy\/pi-friendly(?:\.git)?(?:#[^\s]+)?$/.test(value)) return true;
    const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
    // Relative package paths in pi settings are relative to the agent directory.
    let directory = path.resolve(configDir, expanded);
    if (/\.(ts|js|mjs)$/.test(directory)) directory = path.dirname(directory);
    if (directory === path.join(configDir, 'extensions', 'llmsrouter-progress')) return true;
    try { return ['pi-friendly', 'pi-router-extension'].includes(JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')).name); }
    catch { return false; }
  }
  for (const key of ['packages', 'extensions']) {
    if (settings[key] !== undefined && !Array.isArray(settings[key])) throw new Error(`Invalid configuration: ${key}`);
    if (settings[key]) {
      const keep = await Promise.all(settings[key].map(async entry => !(await isFriendly(entry))));
      settings[key] = settings[key].filter((_, i) => keep[i]);
    }
  }

  const install = async function install(stamp) {
    const destination = path.join(configDir, 'extensions', 'pi-friendly');
    const staging = path.join(configDir, `.pi-friendly-stage-${stamp}`);
    const saved = path.join(configDir, 'backups', `pi-friendly-${stamp}`);
    const oldQuota = path.join(configDir, 'extensions', 'llmsrouter-progress');
    const savedQuota = path.join(configDir, 'backups', `llmsrouter-progress-${stamp}`);
    await fs.mkdir(staging, {recursive:true, mode:0o700});
    let moved = false;
    let quotaMoved = false;
    try {
      for (const [file, data] of contents) { await fs.mkdir(path.dirname(path.join(staging,file)), {recursive:true,mode:0o700}); await fs.writeFile(path.join(staging, file), data, {mode:0o600}); }
      await fs.copyFile(path.join(source, 'bundle.json'), path.join(staging, 'bundle.json'));
      await fs.mkdir(path.dirname(destination), {recursive:true, mode:0o700});
      await fs.mkdir(path.dirname(saved), {recursive:true, mode:0o700});
      try { await fs.rename(oldQuota, savedQuota); quotaMoved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await fs.rename(destination, saved); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await fs.rename(staging, destination); }
      catch (error) { if (moved) await fs.rename(saved, destination); throw error; }
    } catch (error) {
      if (quotaMoved) await fs.rename(savedQuota, oldQuota);
      throw error;
    } finally { await fs.rm(staging, {recursive:true, force:true}); }
  };
  install.version = pkg.version;
  return install;
}
