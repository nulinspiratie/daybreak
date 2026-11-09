import type { ISODate, Task, TreeNode } from '@daybreak/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useDay, useMutate, useStatus, useTree } from '../api/hooks'
import { pickDay } from '../keyboard/commands'
import { SkippedWrite } from '../tree/optimistic'
import { useUi } from '../ui/store'
import { DayPicker } from './DayPicker'

const WIDTH = 646 // 620 plus the card's padding and border
const GAP = 6
const MARGIN = 8

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    const hit = n.id === id ? n : findNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}

/** Just under the selected row, flipped above it near the bottom, kept inside the window. */
function place(row: Element | null, height: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r = row?.getBoundingClientRect()
  if (!r) return { left: Math.max(MARGIN, (vw - WIDTH) / 2), top: Math.max(MARGIN, (vh - height) / 3) }
  const below = r.bottom + GAP
  const top = below + height + MARGIN <= vh ? below : Math.max(MARGIN, r.top - GAP - height)
  return { left: Math.min(Math.max(MARGIN, r.left + 40), Math.max(MARGIN, vw - WIDTH - MARGIN)), top }
}

/**
 * The main window's day picker: a card floating by the selected row, over the panes, with a
 * click-away backdrop. The keys belong to the picker while it is open (the global handler stands
 * aside); closing leaves the selection and the pane as they were, in navigate mode.
 */
export function PickerHost() {
  const picker = useUi((s) => s.picker)
  return picker ? <OpenPicker taskId={picker.taskId} allowNoDay={picker.allowNoDay} /> : null
}

function OpenPicker({ taskId, allowNoDay }: { taskId: string; allowNoDay: boolean }) {
  const setUi = useUi((s) => s.set)
  const showCompleted = useUi((s) => s.showCompleted)
  const { data: status } = useStatus()
  const { data: tree } = useTree(showCompleted ? 'all' : 'recent')
  const today = status?.today ?? ''
  const { data: day } = useDay(today)
  const mutate = useMutate()
  const card = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  const task: Task | undefined =
    (tree && findNode([...tree.inbox, ...tree.projects], taskId)) ?? day?.items.find((i) => i.task.id === taskId)?.task

  // Measured once the card has its height, before it paints.
  useLayoutEffect(() => {
    const pane = useUi.getState().pane
    const row = document.querySelector(`.pane--${pane} [data-id="${CSS.escape(taskId)}"]`)
    setAt(place(row, card.current?.offsetHeight ?? 0))
  }, [taskId])

  const close = useCallback(() => {
    setUi({ picker: null, editing: null })
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [setUi])

  // The task was deleted or hidden while the picker was open.
  const gone = task === undefined && tree !== undefined && day !== undefined
  useEffect(() => {
    if (gone) close()
  }, [gone, close])

  const pick = (date: ISODate | null) => {
    close()
    if (!task) return
    pickDay({ api, mutate }, task, date).catch((e: unknown) => {
      if (!(e instanceof SkippedWrite)) console.error(e)
    })
  }

  if (today === '' || !task) return null
  return (
    <div className="picker-host">
      <div className="picker-host__backdrop" onMouseDown={close} aria-hidden="true" />
      <div
        ref={card}
        className="picker-host__card"
        role="dialog"
        aria-label="Schedule task"
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && close()} // from the Close button; the picker handles its own
        style={at ? { left: at.left, top: at.top } : { opacity: 0 }} // not visibility: a hidden input cannot take focus
      >
        <div className="picker-host__head">
          <span className="picker-host__lead">Schedule</span>
          <span className="picker-host__title">{task.title}</span>
          <span className="picker-host__grow" />
          <button type="button" className="picker-host__close" onClick={close}>
            Close <span className="kbd">Esc</span>
          </button>
        </div>
        <DayPicker today={today} initial={task.scheduledOn} allowNoDay={allowNoDay} onPick={pick} onClose={close} />
      </div>
    </div>
  )
}
