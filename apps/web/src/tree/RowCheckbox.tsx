import { rowControlClick } from './rowControlClick'

export type RowState = 'open' | 'doing' | 'worked' | 'done' | 'cancelled'

const LABEL: Record<RowState, string> = {
  open: 'Tick off',
  worked: 'Tick off',
  doing: 'Doing now, tick off',
  done: 'Done, untick',
  cancelled: 'Cancelled, reopen',
}

/** `round` is My Day's 18 px circle; the tree's is a 16 px square. */
export function RowCheckbox({ state, onToggle, round }: { state: RowState; onToggle: () => void; round?: boolean }) {
  const cls = state === 'worked' ? 'open' : state
  return (
    <button
      type="button"
      className={`cb cb--${cls}${round ? ' cb--round' : ''}`}
      aria-label={LABEL[state]}
      onClick={(e) => rowControlClick(e, onToggle)}
    >
      {state === 'done' && (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
          <path d="M3.5 8.2 6.6 11.2 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'cancelled' && (
        <svg aria-hidden="true" data-icon="cross" width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      {state === 'doing' && <span aria-hidden="true" className="cb__dot" />}
    </button>
  )
}
