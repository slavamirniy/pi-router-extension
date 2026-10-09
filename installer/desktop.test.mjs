import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createMacDesktop} from './desktop.mjs';

test('macOS app launcher survives spaces and apostrophes; reinstall preserves projects', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'diy-desktop-'));
  try {
    const home=path.join(root,"User's files");const icon=path.join(root,'icon.icns');await fs.writeFile(icon,'test-icon');
    const options={home,node:'/opt/private node/bin/node',pi:"/Users/Someone's npm/bin/pi",icon};
    const first=await createMacDesktop(options);
    await fs.writeFile(path.join(first.project,'my-project.txt'),'keep');
    const second=await createMacDesktop(options);
    assert.equal(first.app,second.app);
    assert.equal(await fs.readFile(path.join(first.project,'my-project.txt'),'utf8'),'keep');
    const command=await fs.readFile(first.command,'utf8');
    assert.ok(command.includes("Someone'\\''s npm/bin/pi"));
    assert.ok(command.includes('AI DIY Projects'));assert.ok(!command.includes('API_KEY'));
    assert.match(await fs.readFile(path.join(first.app,'Contents','Info.plist'),'utf8'),/AppIcon.icns/);
    assert.equal(await fs.readFile(path.join(first.app,'Contents','Resources','AppIcon.icns'),'utf8'),'test-icon');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
