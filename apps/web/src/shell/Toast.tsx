import { useCommandRunner } from '../keyboard/useKeyboard'
import { useToastStore } from './toastStore'

/** Dark toast at the bottom centre. The live region stays mounted so screen readers hear each toast. */
export function Toast() {
  const t = useToastStore((s) => s.toast)
  const run = useCommandRunner()
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {t && (
        <div className="toast" key={t.id}>
          <span className="toast__msg">{t.message}</span>
          {t.restoreId && (
            <>
              <span className="toast__sep" aria-hidden="true"> · </span>
              <button type="button" className="toast__undo" onClick={() => run('toast.undo')}>
                Undo (Z)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
