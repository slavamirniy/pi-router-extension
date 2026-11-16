import {spawn} from 'node:child_process';

export function canAutoOpen({mode, reason, platform = process.platform, env = process.env,
  tty = process.stdin.isTTY && process.stdout.isTTY}) {
  if (mode !== 'tui' || reason !== 'startup' || !tty || env.PI_FRIENDLY_AUTO_WEB === '0' ||
      env.PI_FRIENDLY_WEB_CHILD === '1' || env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY ||
      (env.CI && env.CI !== 'false') || env.TERM === 'dumb') return false;
  if (platform === 'win32') return env.SESSIONNAME?.toLowerCase() !== 'services';
  if (platform === 'darwin') return true;
  return platform === 'linux' && Boolean(env.WAYLAND_DISPLAY || env.DISPLAY);
}

// Some xdg-open handlers stay alive as long as the browser. The page itself
// confirms opening via the existing authenticated handshake.
export async function launchBrowser(url, ready, {platform = process.platform, launch = spawn, timeout = 15000} = {}) {
  const command = platform === 'win32' ? 'rundll32.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = launch(command, args, {windowsHide:true, stdio:'ignore'});
  let timer;
  const failure = new Error('Браузер не открыл приложение. Можно продолжить в терминале.');
  try {
    await Promise.race([ready.then(ok => { if (!ok) throw failure; }), new Promise((_, reject) => {
      child.once('error', () => reject(failure));
      child.once('exit', code => { if (code !== 0) reject(failure); });
      timer = setTimeout(() => reject(failure), timeout);
      child.unref();
    })]);
  } finally { clearTimeout(timer); }
}
