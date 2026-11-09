import { Fragment, useCallback } from 'react'
import { useDay, useStatus } from '../api/hooks'
import type { Command } from '../keyboard/keymap'
import { useCommandRunner } from '../keyboard/useKeyboard'
import { CONFIRM_NOTE_ID, ConfirmNote } from '../shell/ConfirmNote'
import { longDate } from '../shell/TitleBar'
import { useUi } from '../ui/store'
import { AddField } from './AddField'
import { DayRow } from './DayRow'

export function MyDayPane() {
  const today = useStatus().data?.today ?? ''
  const { data: day } = useDay(today)
  const daySel = useUi((s) => s.daySel)
  const editingId = useUi((s) => (s.pane === 'day' ? s.editing?.id : undefined))
  const confirmId = useUi((s) => (s.pane === 'day' ? s.confirm?.id : undefined))
  const setUi = useUi((s) => s.set)
  const runCommand = useCommandRunner()

  const items = day?.items ?? []
  // Cancelled items are left out of both numbers.
  const counted = items.filter((i) => i.task.status !== 'cancelled')
  const done = counted.filter((i) => i.task.status === 'done').length
  const percent = counted.length === 0 ? 0 : Math.round((done / counted.length) * 100)

  const onSelect = useCallback((id: string) => setUi({ daySel: id, pane: 'day' }), [setUi])
  // Controls select the row and run the same command as the key, so a click follows the same rules.
  const onRowCommand = useCallback(
    (id: string, cmd: Command) => {
      setUi({ daySel: id, pane: 'day' })
      runCommand(cmd)
    },
    [setUi, runCommand],
  )
  const onToggleDone = useCallback((id: string) => onRowCommand(id, 'status.done'), [onRowCommand])
  const onDoing = useCallback((id: string) => onRowCommand(id, 'mark.doing'), [onRowCommand])
  // Blur from the title editor; one that comes after editing moved elsewhere is ignored.
  const onLeaveEdit = useCallback(
    (id: string) => {
      if (useUi.getState().editing?.id === id) runCommand('edit.exit')
    },
    [runCommand],
  )

  return (
    <section className="pane pane--day" aria-label="My Day">
      <div className="dayhead">
        <div className="dayhead__title">
          <h2>My Day</h2>
          <span className="dayhead__date">{today ? longDate(today) : ''}</span>
        </div>
        <span className="dayhead__grow" />
        <div className="dayhead__progress">
          <span className="dayhead__count">{done} of {counted.length} done</span>
          <div
            className="progress"
            role="progressbar"
            aria-label="Done today"
            aria-valuemin={0}
            aria-valuemax={counted.length}
            aria-valuenow={done}
          >
            <div className="progress__fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>

      <div className="daybody">
        <div className="daylist" role="list" aria-label="Today's tasks">
          {items.map((item) => (
            <Fragment key={item.task.id}>
              <DayRow
                item={item}
                selected={daySel === item.task.id}
                editing={editingId === item.task.id}
                onSelect={onSelect}
                onToggleDone={onToggleDone}
                onDoing={onDoing}
                onLeaveEdit={onLeaveEdit}
                describedBy={confirmId === item.task.id ? CONFIRM_NOTE_ID : undefined}
              />
              {confirmId === item.task.id && <ConfirmNote />}
            </Fragment>
          ))}
        </div>
        <AddField today={today} />
        <div className="dayspace" />
        {day && items.length === 0 && (
          <p className="dayempty">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
              <path d="M2 8h9M8 4.5 11.5 8 8 11.5M14 3v10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Drag tasks in from the tree, or press T on a selected task
          </p>
        )}
      </div>
    </section>
  )
}
