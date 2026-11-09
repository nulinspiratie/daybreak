import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { openLink } from '../src/openLink'

function fakeSpawn() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const fn = vi.fn(() => child)
  return {
    fn: fn as unknown as typeof spawn,
    calls: fn.mock.calls as unknown as unknown[][],
    child,
  }
}

describe('openLink', () => {
  it('win32 spawns explorer.exe with the link as one argument, even with &', () => {
    const s = fakeSpawn()
    const link = 'https://x.example/?a=1&b=2'
    openLink(link, 'win32', s.fn)
    expect(s.calls).toEqual([
      ['explorer.exe', [link], { detached: true, stdio: 'ignore', shell: false }],
    ])
    expect(s.child.unref).toHaveBeenCalledOnce()
  })
  it('darwin uses open, other platforms use xdg-open', () => {
    const a = fakeSpawn()
    openLink('/x', 'darwin', a.fn)
    expect(a.calls[0]![0]).toBe('open')
    const b = fakeSpawn()
    openLink('/x', 'linux', b.fn)
    expect(b.calls[0]![0]).toBe('xdg-open')
  })
  it('a spawn error event does not throw and logs one line to stderr', () => {
    const s = fakeSpawn()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    openLink('/x', 'linux', s.fn)
    expect(() => s.child.emit('error', new Error('ENOENT'))).not.toThrow()
    expect(err).toHaveBeenCalledOnce()
    expect(String(err.mock.calls[0]![0])).toContain('ENOENT')
    err.mockRestore()
  })
  it('rejects NUL bytes and leading dashes as invalid without spawning', () => {
    const s = fakeSpawn()
    for (const bad of ['a\0b', '-rf', '--help']) {
      expect(() => openLink(bad, 'linux', s.fn)).toThrow(
        expect.objectContaining({ code: 'invalid' }),
      )
    }
    expect(s.calls).toEqual([])
  })
  it('a synchronous spawn throw becomes invalid', () => {
    const boom = (() => {
      throw new Error('spawn exploded')
    }) as unknown as typeof spawn
    expect(() => openLink('/x', 'linux', boom)).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    )
  })
  it('an empty or null link throws invalid', () => {
    const s = fakeSpawn()
    for (const bad of ['', '   ', null, undefined]) {
      expect(() => openLink(bad as unknown as string, 'linux', s.fn)).toThrow(/link/i)
      try {
        openLink(bad as unknown as string, 'linux', s.fn)
      } catch (e) {
        expect((e as { code: string }).code).toBe('invalid')
      }
    }
    expect(s.calls).toEqual([])
  })
})
