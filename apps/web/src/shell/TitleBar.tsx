import { weekdayName } from '@daybreak/core/dates'
import { useStatus } from '../api/hooks'
import { useTheme } from '../theme/useTheme'
import { useUi } from '../ui/store'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function longDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${weekdayName(iso, 'long')} ${d} ${MONTHS[(m ?? 1) - 1]}`
}

export interface TitleBarProps {
  /** The morning review's title bar: "Morning review" and a "Skip for today" link in place of the day's buttons. */
  review?: { onSkip: () => void }
}

export function TitleBar({ review }: TitleBarProps = {}) {
  const { data: status } = useStatus()
  const focusDayAdd = useUi((s) => s.focusDayAdd)
  const setUi = useUi((s) => s.set)
  const reconnecting = useUi((s) => s.reconnecting)
  const { theme, toggle } = useTheme()
  // The live feed is down: most likely the server is not running, so writes would fail too.
  const feedNote = reconnecting && <span className="titlebar__status">Reconnecting…</span>

  return (
    <header className="titlebar">
      <img className="titlebar__icon" src="/daybreak-small.svg" alt="" width="18" height="18" />
      <span className="titlebar__name">Daybreak</span>
      {review ? (
        <>
          <span className="titlebar__date">Morning review</span>
          {feedNote}
          <span className="titlebar__spacer" />
          <button type="button" className="tb-link" onClick={review.onSkip}>
            Skip for today
          </button>
        </>
      ) : (
        <>
          <span className="titlebar__date" data-testid="today">
            {status ? longDate(status.today) : ''}
          </span>
          {feedNote}
          <span className="titlebar__spacer" />
          <button type="button" className="tb-btn" onClick={focusDayAdd}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
              <path
                d="M8 2.5v11M2.5 8h11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Add to My Day
            <span className="kbd">Ctrl+Alt+Space</span>
          </button>
          <button type="button" className="tb-btn" onClick={() => setUi({ reviewOpen: true })}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
              <circle cx="8" cy="9" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 2.5v1.5M3 9H1.5M14.5 9H13M4.2 5.2l-1-1M11.8 5.2l1-1M1.5 13h13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            Morning review
          </button>
        </>
      )}
      <button
        type="button"
        className="tb-btn tb-btn--icon"
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={toggle}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
          <path
            d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </header>
  )
}
