import type { ISODate, Task, TreeNode } from '@daybreak/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useDay, useMutate, useStatus, useTree } from '../api/hooks'
import { pickDay } from '../keyboard/commands'
import { reportWriteError } from '../keyboard/useKeyboard'
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

/** Just under the selected row (above it near the bottom), kept inside the window. */
function place(row: Element | null, height: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(WIDTH, vw - 2 * MARGIN)
  const maxTop = Math.max(MARGIN, vh - height - MARGIN)
  const r = row?.getBoundingClientRect()
  if (!r)
    return {
      left: Math.max(MARGIN, (vw - width) / 2),
      top: Math.min(maxTop, Math.max(MARGIN, (vh - height) / 3)),
    }
  const below = r.bottom + GAP
  const top = below + height + MARGIN <= vh ? below : r.top - GAP - height
  return {
    left: Math.min(Math.max(MARGIN, r.left + 40), Math.max(MARGIN, vw - width - MARGIN)),
    top: Math.min(maxTop, Math.max(MARGIN, top)),
  }
}

/**
 * The main window's day picker: a card floating by the selected row, over the panes, with a
 * click-away backdrop. The keys belong to the picker while it is open (the global handler stands
 * aside, and only takes Esc before the card is shown); closing leaves the selection and the pane
 * as they were, in navigate mode.
 * If the task or the data cannot be had, the picker closes rather than sit there unseen (R32).
 */
export function PickerHost() {
  const picker = useUi((s) => s.picker)
  return picker ? <OpenPicker taskId={picker.taskId} allowNoDay={picker.allowNoDay} /> : null
}

function OpenPicker({ taskId, allowNoDay }: { taskId: string; allowNoDay: boolean }) {
  const setUi = useUi((s) => s.set)
  const showCompleted = useUi((s) => s.showCompleted)
  const status = useStatus()
  const tree = useTree(showCompleted ? 'all' : 'recent')
  const today = status.data?.today ?? ''
  const day = useDay(today)
  const mutate = useMutate()

  const task: Task | undefined =
    (tree.data && findNode([...tree.data.inbox, ...tree.data.projects], taskId)) ??
    day.data?.items.find((i) => i.task.id === taskId)?.task

  const close = useCallback(() => {
    setUi({ picker: null, pickerShown: false, editing: null })
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [setUi])

  // Nothing to show: the status failed, or the task is in neither answered query (deleted, hidden).
  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError
  const unusable = status.isError || (!task && settled(tree) && (settled(day) || today === ''))
  useEffect(() => {
    if (unusable) close()
  }, [unusable, close])

  const pick = (date: ISODate | null) => {
    close()
    if (!task) return
    pickDay({ api, mutate }, task, date).catch(reportWriteError)
  }

  if (today === '' || !task) return null
  return <Card task={task} today={today} allowNoDay={allowNoDay} close={close} pick={pick} />
}

function Card(p: {
  task: Task
  today: ISODate
  allowNoDay: boolean
  close: () => void
  pick: (date: ISODate | null) => void
}) {
  const setUi = useUi((s) => s.set)
  const card = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  // Measured once the card has its height, before it paints, and again if the window is resized.
  useLayoutEffect(() => {
    const measure = () => {
      const pane = useUi.getState().pane
      const row = document.querySelector(`.pane--${pane} [data-id="${CSS.escape(p.task.id)}"]`)
      setAt(place(row, card.current?.offsetHeight ?? 0))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [p.task.id])

  // From now on the picker owns the keys.
  useEffect(() => {
    setUi({ pickerShown: true })
    return () => setUi({ pickerShown: false })
  }, [setUi])

  return (
    <div className="picker-host">
      <div className="picker-host__backdrop" onMouseDown={p.close} aria-hidden="true" />
      <div
        ref={card}
        className="picker-host__card"
        role="dialog"
        aria-label="Schedule task"
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && p.close()} // from the Close button; the picker handles its own
        style={at ? { left: at.left, top: at.top } : { opacity: 0 }} // not visibility: a hidden input cannot take focus
      >
        <div className="picker-host__head">
          <span className="picker-host__lead">Schedule</span>
          <span className="picker-host__title">{p.task.title}</span>
          <span className="picker-host__grow" />
          <button type="button" className="picker-host__close" onClick={p.close}>
            Close <span className="kbd">Esc</span>
          </button>
        </div>
        <DayPicker
          today={p.today}
          initial={p.task.scheduledOn}
          allowNoDay={p.allowNoDay}
          onPick={p.pick}
          onClose={p.close}
        />
      </div>
    </div>
  )
}
