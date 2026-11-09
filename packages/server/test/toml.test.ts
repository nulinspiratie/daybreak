import { describe, expect, it } from 'vitest'
import { parseToml } from '../src/toml'

describe('parseToml', () => {
  it('reads tables, strings, integers, booleans and comments', () => {
    const doc = parseToml(`# top comment
title = "Daybreak"   # trailing comment

[server]
port = 47_815

[backup]
dir = 'C:\\Users\\serwan\\OneDrive - Lab\\Daybreak backups'  # literal: backslashes kept
quoted = "a \\"b\\" \\\\ \\t \\u00e9 # not a comment"
on = true
off = false
negative = -3
`)
    expect(doc).toEqual({
      title: 'Daybreak',
      server: { port: 47815 },
      backup: {
        dir: 'C:\\Users\\serwan\\OneDrive - Lab\\Daybreak backups',
        quoted: 'a "b" \\ \t é # not a comment',
        on: true,
        off: false,
        negative: -3,
      },
    })
  })

  it('accepts Windows line endings, a BOM and an empty file', () => {
    expect(parseToml('\uFEFF[day]\r\nstarts_at = "04:00"\r\n')).toEqual({
      day: { starts_at: '04:00' },
    })
    expect(parseToml('')).toEqual({})
  })

  it('keys such as __proto__ are plain keys', () => {
    const doc = parseToml('[__proto__]\nconstructor = 1\n')
    expect(Object.keys(doc)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it.each([
    ['port = 1.5', /line 1: 1.5 is not a value/],
    ['dir = C:\\x', /line 1: C:\\x is not a value/],
    ['ports = [1, 2]', /line 1: arrays are not supported/],
    ['x = { a = 1 }', /line 1: inline tables are not supported/],
    ['x = """\nmany\n"""', /line 1: multi-line strings/],
    ['[[backup]]', /line 1: arrays of tables/],
    ['[backup', /line 1: .*closing \]/],
    ['[backup.extra]', /line 1: table names are plain words/],
    ['a.b = 1', /line 1: keys are plain words/],
    ['= 1', /line 1: keys are plain words/],
    ['x = ', /line 1: a value is missing/],
    ['x', /line 1: expected key = value/],
    ['x = "open', /line 1: a string needs a closing "/],
    ["x = 'open", /line 1: a string needs a closing '/],
    ['x = 1 2', /line 1: 1 2 is not a value/],
    ['x = "a" b', /line 1: unexpected text: b/],
    ['[a] b', /line 1: unexpected text: b/],
    ['x = 1\nx = 2', /line 2: x is set twice/],
    ['[a]\n[a]', /line 2: \[a\] appears twice/],
    ['a = 1\n[a]', /line 2: \[a\] appears twice/],
    ['x = 01', /line 1: 01 is not a value/],
    ['x = 99999999999999999999', /line 1: 99999999999999999999 is too large/],
    ['x = 1979-05-27', /line 1: 1979-05-27 is not a value/],
  ])('refuses %j', (text, error) => {
    expect(() => parseToml(text)).toThrow(error)
  })

  it('points Windows paths in double quotes at single quotes', () => {
    expect(() => parseToml('dir = "C:\\Users\\serwan"')).toThrow(
      /\\U needs 8 hex digits\. For Windows paths use single quotes/,
    )
    expect(() => parseToml('dir = "D:\\data"')).toThrow(/For Windows paths use single quotes/)
  })

  it('refuses bad \\u escapes', () => {
    expect(() => parseToml('x = "\\u12"')).toThrow(/\\u needs 4 hex digits/)
    expect(() => parseToml('x = "\\uD800"')).toThrow(/not a valid character/)
  })
})
