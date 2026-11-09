// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command } from '../src/keyboard/keymap'
import { createKeyHandler } from '../src/keyboard/useKeyboard'
import { useUi } from '../src/ui/store'

let run: ReturnType<typeof vi.fn<(cmd: Command) => void>>
let handler: (e: KeyboardEvent) => void

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}
function add<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, parent: HTMLElement = document.body) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  parent.appendChild(el)
  return el
}

beforeEach(() => {
  run = vi.fn<(cmd: Command) => void>()
  handler = createKeyHandler((cmd) => run(cmd))
  window.addEventListener('keydown', handler)
  useUi.getState().set({ pane: 'tree', treeSel: 't1', daySel: null, editing: null, confirm: null, reviewOpen: false, picker: null })
})
afterEach(() => {
  window.removeEventListener('keydown', handler)
  document.body.innerHTML = ''
})

describe('the global keydown filter', () => {
  it('runs a handled key and calls preventDefault', () => {
    const e = press(document.body, 'ArrowDown')
    expect(run).toHaveBeenCalledWith('nav.down')
    expect(e.defaultPrevented).toBe(true)
  })

  it('leaves unhandled keys alone', () => {
    const e = press(document.body, 'q')
    expect(run).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('auto-repeat repeats nav and move, but never a one-shot command', () => {
    press(document.body, 'ArrowDown', { repeat: true })
    press(document.body, 'ArrowUp', { repeat: true, ctrlKey: true })
    press(document.body, 'ArrowUp', { repeat: true, altKey: true })
    expect(run.mock.calls).toHaveLength(2) // nav.down, and move.up for this platform's Mod
    expect(run.mock.calls.map((c) => c[0]).every((c) => c.startsWith('nav.') || c.startsWith('move.'))).toBe(true)
    run.mockClear()
    for (const key of [' ', 'x', 'Delete', 'z', 'm', 't', 'b', 's', 'w', 'o', 'Enter', 'n']) {
      const e = press(document.body, key, { repeat: true })
      expect(e.defaultPrevented).toBe(true) // e.g. a held Space must not scroll the page
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('ignores IME composition', () => {
    const e = press(document.body, ' ', { isComposing: true })
    expect(run).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('stands aside while the review is open', () => {
    useUi.getState().set({ reviewOpen: true })
    press(document.body, ' ')
    expect(run).not.toHaveBeenCalled()
  })

  it('stands aside while the day picker is open', () => {
    useUi.getState().set({ picker: { taskId: 't1', allowNoDay: true } })
    press(document.body, 'd')
    press(document.body, 'ArrowDown')
    expect(run).not.toHaveBeenCalled()
    useUi.getState().set({ picker: null })
  })

  it('ignores text fields other than a row title editor', () => {
    const input = add('input')
    const area = add('textarea')
    const editable = add('div', { contenteditable: 'true' })
    for (const el of [input, area, editable]) {
      const e = press(el, 'x')
      expect(e.defaultPrevented).toBe(false)
      press(el, 'ArrowDown')
    }
    expect(run).not.toHaveBeenCalled()

    useUi.getState().set({ editing: { id: 't1', initial: 'a', text: 'a' } })
    const editor = add('input', { 'data-title-editor': '' })
    press(editor, 'Escape')
    press(editor, 'x')
    expect(run.mock.calls).toEqual([['edit.exit']])
  })

  it('a row title editor with an empty value resolves Backspace to edit.deleteEmpty', () => {
    useUi.getState().set({ editing: { id: 't1', initial: '', text: '' } })
    const editor = add('input', { 'data-title-editor': '' })
    press(editor, 'Backspace')
    ;(editor as HTMLInputElement).value = 'abc'
    press(editor, 'Backspace')
    expect(run.mock.calls).toEqual([['edit.deleteEmpty']])
  })

  it('in edit mode a held ↑ or ↓ repeats, while a held Enter, Esc or Backspace does not', () => {
    useUi.getState().set({ editing: { id: 't1', initial: '', text: '' } })
    const editor = add('input', { 'data-title-editor': '' })
    press(editor, 'ArrowDown', { repeat: true })
    press(editor, 'ArrowUp', { repeat: true })
    press(editor, 'Enter', { repeat: true })
    press(editor, 'Escape', { repeat: true })
    press(editor, 'Backspace', { repeat: true })
    expect(run.mock.calls).toEqual([['edit.next'], ['edit.prev']])
  })

  it('a focused button keeps native Space and Enter, in a row or not', () => {
    const header = add('button')
    const row = add('div', { role: 'treeitem' })
    const cb = add('button', {}, row)
    for (const el of [header, cb]) {
      expect(press(el, ' ').defaultPrevented).toBe(false)
      expect(press(el, 'Enter').defaultPrevented).toBe(false)
    }
    expect(run).not.toHaveBeenCalled()
    press(cb, 's')
    expect(run).toHaveBeenCalledWith('mark.doing')
  })

  it('Tab moves focus as usual when nothing is selected', () => {
    useUi.getState().set({ treeSel: null })
    expect(press(document.body, 'Tab').defaultPrevented).toBe(false)
    useUi.getState().set({ treeSel: 't1' })
    expect(press(document.body, 'Tab').defaultPrevented).toBe(true)
    expect(run.mock.calls).toEqual([['indent']])
  })

  it('any unhandled key dismisses the confirm note; a bare modifier does not', () => {
    useUi.getState().set({ confirm: { id: 't1', status: 'done', openCount: 2, until: Date.now() + 4000 } })
    press(document.body, 'Shift')
    expect(useUi.getState().confirm).not.toBeNull()
    press(document.body, 'q')
    expect(useUi.getState().confirm).toBeNull()
  })
})
