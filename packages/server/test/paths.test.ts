import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertOutsideRepo, loadOrCreateToken, resolveDataDir } from '../src/paths'

const scratch = () => mkdtempSync(join(tmpdir(), 'daybreak-paths-'))

describe('resolveDataDir', () => {
  it('DAYBREAK_DATA_DIR wins', () => {
    const env = { DAYBREAK_DATA_DIR: '/x/data', LOCALAPPDATA: 'C:\\L', XDG_DATA_HOME: '/xdg' }
    expect(resolveDataDir(env, 'win32', '/home/u')).toBe(resolve('/x/data'))
  })
  it('win32 uses LOCALAPPDATA\\Daybreak', () => {
    expect(
      resolveDataDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u'),
    ).toBe('C:\\Users\\u\\AppData\\Local\\Daybreak')
  })
  it('linux uses XDG_DATA_HOME/daybreak, else ~/.local/share/daybreak', () => {
    expect(resolveDataDir({ XDG_DATA_HOME: '/xdg' }, 'linux', '/home/u')).toBe('/xdg/daybreak')
    expect(resolveDataDir({}, 'linux', '/home/u')).toBe('/home/u/.local/share/daybreak')
  })
})

describe('assertOutsideRepo', () => {
  it('throws for <repo>/data and passes for a sibling dir', () => {
    const base = scratch()
    const repo = join(base, 'repo')
    mkdirSync(repo)
    expect(() => assertOutsideRepo(join(repo, 'data'), repo)).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo(repo, repo)).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo(join(base, 'data'), repo)).not.toThrow()
    expect(() => assertOutsideRepo(join(base, 'repo-data'), repo)).not.toThrow()
  })
  it('catches a symlink into the repo, existing or not yet created beneath it', () => {
    const base = scratch()
    const repo = join(base, 'repo')
    mkdirSync(join(repo, 'inner'), { recursive: true })
    const link = join(base, 'link')
    symlinkSync(repo, link)
    expect(() => assertOutsideRepo(link, repo)).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo(join(link, 'inner'), repo)).toThrow(/inside the repo/)
    expect(() => assertOutsideRepo(join(link, 'not-yet', 'deeper'), repo)).toThrow(
      /inside the repo/,
    )
  })
  it('catches a repo reached through a symlink', () => {
    const base = scratch()
    const repo = join(base, 'repo')
    mkdirSync(join(repo, 'data'), { recursive: true })
    const repoLink = join(base, 'repolink')
    symlinkSync(repo, repoLink)
    expect(() => assertOutsideRepo(join(repo, 'data'), repoLink)).toThrow(/inside the repo/)
  })
})

describe('loadOrCreateToken', () => {
  it('token is 64 hex chars and stable across calls', () => {
    const dir = scratch()
    const a = loadOrCreateToken(dir)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(loadOrCreateToken(dir)).toBe(a)
    expect(readFileSync(join(dir, 'token'), 'utf8').trim()).toBe(a)
  })
  it.skipIf(process.platform === 'win32')('token file is mode 0600', () => {
    const dir = scratch()
    loadOrCreateToken(dir)
    expect(statSync(join(dir, 'token')).mode & 0o777).toBe(0o600)
  })
})

describe('carry-ins', () => {
  it('assertOutsideRepo: <repo>/..data is inside the repo, not a parent escape', () => {
    const base = scratch()
    const repo = join(base, 'repo')
    mkdirSync(repo)
    expect(() => assertOutsideRepo(join(repo, '..data'), repo)).toThrow(/inside the repo/)
  })
})
