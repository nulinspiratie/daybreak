import { spawn } from 'node:child_process'
import { DaybreakError } from '@daybreak/core'

/** Hand a link or path to the OS. Never through a shell, so `&` and friends stay inside one argument. */
export function openLink(
  link: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: typeof spawn = spawn,
): void {
  if (typeof link !== 'string' || link.trim() === '') throw new DaybreakError('invalid', 'This task has no link')
  const cmd = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawnFn(cmd, [link], { detached: true, stdio: 'ignore', shell: false })
  // A missing opener (no xdg-open) must not crash the server.
  child.on('error', () => {})
  child.unref()
}
