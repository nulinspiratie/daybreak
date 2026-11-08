import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from '../api/client'
import { useDay, useMutate, useStatus, useTree } from '../api/hooks'
import { toast } from '../shell/toastStore'
import { flatten } from '../tree/flatten'
import { useUi } from '../ui/store'
import { runCommand } from './commands'
import { type Command, resolveKey } from './keymap'
import { IS_MAC } from './platform'

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'])

/** Returns a stable function that runs a command against the latest rows, day and UI state. */
export function useCommandRunner(): (cmd: Command) => void {
  const showCompleted = useUi((s) => s.showCompleted)
  const draft = useUi((s) => s.draft)
  const { data: tree } = useTree(showCompleted ? 'all' : 'recent')
  const today = useStatus().data?.today ?? ''
  const { data: day } = useDay(today)
  const mutate = useMutate()
  const rows = useMemo(() => (tree ? flatten(tree, draft) : []), [tree, draft])

  const latest = useRef({ rows, dayItems: day?.items ?? [], today })
  latest.current = { rows, dayItems: day?.items ?? [], today }

  return useCallback(
    (cmd: Command) => {
      const env = { ...latest.current, ui: useUi.getState(), api, mutate, now: Date.now, toast }
      if (env.today === '') return // status not loaded yet
      runCommand(cmd, env).catch((e: unknown) => console.error(e))
    },
    [mutate],
  )
}

function isTextField(el: HTMLElement): boolean {
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/**
 * The one keydown listener for the tree and My Day. It stands aside for the review, IME
 * composition and text fields other than a row's title editor (marked `data-title-editor`,
 * Task 17), and lets buttons outside the rows keep Space and Enter.
 */
export function useKeyboard(): void {
  const run = useCommandRunner()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return
      const ui = useUi.getState()
      if (ui.reviewOpen) return
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && isTextField(el) && !el.closest('[data-title-editor]')) return
      if (el && (e.key === ' ' || e.key === 'Enter') && el.closest('button, a') && !el.closest('[role="treeitem"]')) return

      const mode = ui.editing ? 'edit' : 'navigate'
      const titleEmpty = el instanceof HTMLInputElement && el.value === ''
      const cmd = resolveKey(e, { mode, pane: ui.pane, isMac: IS_MAC, titleEmpty })
      if (cmd === null) {
        // Any other key dismisses the "Press Space again" note.
        if (ui.confirm && !MODIFIERS.has(e.key)) ui.set({ confirm: null })
        return
      }
      // With nothing selected, Tab moves focus as usual.
      const selected = ui.pane === 'tree' ? ui.treeSel : ui.daySel
      if ((cmd === 'indent' || cmd === 'outdent') && selected === null) return
      e.preventDefault()
      run(cmd)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [run])
}
