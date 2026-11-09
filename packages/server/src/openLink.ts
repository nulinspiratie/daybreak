import { spawn } from 'node:child_process'
import { DaybreakError } from '@daybreak/core'

/** Hand a link or path to the OS. Never through a shell, so `&` and friends stay inside one argument. */
export function openLink(
  link: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: typeof spawn = spawn,
): void {
  if (typeof link !== 'string' || link.trim() === '')
    throw new DaybreakError('invalid', 'This task has no link')
  if (link.includes('\0')) throw new DaybreakError('invalid', 'Link contains a NUL byte')
  // xdg-open and open would read a leading dash as an option.
  if (link.startsWith('-')) throw new DaybreakError('invalid', 'Link must not start with "-"')
  const cmd = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawnFn(cmd, [link], { detached: true, stdio: 'ignore', shell: false })
    // A missing opener (no xdg-open) must not crash the server.
    child.on('error', (e) => console.error(`openLink: could not launch ${cmd}: ${e.message}`))
    child.unref()
  } catch (e) {
    throw new DaybreakError('invalid', `Could not open link: ${(e as Error).message}`)
  }
}
