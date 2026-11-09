import { useEffect } from 'react'
import { confirmNoteText } from '../keyboard/commands'
import { useUi } from '../ui/store'

export const CONFIRM_NOTE_ID = 'confirm-note'

/**
 * The visible "4 open subtasks. Press Space again to close them all." under a row. It sits
 * between treeitems, so it is hidden from the accessibility tree; the row points at it with
 * aria-describedby and ConfirmLive announces it.
 */
export function ConfirmNote({ depth }: { depth?: number }) {
  const confirm = useUi((s) => s.confirm)
  if (!confirm) return null
  // My Day rows have no day column or indent: the note lines up with the row's text.
  if (depth === undefined) {
    return (
      <div className="row-note row-note--day" aria-hidden="true">
        <span className="row-note__text" id={CONFIRM_NOTE_ID}>
          {confirmNoteText(confirm)}
        </span>
      </div>
    )
  }
  return (
    <div className="row-note" aria-hidden="true">
      <span className="day" />
      <span className="row__handle" />
      <span className="row__indent" style={{ width: depth * 22 }} />
      <span className="row__chev-gap" />
      <span className="row-note__text" id={CONFIRM_NOTE_ID}>
        {confirmNoteText(confirm)}
      </span>
    </div>
  )
}

/** Announces the confirm note (outside the tree) and dismisses it when its 4 s are up. Mounted once, in App. */
export function ConfirmLive() {
  const confirm = useUi((s) => s.confirm)
  useEffect(() => {
    if (!confirm) return
    const timer = setTimeout(
      () => {
        const ui = useUi.getState()
        if (ui.confirm === confirm) ui.set({ confirm: null })
      },
      Math.max(0, confirm.until - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [confirm])
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {confirm ? confirmNoteText(confirm) : ''}
    </div>
  )
}
