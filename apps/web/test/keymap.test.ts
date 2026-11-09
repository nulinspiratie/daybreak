import { describe, expect, it } from 'vitest'
import { type Command, type KeyCtx, type KeyLike, resolveKey } from '../src/keyboard/keymap'
import { isMacPlatform } from '../src/keyboard/platform'

type Mods = Partial<Omit<KeyLike, 'key'>>
const key = (k: string, m: Mods = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...m,
})

type Mode = KeyCtx['mode']
type Pane = KeyCtx['pane']
interface Row {
  name: string
  /** Builds the event; `mod` is the platform's Mod modifier (Ctrl on Windows, Alt/Option on Mac). */
  ev: (mod: Mods) => KeyLike
  mode: Mode
  pane: Pane | 'both'
  want: Command | null
  titleEmpty?: boolean
}

const NAV: Row[] = [
  // Plain arrows
  { name: '↑', ev: () => key('ArrowUp'), mode: 'navigate', pane: 'both', want: 'nav.up' },
  { name: '↓', ev: () => key('ArrowDown'), mode: 'navigate', pane: 'both', want: 'nav.down' },
  {
    name: '← tree',
    ev: () => key('ArrowLeft'),
    mode: 'navigate',
    pane: 'tree',
    want: 'nav.parent',
  },
  {
    name: '→ tree',
    ev: () => key('ArrowRight'),
    mode: 'navigate',
    pane: 'tree',
    want: 'nav.child',
  },
  { name: '← My Day', ev: () => key('ArrowLeft'), mode: 'navigate', pane: 'day', want: null },
  { name: '→ My Day', ev: () => key('ArrowRight'), mode: 'navigate', pane: 'day', want: null },
  { name: 'Home', ev: () => key('Home'), mode: 'navigate', pane: 'both', want: 'nav.first' },
  { name: 'End', ev: () => key('End'), mode: 'navigate', pane: 'both', want: 'nav.last' },
  // Mod+arrows
  {
    name: 'Mod+← tree',
    ev: (m) => key('ArrowLeft', m),
    mode: 'navigate',
    pane: 'tree',
    want: 'fold.collapse',
  },
  {
    name: 'Mod+→ tree',
    ev: (m) => key('ArrowRight', m),
    mode: 'navigate',
    pane: 'tree',
    want: 'fold.expand',
  },
  {
    name: 'Mod+← My Day',
    ev: (m) => key('ArrowLeft', m),
    mode: 'navigate',
    pane: 'day',
    want: null,
  },
  { name: 'Mod+↑', ev: (m) => key('ArrowUp', m), mode: 'navigate', pane: 'both', want: 'move.up' },
  {
    name: 'Mod+↓',
    ev: (m) => key('ArrowDown', m),
    mode: 'navigate',
    pane: 'both',
    want: 'move.down',
  },
  // Tab
  { name: 'Tab tree', ev: () => key('Tab'), mode: 'navigate', pane: 'tree', want: 'indent' },
  {
    name: 'Shift+Tab tree',
    ev: () => key('Tab', { shiftKey: true }),
    mode: 'navigate',
    pane: 'tree',
    want: 'outdent',
  },
  { name: 'Tab My Day', ev: () => key('Tab'), mode: 'navigate', pane: 'day', want: null },
  // Letters and the rest
  { name: 'M', ev: () => key('m'), mode: 'navigate', pane: 'both', want: 'pane.toggle' },
  { name: 'N', ev: () => key('n'), mode: 'navigate', pane: 'both', want: 'new.below' },
  { name: 'T', ev: () => key('t'), mode: 'navigate', pane: 'both', want: 'schedule.today' },
  { name: 'D', ev: () => key('d'), mode: 'navigate', pane: 'both', want: 'schedule.pick' },
  { name: 'B', ev: () => key('b'), mode: 'navigate', pane: 'both', want: 'schedule.backlog' },
  { name: 'S', ev: () => key('s'), mode: 'navigate', pane: 'both', want: 'mark.doing' },
  { name: 'W', ev: () => key('w'), mode: 'navigate', pane: 'both', want: 'mark.worked' },
  { name: 'Space', ev: () => key(' '), mode: 'navigate', pane: 'both', want: 'status.done' },
  { name: 'X', ev: () => key('x'), mode: 'navigate', pane: 'both', want: 'status.cancel' },
  {
    name: 'Shift+T (caps)',
    ev: () => key('T', { shiftKey: true }),
    mode: 'navigate',
    pane: 'both',
    want: 'schedule.today',
  },
  { name: 'Del', ev: () => key('Delete'), mode: 'navigate', pane: 'both', want: 'delete' },
  { name: 'O', ev: () => key('o'), mode: 'navigate', pane: 'both', want: 'link.open' },
  {
    name: 'Ctrl+O',
    ev: () => key('o', { ctrlKey: true }),
    mode: 'navigate',
    pane: 'both',
    want: 'detail.open',
  },
  { name: 'Z', ev: () => key('z'), mode: 'navigate', pane: 'both', want: 'toast.undo' },
  { name: 'Enter', ev: () => key('Enter'), mode: 'navigate', pane: 'both', want: 'edit.start' },
  { name: 'F2', ev: () => key('F2'), mode: 'navigate', pane: 'both', want: 'edit.start' },
  { name: 'Esc', ev: () => key('Escape'), mode: 'navigate', pane: 'both', want: 'escape' },
  {
    name: 'Ctrl+Z (stretch, unbound)',
    ev: () => key('z', { ctrlKey: true }),
    mode: 'navigate',
    pane: 'both',
    want: null,
  },
  {
    name: 'Ctrl+T',
    ev: () => key('t', { ctrlKey: true }),
    mode: 'navigate',
    pane: 'both',
    want: null,
  },
]

const EDIT: Row[] = [
  { name: 'Enter', ev: () => key('Enter'), mode: 'edit', pane: 'both', want: 'edit.commitNew' },
  { name: '↑', ev: () => key('ArrowUp'), mode: 'edit', pane: 'both', want: 'edit.prev' },
  { name: '↓', ev: () => key('ArrowDown'), mode: 'edit', pane: 'both', want: 'edit.next' },
  { name: 'Tab tree', ev: () => key('Tab'), mode: 'edit', pane: 'tree', want: 'indent' },
  {
    name: 'Shift+Tab tree',
    ev: () => key('Tab', { shiftKey: true }),
    mode: 'edit',
    pane: 'tree',
    want: 'outdent',
  },
  { name: 'Mod+↑', ev: (m) => key('ArrowUp', m), mode: 'edit', pane: 'both', want: 'move.up' },
  { name: 'Mod+↓', ev: (m) => key('ArrowDown', m), mode: 'edit', pane: 'both', want: 'move.down' },
  { name: 'Esc', ev: () => key('Escape'), mode: 'edit', pane: 'both', want: 'edit.exit' },
  {
    name: 'Backspace on empty',
    ev: () => key('Backspace'),
    mode: 'edit',
    pane: 'both',
    want: 'edit.deleteEmpty',
    titleEmpty: true,
  },
  {
    name: 'Backspace with text',
    ev: () => key('Backspace'),
    mode: 'edit',
    pane: 'both',
    want: null,
  },
  // Normal text editing
  ...['t', 'x', 'm', ' ', 'z', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].map(
    (k): Row => ({
      name: `${JSON.stringify(k)} types`,
      ev: () => key(k),
      mode: 'edit',
      pane: 'both',
      want: null,
    }),
  ),
  { name: 'Mod+← edits', ev: (m) => key('ArrowLeft', m), mode: 'edit', pane: 'tree', want: null },
  { name: 'Mod+→ edits', ev: (m) => key('ArrowRight', m), mode: 'edit', pane: 'tree', want: null },
  {
    name: 'Ctrl+← edits',
    ev: () => key('ArrowLeft', { ctrlKey: true }),
    mode: 'edit',
    pane: 'tree',
    want: null,
  },
]

const PLATFORMS = [
  { isMac: false, label: 'Windows', mod: { ctrlKey: true } },
  { isMac: true, label: 'Mac', mod: { altKey: true } },
] as const

describe.each(PLATFORMS)('resolveKey on $label', ({ isMac, mod }) => {
  const cases = [...NAV, ...EDIT].flatMap((r) =>
    (r.pane === 'both' ? (['tree', 'day'] as const) : [r.pane]).map((pane) => ({ ...r, pane })),
  )
  it.each(cases)('$mode $pane: $name → $want', ({ ev, mode, pane, want, titleEmpty }) => {
    expect(resolveKey(ev(mod), { mode, pane, isMac, titleEmpty: titleEmpty ?? false })).toBe(want)
  })

  const everywhere = (['navigate', 'edit'] as const).flatMap((mode) =>
    (['tree', 'day'] as const).map((pane): KeyCtx => ({ mode, pane, isMac, titleEmpty: false })),
  )
  it.each(everywhere)('Ctrl+N and Ctrl+1–9 are never bound ($mode, $pane)', (ctx) => {
    expect(resolveKey(key('n', { ctrlKey: true }), ctx)).toBeNull()
    for (const d of '123456789') expect(resolveKey(key(d, { ctrlKey: true }), ctx)).toBeNull()
  })
})

describe('the Mod key per platform', () => {
  const tree: Omit<KeyCtx, 'isMac'> = { mode: 'navigate', pane: 'tree', titleEmpty: false }
  it('Windows folds with Ctrl+←/→, never Alt+←/→', () => {
    const win = { ...tree, isMac: false }
    expect(resolveKey(key('ArrowLeft', { ctrlKey: true }), win)).toBe('fold.collapse')
    expect(resolveKey(key('ArrowRight', { ctrlKey: true }), win)).toBe('fold.expand')
    for (const ctx of [win, { ...win, pane: 'day' as const }, { ...win, mode: 'edit' as const }]) {
      expect(resolveKey(key('ArrowLeft', { altKey: true }), ctx)).toBeNull()
      expect(resolveKey(key('ArrowRight', { altKey: true }), ctx)).toBeNull()
      expect(resolveKey(key('ArrowUp', { altKey: true }), ctx)).toBeNull()
    }
  })
  it('Mac folds with Option+←/→; Cmd+← (browser Back) and Ctrl+arrows are not bound', () => {
    const mac = { ...tree, isMac: true }
    expect(resolveKey(key('ArrowLeft', { altKey: true }), mac)).toBe('fold.collapse')
    expect(resolveKey(key('ArrowRight', { altKey: true }), mac)).toBe('fold.expand')
    expect(resolveKey(key('ArrowLeft', { metaKey: true }), mac)).toBeNull()
    expect(resolveKey(key('ArrowRight', { metaKey: true }), mac)).toBeNull()
    expect(resolveKey(key('ArrowLeft', { ctrlKey: true }), mac)).toBeNull()
    expect(resolveKey(key('ArrowUp', { ctrlKey: true }), mac)).toBeNull()
    expect(resolveKey(key('ArrowLeft', { altKey: true }), { ...mac, mode: 'edit' })).toBeNull()
  })
  it('extra modifiers do not match: Ctrl+Shift+↑, Alt+T, Meta+Space', () => {
    const win = { ...tree, isMac: false }
    expect(resolveKey(key('ArrowUp', { ctrlKey: true, shiftKey: true }), win)).toBeNull()
    expect(resolveKey(key('t', { altKey: true }), win)).toBeNull()
    expect(resolveKey(key(' ', { metaKey: true }), win)).toBeNull()
    expect(resolveKey(key('Tab', { ctrlKey: true }), win)).toBeNull()
  })
})

describe('isMacPlatform', () => {
  const nav = (o: object) => o as Navigator
  it('reads userAgentData first, then platform', () => {
    expect(isMacPlatform(nav({ userAgentData: { platform: 'macOS' }, platform: '' }))).toBe(true)
    expect(isMacPlatform(nav({ platform: 'MacIntel' }))).toBe(true)
    expect(isMacPlatform(nav({ userAgentData: { platform: 'Windows' }, platform: 'Win32' }))).toBe(
      false,
    )
    expect(isMacPlatform(nav({ platform: 'Linux x86_64' }))).toBe(false)
    expect(isMacPlatform(nav({}))).toBe(false)
  })
})
