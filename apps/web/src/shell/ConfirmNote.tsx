import { useEffect } from 'react'
import { confirmNoteText } from '../keyboard/commands'
import { useUi } from '../ui/store'

/** "4 open subtasks. Press Space again to close them all." under a row; gone after 4 s. */
export function ConfirmNote({ depth }: { depth: number }) {
  const confirm = useUi((s) => s.confirm)
  useEffect(() => {
    if (!confirm) return
    const timer = setTimeout(() => {
      const ui = useUi.getState()
      if (ui.confirm === confirm) ui.set({ confirm: null })
    }, Math.max(0, confirm.until - Date.now()))
    return () => clearTimeout(timer)
  }, [confirm])
  if (!confirm) return null
  return (
    <div className="row-note" role="status">
      <span className="day" />
      <span className="row__handle" />
      <span className="row__indent" style={{ width: depth * 22 }} />
      <span className="row__chev-gap" />
      <span className="row-note__text">{confirmNoteText(confirm)}</span>
    </div>
  )
}
