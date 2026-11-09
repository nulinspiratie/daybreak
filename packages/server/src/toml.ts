// A small reader for the subset of TOML that Daybreak's settings file uses: comments, [tables],
// bare keys, basic "…" and literal '…' strings, integers and booleans. Anything else (arrays,
// inline tables, floats, dates, multi-line strings, dotted keys) is refused with the line number,
// rather than half-read. Hand-written so the settings need no new dependency.

export type TomlValue = string | number | boolean
export type TomlTable = Record<string, TomlValue>
export type TomlDocument = Record<string, TomlValue | TomlTable>

export class TomlError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`)
    this.name = 'TomlError'
  }
}

const PLAIN_WORDS = 'plain words (letters, digits, _ and -)'
const BARE_KEY = /^[A-Za-z0-9_-]+$/
const INTEGER = /^[+-]?(0|[1-9](_?[0-9])*)$/
const WINDOWS_HINT = ". For Windows paths use single quotes: 'C:\\Users\\…'"
const ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\',
}

/** Parses `text`; throws TomlError naming the line on anything outside the subset. */
export function parseToml(text: string): TomlDocument {
  // No prototype, so keys such as __proto__ or constructor are plain keys.
  const doc: TomlDocument = Object.create(null)
  const tables = new Set<string>()
  let current: TomlDocument | TomlTable = doc
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)

  lines.forEach((raw, i) => {
    const n = i + 1
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return

    if (line.startsWith('[')) {
      if (line.startsWith('[[')) throw new TomlError(n, 'arrays of tables are not supported')
      const close = line.indexOf(']')
      if (close < 0) throw new TomlError(n, 'a table header needs a closing ]')
      const name = line.slice(1, close).trim()
      if (!BARE_KEY.test(name)) {
        throw new TomlError(n, `table names are ${PLAIN_WORDS}, got [${name}]`)
      }
      expectEnd(line.slice(close + 1), n)
      if (tables.has(name) || Object.hasOwn(doc, name)) {
        throw new TomlError(n, `[${name}] appears twice`)
      }
      tables.add(name)
      const table: TomlTable = Object.create(null)
      doc[name] = table
      current = table
      return
    }

    const eq = line.indexOf('=')
    if (eq < 0) throw new TomlError(n, 'expected key = value')
    const key = line.slice(0, eq).trim()
    if (!BARE_KEY.test(key)) {
      throw new TomlError(n, `keys are ${PLAIN_WORDS}, got ${key || 'nothing'}`)
    }
    if (Object.hasOwn(current, key)) throw new TomlError(n, `${key} is set twice`)
    const { value, rest } = readValue(line.slice(eq + 1).trim(), n)
    expectEnd(rest, n)
    current[key] = value
  })
  return doc
}

/** Only whitespace and a comment may follow a value or a table header. */
function expectEnd(rest: string, n: number): void {
  const t = rest.trim()
  if (t !== '' && !t.startsWith('#')) throw new TomlError(n, `unexpected text: ${t}`)
}

function readValue(src: string, n: number): { value: TomlValue; rest: string } {
  if (src === '') throw new TomlError(n, 'a value is missing after =')
  if (src.startsWith('"""') || src.startsWith("'''")) {
    throw new TomlError(n, 'multi-line strings are not supported')
  }
  if (src.startsWith("'")) {
    const end = src.indexOf("'", 1)
    if (end < 0) throw new TomlError(n, "a string needs a closing '")
    return { value: src.slice(1, end), rest: src.slice(end + 1) }
  }
  if (src.startsWith('"')) return readBasicString(src, n)
  if (src.startsWith('[')) throw new TomlError(n, 'arrays are not supported')
  if (src.startsWith('{')) throw new TomlError(n, 'inline tables are not supported')

  const hash = src.indexOf('#')
  const word = (hash < 0 ? src : src.slice(0, hash)).trim()
  const rest = hash < 0 ? '' : src.slice(hash)
  if (word === 'true' || word === 'false') return { value: word === 'true', rest }
  if (INTEGER.test(word)) {
    const value = Number(word.replaceAll('_', ''))
    if (!Number.isSafeInteger(value)) throw new TomlError(n, `${word} is too large`)
    return { value, rest }
  }
  throw new TomlError(
    n,
    `${word} is not a value Daybreak reads: use a quoted string, a whole number, true or false`,
  )
}

function readBasicString(src: string, n: number): { value: string; rest: string } {
  let out = ''
  for (let i = 1; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '"') return { value: out, rest: src.slice(i + 1) }
    if (ch !== '\\') {
      out += ch
      continue
    }
    const esc = src[i + 1]
    if (esc === undefined) break
    if (Object.hasOwn(ESCAPES, esc)) {
      out += ESCAPES[esc]
      i++
      continue
    }
    if (esc === 'u' || esc === 'U') {
      const len = esc === 'u' ? 4 : 8
      const hex = src.slice(i + 2, i + 2 + len)
      if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) {
        throw new TomlError(n, `\\${esc} needs ${len} hex digits${WINDOWS_HINT}`)
      }
      const code = Number.parseInt(hex, 16)
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw new TomlError(n, `\\${esc}${hex} is not a valid character`)
      }
      out += String.fromCodePoint(code)
      i += 1 + len
      continue
    }
    throw new TomlError(n, `\\${esc} is not a valid escape in a "…" string${WINDOWS_HINT}`)
  }
  throw new TomlError(n, 'a string needs a closing "')
}
