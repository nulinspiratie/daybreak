import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandPath, loadConfig, resolveConfigFile } from '../src/config'
import { parseToml } from '../src/toml'

const scratch = () => mkdtempSync(join(tmpdir(), 'daybreak-config-'))

/** A data folder and a settings file path beside it, nothing created yet but the folder. */
function setup() {
  const base = scratch()
  const dataDir = join(base, 'data')
  mkdirSync(dataDir)
  const file = join(base, 'home', '.daybreak.toml')
  const load = (env: NodeJS.ProcessEnv = {}) =>
    loadConfig({ file, dataDir, env, home: join(base, 'home'), platform: process.platform })
  return { base, dataDir, file, load }
}

const failWith = (m: string): never => {
  throw new Error(m)
}

describe('resolveConfigFile', () => {
  it('DAYBREAK_CONFIG wins', () => {
    const env = { DAYBREAK_CONFIG: '/etc/daybreak.toml', DAYBREAK_DATA_DIR: '/scratch' }
    expect(resolveConfigFile(env, '/scratch', '/home/u')).toBe(resolve('/etc/daybreak.toml'))
  })
  it('a DAYBREAK_DATA_DIR run reads the settings in that folder, never the real ones', () => {
    expect(resolveConfigFile({ DAYBREAK_DATA_DIR: '/scratch' }, '/scratch', '/home/u')).toBe(
      '/scratch/daybreak.toml',
    )
  })
  it('otherwise ~/.daybreak.toml, with Windows paths on Windows', () => {
    expect(resolveConfigFile({}, '/home/u/.local/share/daybreak', '/home/u')).toBe(
      '/home/u/.daybreak.toml',
    )
    expect(resolveConfigFile({}, 'C:\\Users\\u\\AppData\\Local\\Daybreak', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\.daybreak.toml',
    )
  })
})

describe('loadConfig', () => {
  it('writes a commented file with every setting the first time, then reads it back', () => {
    const { dataDir, file, load } = setup()
    const first = load()
    expect(first.config).toEqual({
      port: 47815,
      dayStartsAt: '04:00',
      backup: { dir: join(dataDir, 'backups'), retainDays: 14 },
    })
    expect(first.file).toBe(file)
    expect(first.warnings).toEqual([])
    const text = readFileSync(file, 'utf8')
    expect(parseToml(text)).toEqual({
      server: { port: 47815 },
      day: { starts_at: '04:00' },
      backup: { retain_days: 14 },
    })
    expect(text).toContain("# dir = '%OneDriveCommercial%\\Daybreak backups'")
    expect(load().config).toEqual(first.config)
  })

  it('moves port and dayStartsAt from an old config.json, which becomes config.json.old', () => {
    const { dataDir, file, load } = setup()
    const legacy = JSON.stringify({ port: 5000, dayStartsAt: '05:30' })
    writeFileSync(join(dataDir, 'config.json'), legacy)
    expect(load().config).toMatchObject({ port: 5000, dayStartsAt: '05:30' })
    expect(existsSync(join(dataDir, 'config.json'))).toBe(false)
    expect(existsSync(join(dataDir, 'config.json.old'))).toBe(true)
    expect(parseToml(readFileSync(file, 'utf8'))).toMatchObject({
      server: { port: 5000 },
      day: { starts_at: '05:30' },
    })
  })

  it('an old config.json with only some settings fills in the rest', () => {
    const { dataDir, load } = setup()
    writeFileSync(join(dataDir, 'config.json'), '{"port": 6000, "dayStartsAt": null}')
    expect(load().config).toMatchObject({ port: 6000, dayStartsAt: '04:00' })
  })

  it('an unreadable old config.json stops start-up and is left alone', () => {
    const { dataDir, file, load } = setup()
    writeFileSync(join(dataDir, 'config.json'), '{nope')
    expect(() => load()).toThrow(/config\.json is not valid JSON/)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(join(dataDir, 'config.json'))).toBe(true)
  })

  it('an existing settings file wins over config.json, which is then ignored', () => {
    const { dataDir, file, load } = setup()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '[server]\nport = 7000\n')
    writeFileSync(join(dataDir, 'config.json'), '{"port": 5000}')
    expect(load().config.port).toBe(7000)
    expect(existsSync(join(dataDir, 'config.json'))).toBe(true)
  })

  it('reads every setting', () => {
    const { base, file, load } = setup()
    mkdirSync(join(file, '..'), { recursive: true })
    const dir = `${base}/OneDrive/Daybreak backups`
    writeFileSync(
      file,
      `[server]\nport = 1\n[day]\nstarts_at = "23:59"\n[backup]\ndir = '${dir}'\nretain_days = 30\n`,
    )
    expect(load().config).toEqual({
      port: 1,
      dayStartsAt: '23:59',
      backup: { dir: join(base, 'OneDrive', 'Daybreak backups'), retainDays: 30 },
    })
  })

  it('missing sections and keys take their defaults', () => {
    const { dataDir, file, load } = setup()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '# nothing set\n')
    expect(load().config).toEqual({
      port: 47815,
      dayStartsAt: '04:00',
      backup: { dir: join(dataDir, 'backups'), retainDays: 14 },
    })
  })

  it('unknown sections and keys are warnings, not errors', () => {
    const { file, load } = setup()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'theme = "dark"\n[agents]\nscope = "x"\n[backup]\nretain = 3\n')
    expect(load().warnings).toEqual([
      'unknown setting theme',
      'unknown section [agents]',
      'unknown setting retain in [backup]',
    ])
  })

  it.each([
    ['[server]\nport = 0', /port in \[server\] must be a whole number from 1 to 65535, got 0/],
    ['[server]\nport = 65536', /port in \[server\]/],
    ['[server]\nport = "47815"', /port in \[server\].*got "47815"/],
    ['[day]\nstarts_at = "4:00"', /starts_at in \[day\] must be "HH:MM"/],
    ['[day]\nstarts_at = "24:00"', /starts_at in \[day\]/],
    ['[day]\nstarts_at = 400', /starts_at in \[day\]/],
    ['[backup]\nretain_days = 0', /retain_days in \[backup\] must be a whole number from 1/],
    ['[backup]\nretain_days = 3651', /retain_days in \[backup\]/],
    ['[backup]\nretain_days = true', /retain_days in \[backup\]/],
    ['[backup]\ndir = 3', /dir in \[backup\] must be a folder path in quotes/],
    ['[backup]\ndir = "  "', /dir in \[backup\] must be a folder path/],
    ["[backup]\ndir = 'backups'", /dir in \[backup\]: "backups" must be a full path/],
    ["[backup]\ndir = '%NOPE%/x'", /dir in \[backup\]: the environment variable %NOPE% isn't set/],
    ['server = 1', /server must be a section, \[server\]/],
    ['[server]\nport = [1]', /line 2: arrays are not supported/],
  ])('refuses %j, naming the file', (body, error) => {
    const { file, load } = setup()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, body)
    expect(() => load()).toThrow(error)
    expect(() => load()).toThrow(`Settings file ${file}: `)
  })

  it('refuses the data folder itself as the backup folder', () => {
    const { dataDir, file, load } = setup()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, `[backup]\ndir = '${dataDir}/'\n`)
    expect(() => load()).toThrow(/is the data folder itself/)
  })

  it('creates the folder for a DAYBREAK_CONFIG path that does not exist yet', () => {
    const { base, dataDir } = setup()
    const file = join(base, 'deep', 'er', 'settings.toml')
    loadConfig({ file, dataDir, env: {}, home: base, platform: process.platform })
    expect(existsSync(file)).toBe(true)
  })
})

describe('expandPath', () => {
  it('expands ~ and %NAME%', () => {
    expect(expandPath('~/backups', {}, '/home/u', 'linux', failWith)).toBe('/home/u/backups')
    expect(expandPath('%BASE%/x', { BASE: '/srv' }, '/home/u', 'linux', failWith)).toBe('/srv/x')
  })
  it('on Windows: %OneDriveCommercial%, any letter case, Windows separators', () => {
    const env = { OneDriveCommercial: 'C:\\Users\\u\\OneDrive - Lab' }
    expect(
      expandPath('%onedrivecommercial%\\Daybreak backups', env, 'C:\\Users\\u', 'win32', failWith),
    ).toBe('C:\\Users\\u\\OneDrive - Lab\\Daybreak backups')
    expect(expandPath('~\\backups', {}, 'C:\\Users\\u', 'win32', failWith)).toBe(
      'C:\\Users\\u\\backups',
    )
  })
  it('on Linux, variable names are case-sensitive', () => {
    expect(() => expandPath('%home%/x', { HOME: '/home/u' }, '/home/u', 'linux', failWith)).toThrow(
      /%home% isn't set/,
    )
  })
  it('refuses a relative path, also on Windows', () => {
    expect(() => expandPath('backups', {}, 'C:\\Users\\u', 'win32', failWith)).toThrow(
      /must be a full path/,
    )
    expect(() => expandPath('~user/x', {}, '/home/u', 'linux', failWith)).toThrow(
      /must be a full path/,
    )
  })
})
