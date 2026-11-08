import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertOutsideRepo, loadConfig, loadOrCreateToken, resolveDataDir } from '../src/paths'

const scratch = () => mkdtempSync(join(tmpdir(), 'daybreak-paths-'))

describe('resolveDataDir', () => {
  it('DAYBREAK_DATA_DIR wins', () => {
    const env = { DAYBREAK_DATA_DIR: '/x/data', LOCALAPPDATA: 'C:\\L', XDG_DATA_HOME: '/xdg' }
    expect(resolveDataDir(env, 'win32', '/home/u')).toBe(resolve('/x/data'))
  })
  it('win32 uses LOCALAPPDATA\\Daybreak', () => {
    expect(resolveDataDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\Daybreak',
    )
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
    expect(() => assertOutsideRepo(join(link, 'not-yet', 'deeper'), repo)).toThrow(/inside the repo/)
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

describe('loadConfig', () => {
  it('config defaults are written once', () => {
    const dir = scratch()
    expect(loadConfig(dir)).toEqual({ port: 47815, dayStartsAt: '04:00' })
    const file = join(dir, 'config.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ port: 47815, dayStartsAt: '04:00' })
    writeFileSync(file, JSON.stringify({ port: 5000, dayStartsAt: '05:30' }))
    expect(loadConfig(dir)).toEqual({ port: 5000, dayStartsAt: '05:30' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ port: 5000, dayStartsAt: '05:30' })
  })
  it('creates the data dir when missing', () => {
    const dir = join(scratch(), 'a', 'b')
    expect(loadConfig(dir).port).toBe(47815)
  })
  it('fills missing keys from defaults without rewriting the file', () => {
    const dir = scratch()
    const file = join(dir, 'config.json')
    writeFileSync(file, '{"port": 6000}')
    expect(loadConfig(dir)).toEqual({ port: 6000, dayStartsAt: '04:00' })
    expect(readFileSync(file, 'utf8')).toBe('{"port": 6000}')
  })
  it.each([
    ['dayStartsAt', '24:00'],
    ['dayStartsAt', '4:00'],
    ['dayStartsAt', '12:60'],
    ['dayStartsAt', 400],
    ['port', 0],
    ['port', 65536],
    ['port', 80.5],
    ['port', '8080'],
  ])('rejects invalid %s = %j', (key, value) => {
    const dir = scratch()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ [key]: value }))
    expect(() => loadConfig(dir)).toThrow(new RegExp(`config\\.json.*${key}`))
  })
  it('accepts boundary values', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 1, dayStartsAt: '23:59' }))
    expect(loadConfig(dir)).toEqual({ port: 1, dayStartsAt: '23:59' })
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ port: 65535, dayStartsAt: '00:00' }))
    expect(loadConfig(dir)).toEqual({ port: 65535, dayStartsAt: '00:00' })
  })
  it('throws naming config.json on bad JSON or a non-object', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'config.json'), '{nope')
    expect(() => loadConfig(dir)).toThrow(/config\.json/)
    writeFileSync(join(dir, 'config.json'), '[1]')
    expect(() => loadConfig(dir)).toThrow(/config\.json/)
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
  it('loadConfig rejects null port and null dayStartsAt', () => {
    for (const body of ['{"port": null}', '{"dayStartsAt": null}']) {
      const dir = scratch()
      writeFileSync(join(dir, 'config.json'), body)
      expect(() => loadConfig(dir), body).toThrow(/config.json/)
    }
  })
})
