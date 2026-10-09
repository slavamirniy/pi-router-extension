import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export async function createMacDesktop({home, node, pi, icon}) {
  const desktop = path.join(home, 'Desktop');
  const app = path.join(desktop, 'AI своими руками.app');
  const support = path.join(home, 'Library', 'Application Support', 'AI-DIY');
  const project = path.join(home, 'Documents', 'AI DIY Projects');
  for (const dir of [support,project,path.join(app,'Contents','MacOS'),path.join(app,'Contents','Resources')]) await fs.mkdir(dir,{recursive:true,mode:0o700});
  const command = path.join(support,'launch.command');
  await fs.writeFile(command, `#!/bin/bash\nexport PATH=${quote(path.dirname(node)+':'+path.dirname(pi))}:"$PATH"\ncd ${quote(project)} || exit 1\nexec ${quote(pi)}\n`,{mode:0o700});
  const launch = path.join(app,'Contents','MacOS','launch');
  await fs.writeFile(launch,`#!/bin/bash\nexec /usr/bin/open -a Terminal ${quote(command)}\n`,{mode:0o700});
  await fs.chmod(command,0o700); await fs.chmod(launch,0o700);
  await fs.copyFile(icon,path.join(app,'Contents','Resources','AppIcon.icns'));
  await fs.writeFile(path.join(app,'Contents','Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>AI своими руками</string>
<key>CFBundleDisplayName</key><string>AI своими руками</string>
<key>CFBundleIdentifier</key><string>com.aidiy.launcher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>launch</string>
<key>CFBundleIconFile</key><string>AppIcon.icns</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>\n`);
  return {app,command,project};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform!=='darwin') throw new Error('This desktop launcher is for macOS');
  const [home,node,pi,icon]=process.argv.slice(2);
  if (![home,node,pi,icon].every(v=>v&&path.isAbsolute(v))) throw new Error('Absolute installer paths required');
  await createMacDesktop({home,node,pi,icon});
  console.log('Desktop shortcut created: AI своими руками');
}
