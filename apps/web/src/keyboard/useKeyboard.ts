import type { Task, TreeNode, TreeView } from '@daybreak/core'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ApiError, api, isUnreachable } from '../api/client'
import { useDay, useMutate, useStatus, useTree } from '../api/hooks'
import { toast } from '../shell/toastStore'
import { flatten } from '../tree/flatten'
import { SkippedWrite, treeCache } from '../tree/optimistic'
import { useUi } from '../ui/store'
import { type CommandEnv, runCommand } from './commands'
import { type Command, resolveKey } from './keymap'
import { IS_MAC } from './platform'

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'])

function findTask(tree: TreeView | undefined, id: string): Task | undefined {
  const walk = (nodes: TreeNode[]): TreeNode | undefined => {
    for (const n of nodes) {
      const hit = n.id === id ? n : walk(n.children)
      if (hit) return hit
    }
    return undefined
  }
  return tree && walk([...tree.inbox, ...tree.projects])
}

/** Returns a stable getter for the latest rows, day and UI state, with the api, queue and cache; null until status loads. */
export function useCommandEnv(): () => CommandEnv | null {
  const showCompleted = useUi((s) => s.showCompleted)
  const draft = useUi((s) => s.draft)
  const { data: tree } = useTree(showCompleted ? 'all' : 'recent')
  const today = useStatus().data?.today ?? ''
  const { data: day } = useDay(today)
  const detailId = useUi((s) => s.detailId)
  const mutate = useMutate()
  const qc = useQueryClient()
  const cache = useMemo(() => treeCache(qc), [qc])
  const rows = useMemo(() => (tree ? flatten(tree, draft) : []), [tree, draft])

  const detailTask = useMemo(
    () => (detailId === null ? undefined : (findTask(tree, detailId) ?? day?.items.find((i) => i.task.id === detailId)?.task)),
    [tree, day, detailId],
  )
  const latest = useRef({ rows, dayItems: day?.items ?? [], today, detailTask })
  latest.current = { rows, dayItems: day?.items ?? [], today, detailTask }

  return useCallback(() => {
    if (latest.current.today === '') return null // status not loaded yet
    return { ...latest.current, ui: useUi.getState(), api, cache, mutate, now: Date.now, toast }
  }, [mutate, cache])
}

/** What a failed write's toast says: the server's own message, if it sent one. */
export function writeErrorMessage(e: unknown): string {
  return e instanceof ApiError && !isUnreachable(e) ? e.message : "Couldn't save — is Daybreak running?"
}

/**
 * Reports a failed write in a toast (a newer toast replaces older ones, R27). The refetch when the
 * queue drains shows the true state again. A write skipped because its task was never created
 * says nothing: that create's own toast already did (R29).
 */
export function reportWriteError(e: unknown): void {
  if (e instanceof SkippedWrite) return
  console.error(e)
  toast.show({ message: writeErrorMessage(e) })
}

/** Returns a stable function that runs a command against the latest rows, day and UI state. */
export function useCommandRunner(): (cmd: Command) => void {
  const getEnv = useCommandEnv()
  return useCallback(
    (cmd: Command) => {
      const env = getEnv()
      if (env) runCommand(cmd, env).catch(reportWriteError)
    },
    [getEnv],
  )
}

function isTextField(el: HTMLElement): boolean {
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/** Only these repeat while a key is held (moving, and ↑↓ between titles); one-shot commands (Space, X, Del, letters…) fire once per press. */
const repeats = (cmd: Command) =>
  cmd.startsWith('nav.') || cmd.startsWith('move.') || cmd === 'edit.prev' || cmd === 'edit.next'

/**
 * The keydown handler for the tree and My Day. It stands aside for the review, IME composition,
 * and text fields other than a row's title editor (marked `data-title-editor`). A focused
 * button or link keeps its native Space and Enter (row controls drop focus after a mouse click,
 * so after a click these keys reach the selected row).
 */
export function createKeyHandler(run: (cmd: Command) => void): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.isComposing || e.defaultPrevented) return
    const ui = useUi.getState()
    // A drag owns the keys: dnd-kit's own Esc cancels it, and nothing else may act meanwhile.
    if (ui.reviewOpen || ui.dragging) return
    if (ui.picker) {
      // The picker owns the keys from the moment it opens. Once its card is shown it handles them;
      // until then (R32: still loading) they do nothing, except Esc, which closes it.
      if (!ui.pickerShown && e.key === 'Escape') {
        e.preventDefault()
        ui.set({ picker: null })
      }
      return
    }
    const el = e.target instanceof HTMLElement ? e.target : null
    if (el && isTextField(el) && !el.closest('[data-title-editor]')) return
    if (el && (e.key === ' ' || e.key === 'Enter') && el.closest('button, a')) return

    const mode = ui.editing ? 'edit' : 'navigate'
    const titleEmpty = el instanceof HTMLInputElement && el.value === ''
    const cmd = resolveKey(e, { mode, pane: ui.pane, isMac: IS_MAC, titleEmpty })
    if (cmd === null) {
      // Any other key dismisses the "Press Space again" note.
      if (ui.confirm && !MODIFIERS.has(e.key)) ui.set({ confirm: null })
      return
    }
    // With nothing selected, or from a control in the detail panel, Tab moves focus as usual.
    const selected = ui.pane === 'tree' ? ui.treeSel : ui.daySel
    if ((cmd === 'indent' || cmd === 'outdent') && (selected === null || el?.closest('.pane--detail'))) return
    e.preventDefault()
    // A held Space must not count as the second press of a parent close, nor a held Del delete row after row.
    if (e.repeat && !repeats(cmd)) return
    run(cmd)
  }
}

/** Attaches the one window keydown listener. Mounted once, in App. */
export function useKeyboard(): void {
  const run = useCommandRunner()
  useEffect(() => {
    const onKeyDown = createKeyHandler(run)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [run])
}
