export type Command =
  | 'nav.up'
  | 'nav.down'
  | 'nav.parent'
  | 'nav.child'
  | 'nav.first'
  | 'nav.last'
  | 'fold.collapse'
  | 'fold.expand'
  | 'move.up'
  | 'move.down'
  | 'indent'
  | 'outdent'
  | 'pane.toggle'
  | 'edit.start'
  | 'new.below'
  | 'schedule.today'
  | 'schedule.pick'
  | 'schedule.backlog'
  | 'mark.doing'
  | 'mark.worked'
  | 'status.done'
  | 'status.cancel'
  | 'delete'
  | 'detail.open'
  | 'link.open'
  | 'escape'
  | 'toast.undo'
  | 'edit.commitNew'
  | 'edit.prev'
  | 'edit.next'
  | 'edit.deleteEmpty'
  | 'edit.exit'

export interface KeyCtx {
  mode: 'navigate' | 'edit'
  pane: 'tree' | 'day'
  isMac: boolean
  titleEmpty: boolean
}

export interface KeyLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Which modifiers are held, with Mod resolved per platform (Ctrl on Windows, Option on macOS). */
type Chord = 'plain' | 'shift' | 'mod' | 'ctrl' | 'other'

function chordOf(e: KeyLike, isMac: boolean): Chord {
  const { ctrlKey: c, altKey: a, shiftKey: s, metaKey: m } = e
  if (m) return 'other'
  if (!c && !a) return s ? 'shift' : 'plain'
  if (s) return 'other'
  if (isMac ? a && !c : c && !a) return 'mod'
  if (c && !a) return 'ctrl'
  return 'other'
}

const LETTERS: Record<string, Command> = {
  m: 'pane.toggle',
  n: 'new.below',
  t: 'schedule.today',
  d: 'schedule.pick',
  b: 'schedule.backlog',
  s: 'mark.doing',
  w: 'mark.worked',
  x: 'status.cancel',
  o: 'link.open',
  z: 'toast.undo',
}

const NAVIGATE_PLAIN: Record<string, Command> = {
  ArrowUp: 'nav.up',
  ArrowDown: 'nav.down',
  Home: 'nav.first',
  End: 'nav.last',
  ' ': 'status.done',
  Delete: 'delete',
  Enter: 'edit.start',
  F2: 'edit.start',
  Escape: 'escape',
}

function navigate(e: KeyLike, chord: Chord, tree: boolean): Command | null {
  const k = e.key
  if (chord === 'mod') {
    if (k === 'ArrowUp') return 'move.up'
    if (k === 'ArrowDown') return 'move.down'
    if (tree && k === 'ArrowLeft') return 'fold.collapse'
    if (tree && k === 'ArrowRight') return 'fold.expand'
  }
  // Ctrl+O is Ctrl on every platform (DESIGN says Ctrl+O, not Mod+O).
  if ((chord === 'ctrl' || (chord === 'mod' && e.ctrlKey)) && k.toLowerCase() === 'o')
    return 'detail.open'
  if (k === 'Tab' && tree && (chord === 'plain' || chord === 'shift'))
    return chord === 'plain' ? 'indent' : 'outdent'
  if (chord === 'plain' || chord === 'shift') {
    // Shift (or Caps Lock) does not change a letter's meaning.
    if (k.length === 1 && LETTERS[k.toLowerCase()]) return LETTERS[k.toLowerCase()]!
  }
  if (chord !== 'plain') return null
  if (tree && k === 'ArrowLeft') return 'nav.parent'
  if (tree && k === 'ArrowRight') return 'nav.child'
  return NAVIGATE_PLAIN[k] ?? null
}

function edit(e: KeyLike, chord: Chord, tree: boolean, titleEmpty: boolean): Command | null {
  const k = e.key
  if (chord === 'mod') {
    if (k === 'ArrowUp') return 'move.up'
    if (k === 'ArrowDown') return 'move.down'
    return null
  }
  if (k === 'Tab' && tree && (chord === 'plain' || chord === 'shift'))
    return chord === 'plain' ? 'indent' : 'outdent'
  if (chord !== 'plain') return null
  if (k === 'Enter') return 'edit.commitNew'
  if (k === 'ArrowUp') return 'edit.prev'
  if (k === 'ArrowDown') return 'edit.next'
  if (k === 'Escape') return 'edit.exit'
  if (k === 'Backspace' && titleEmpty) return 'edit.deleteEmpty'
  // Everything else (letters, ← →, Home, End, Del, Ctrl+←→) is normal text editing.
  return null
}

/** The docs/design.md "Keyboard map" as a pure function. Null means "let the browser have it". */
export function resolveKey(e: KeyLike, ctx: KeyCtx): Command | null {
  const chord = chordOf(e, ctx.isMac)
  if (chord === 'other') return null
  const tree = ctx.pane === 'tree'
  return ctx.mode === 'edit' ? edit(e, chord, tree, ctx.titleEmpty) : navigate(e, chord, tree)
}
