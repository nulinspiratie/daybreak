import { undo } from '../keyboard/commands'
import { reportWriteError, useCommandEnv } from '../keyboard/useKeyboard'
import { useToastStore } from './toastStore'

/** Dark toast at the bottom centre. The live region stays mounted so screen readers hear each toast. */
export function Toast() {
  const t = useToastStore((s) => s.toast)
  const undoId = t?.undoId
  const getEnv = useCommandEnv()
  // The button undoes the change this toast is about, even if newer ones came after it.
  const onUndo = (id: number) => {
    const env = getEnv()
    if (env) undo(env, id).catch(reportWriteError)
  }
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {t && (
        <div className="toast" key={t.id}>
          <span className="toast__msg">{t.message}</span>
          {undoId !== undefined && (
            <>
              <span className="toast__sep" aria-hidden="true">
                {' '}
                ·{' '}
              </span>
              <button type="button" className="toast__undo" onClick={() => onUndo(undoId)}>
                Undo (Z)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
