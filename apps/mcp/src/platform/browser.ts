import { platform } from 'node:os';
import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  const [command, args] = platform() === 'darwin'
    ? ['open', [url]]
    : platform() === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
