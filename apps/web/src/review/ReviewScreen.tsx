import type { ISODate, ReviewChoice, ReviewItem, ReviewView } from '@daybreak/core'
import { daysBetween, weekdayName } from '@daybreak/core/dates'
import { useQueryClient } from '@tanstack/react-query'
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useMutate, useReview, useStatus } from '../api/hooks'
import { monthShort } from '../picker/dayGrid'
import { longDate, TitleBar } from '../shell/TitleBar'
import { toast } from '../shell/toastStore'
import { useUi } from '../ui/store'
import { ReviewCard } from './ReviewCard'
import {
  afterDecision,
  allItems,
  applyDecision,
  END,
  lastDecided,
  type ReviewCommand,
  resolveReviewKey,
  type Spot,
  spotIn,
  step,
  undoLast,
} from './reviewKeys'

type Outcome = 'today' | 'day' | 'backlog' | 'not-today' | 'cancelled' | 'done'

function outcomeOf(item: ReviewItem): Outcome {
  switch (item.decision!.choice) {
    case 'today':
      return 'today'
    case 'day':
      return 'day'
    case 'backlog':
      return item.group === 'suggestion' ? 'not-today' : 'backlog'
    case 'cancel':
      return 'cancelled'
    case 'done':
      return 'done'
  }
}

/** "Wed" within six days of today, else "Tue 17 Nov" (R39). */
function dayChip(date: ISODate, today: ISODate): string {
  const ahead = daysBetween(today, date)
  const wd = weekdayName(date, 'short')
  return ahead >= 1 && ahead <= 6 ? wd : `${wd} ${Number(date.slice(8, 10))} ${monthShort(date)}`
}

function chipText(item: ReviewItem, today: ISODate): string {
  const o = outcomeOf(item)
  if (o === 'day') return item.decision!.date ? dayChip(item.decision!.date, today) : 'Another day'
  return {
    today: 'Today',
    backlog: 'Backlog',
    'not-today': 'Not today',
    cancelled: 'Cancelled',
    done: 'Done',
  }[o]
}

/**
 * "MONDAY" when every leftover was left over from the same day, "EARLIER" otherwise. It reads
 * `leftoverFrom`, the day before this review, which core keeps through each decision (R40).
 */
function leftoverDay(view: ReviewView): string {
  const days = new Set(view.leftovers.map((i) => i.leftoverFrom))
  const [only] = days
  if (days.size !== 1 || !only) return 'EARLIER'
  // Weekday only within the last week: "FROM MONDAY" for a day three weeks back would point at the wrong Monday.
  return daysBetween(only, view.date) <= 6 ? weekdayName(only, 'long').toUpperCase() : 'EARLIER'
}

const sorted = (list: ReviewItem[]) => list.filter((i) => i.decision !== null).length
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * Opens the review when the status says today's review is due (R38), and closes one left open
 * when the day turns to a day with nothing to review: yesterday's review is no longer today's.
 * Mounted once, in App.
 */
export function useOpenReviewWhenDue(): void {
  const status = useStatus().data
  const setUi = useUi((s) => s.set)
  const seenDay = useRef<string | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: run only when the day or needsReview changes, not on every status refetch.
  useEffect(() => {
    if (!status) return
    const dayTurned = seenDay.current !== undefined && seenDay.current !== status.today
    seenDay.current = status.today
    if (status.needsReview) setUi({ reviewOpen: true })
    // Only on a real change of day: a review opened with the title bar's button stays open.
    else if (dayTurned) setUi({ reviewOpen: false })
  }, [status?.today, status?.needsReview, setUi])
}

/**
 * The morning review, full-window: leftovers, then suggestions, then "Start the day", worked top
 * to bottom with T D B X Space and Z. A cursor (the card) sits on one item: after a choice it
 * moves to the next undecided one, and ↑↓ move it freely, so a decided item can be changed.
 * Each choice is posted through the one mutation queue and shown at once, so a quick T T T goes
 * down the list in order. It owns the keys while open (the main window's handler stands aside
 * for `reviewOpen`).
 */
export function ReviewScreen() {
  const today = useStatus().data?.today ?? ''
  const review = useReview(today)
  const view = review.data
  const qc = useQueryClient()
  const mutate = useMutate()
  const setUi = useUi((s) => s.set)
  const [picking, setPicking] = useState<string | null>(null)
  // The cursor: a task id or the end row, or null for "the first undecided item". The ref is the
  // truth, so a quick T T T reads each move before React re-renders.
  const [chosen, setChosenState] = useState<Spot | null>(null)
  const chosenRef = useRef<Spot | null>(null)
  const setChosen = (s: Spot | null) => {
    chosenRef.current = s
    setChosenState(s)
  }
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef(0)

  const key = useCallback(() => ['review', today], [today])
  const latest = () => qc.getQueryData<ReviewView>(key())

  /** Shows `optimistic` now, posts, and takes the server's view once no other review post is waiting. */
  const post = (
    action: string,
    body: unknown,
    optimistic: (v: ReviewView) => ReviewView,
    failure: string,
    onFail?: () => void,
  ) => {
    const shown = latest()
    if (shown) qc.setQueryData(key(), optimistic(shown))
    pending.current++
    mutate(() => api.send<ReviewView>('POST', `/api/review/${today}/${action}`, body)).then(
      (fresh) => {
        if (--pending.current === 0 && fresh) qc.setQueryData(key(), fresh)
      },
      (e: unknown) => {
        pending.current--
        console.error(e)
        toast.show({ message: failure })
        onFail?.()
        void qc.invalidateQueries({ queryKey: key() })
      },
    )
  }

  /** The item under the cursor, or null on the end row. */
  const spotItem = (v: ReviewView | undefined) => {
    if (!v) return null
    const spot = spotIn(v, chosenRef.current)
    return allItems(v).find((i) => i.task.id === spot) ?? null
  }

  const decide = (choice: ReviewChoice, targetDate?: ISODate) => {
    const v = latest()
    const item = spotItem(v)
    if (!v || !item) return
    if (choice === 'day' && targetDate === today) choice = 'today' // the picker's "Today" is just T
    const date = choice === 'today' ? today : choice === 'day' ? targetDate : undefined
    const was = item.decision
    // The same choice again changes nothing; the server says so too.
    if (was?.choice === choice && (choice !== 'day' || was.date === date)) {
      setChosen(afterDecision(v, item.task.id))
      return
    }
    const decision = { choice, ...(date ? { date } : {}) }
    setChosen(afterDecision(applyDecision(v, item.task.id, decision), item.task.id))
    post(
      'decide',
      { taskId: item.task.id, choice, ...(choice === 'day' ? { targetDate } : {}) },
      (shown) => applyDecision(shown, item.task.id, decision),
      "Couldn't save that choice",
      () => setChosen(item.task.id), // back to the item, to try again
    )
  }

  /** Z: the cursor goes to the item whose choice is undone, ready for another. */
  const undo = () => {
    const v = latest()
    const item = v && lastDecided(v)
    if (item) setChosen(item.task.id)
    post('undo', undefined, undoLast, "Couldn't undo that choice")
  }

  const move = (by: 1 | -1) => {
    const v = latest()
    if (!v) return
    setPicking(null)
    setChosen(step(v, spotIn(v, chosenRef.current), by))
  }

  /** Finish or skip: once the server has it, back to the main window with a fresh status. */
  const leave = (action: 'finish' | 'skip', failure: string) => {
    if (today === '') return
    mutate(() => api.send<void>('POST', `/api/review/${today}/${action}`)).then(
      () => {
        setUi({ reviewOpen: false })
        void qc.invalidateQueries({ queryKey: ['status'] })
      },
      (e: unknown) => {
        console.error(e)
        toast.show({ message: failure })
      },
    )
  }
  const start = () => leave('finish', "Couldn't finish the review")
  const skip = () => leave('skip', "Couldn't skip the review")

  const run = (cmd: ReviewCommand) => {
    if (cmd === 'undo') return undo()
    if (cmd === 'start') return start()
    if (cmd === 'up') return move(-1)
    if (cmd === 'down') return move(1)
    if (cmd === 'day') {
      const item = spotItem(latest())
      if (item) setPicking(item.task.id)
      return
    }
    decide(cmd)
  }
  const runRef = useRef(run)
  runRef.current = run
  const pickingRef = useRef(picking)
  pickingRef.current = picking

  // The review's one keydown listener. A focused button keeps its own Space and Enter.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && (e.key === ' ' || e.key === 'Enter') && el.closest('button, a')) return
      const v = qc.getQueryData<ReviewView>(key())
      if (!v) return
      const cmd = resolveReviewKey(e, {
        pickerOpen: pickingRef.current !== null,
        allSorted: v.sortedCount === v.totalCount,
        onItem: spotIn(v, chosenRef.current) !== END,
      })
      if (cmd === null) return
      e.preventDefault()
      if (e.repeat && cmd !== 'up' && cmd !== 'down') return // a held key decides once; arrows repeat
      runRef.current(cmd)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [qc, key])

  // Focus rests on the screen itself, so the keys work without a click and a focused button
  // never catches Space. It returns here when the picker closes.
  useEffect(() => {
    if (picking === null) root.current?.focus()
  }, [picking])

  const spot = view ? spotIn(view, chosen) : END
  // The picker belongs to the card it was opened on.
  const pickerOpen = picking !== null && picking === spot
  useEffect(() => {
    if (picking !== null && !pickerOpen) setPicking(null)
  }, [picking, pickerOpen])

  /**
   * After a mouse click on any button (the title bar's too) focus comes back to the screen, so
   * the next Space is the review's and does not press that button again. The picker keeps its own.
   */
  const giveBackFocus = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target instanceof Element ? e.target : null
    if (e.detail > 0 && el?.closest('button') && !el.closest('.picker')) root.current?.focus()
  }

  /** A click on a row puts the cursor there. */
  const select = (id: Spot) => {
    setPicking(null)
    setChosen(id)
  }

  /** A card button: act, then hand focus back to the screen (a keyboard press re-renders the card away). */
  const choose = (cmd: ReviewCommand) => {
    if (cmd === 'day' && pickerOpen) return setPicking(null) // "Another day" again folds the picker away
    run(cmd)
    if (cmd !== 'day') root.current?.focus()
  }

  const allSorted = view !== undefined && view.sortedCount === view.totalCount

  const rows = (list: ReviewItem[]) =>
    list.map((item) => {
      if (item.task.id === spot) {
        const at = view!.leftovers.indexOf(item)
        return (
          <ReviewCard
            key={item.task.id}
            item={item}
            today={today}
            tag={
              item.group === 'leftover' ? `${at + 1} of ${view!.leftovers.length}` : 'Suggestion'
            }
            decided={
              item.decision ? { label: chipText(item, today), outcome: outcomeOf(item) } : null
            }
            picking={pickerOpen}
            onChoose={choose}
            onPick={(d) => {
              setPicking(null)
              decide('day', d)
            }}
            onClosePicker={() => setPicking(null)}
          />
        )
      }
      if (item.decision) {
        const o = outcomeOf(item)
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: ↑↓ move the cursor from the keyboard
          <li
            key={item.task.id}
            className={`rv-row rv-row--${o}`}
            onClick={() => select(item.task.id)}
          >
            <span className="rv-row__mark" aria-hidden="true">
              <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16">
                <path
                  d="M3.5 8.2 6.6 11.2 12.5 4.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="rv-row__title">{item.task.title}</span>
            <span className="rv-row__chip">{chipText(item, today)}</span>
          </li>
        )
      }
      return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: ↑↓ move the cursor from the keyboard
        <li key={item.task.id} className="rv-next" onClick={() => select(item.task.id)}>
          <span className="rv-next__circle" aria-hidden="true" />
          <span className="rv-next__title">{item.task.title}</span>
          <span className="rv-next__short">{item.path[0] ?? ''}</span>
        </li>
      )
    })

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: keys are handled by the window listener
    <div className="review" ref={root} tabIndex={-1} onClick={giveBackFocus}>
      <TitleBar review={{ onSkip: skip }} />
      <div className="review__body">
        <main className="review__col">
          <div className="review__head">
            <div className="review__heading">
              <span className="review__greeting">
                {today && `Good morning — ${longDate(today)}`}
              </span>
              <h1 className="review__title">Plan today, top to bottom</h1>
            </div>
            <span className="review__grow" />
            {view && (
              <span className="review__progress">{`${view.sortedCount} of ${view.totalCount} sorted`}</span>
            )}
          </div>
          {review.isError && (
            <p className="review__error">Couldn't load the review. Is the server running?</p>
          )}
          {view && (
            <ol className="review__list">
              {view.leftovers.length > 0 && (
                <>
                  <li className="rv-section">
                    <span className="rv-section__title">{`LEFT OVER FROM ${leftoverDay(view)}`}</span>
                    <span className="rv-section__sub">{`${sorted(view.leftovers)} of ${view.leftovers.length} sorted`}</span>
                  </li>
                  {rows(view.leftovers)}
                </>
              )}
              {view.suggestions.length > 0 && (
                <>
                  <li className="rv-section">
                    <span className="rv-section__title">ANYTHING ELSE FOR TODAY?</span>
                    <span className="rv-section__sub">Suggestions from your tree and Inbox</span>
                  </li>
                  {rows(view.suggestions)}
                </>
              )}
              <li
                className={`rv-end${allSorted ? ' is-ready' : ''}${spot === END ? ' is-current' : ''}`}
              >
                <span className="rv-end__count">{`${plural(view.todayCount, 'task')} for today`}</span>
                <span className="review__grow" />
                <button type="button" className="rv-end__btn" onClick={start}>
                  Start the day <span className="rv-end__key">Space</span>
                </button>
              </li>
            </ol>
          )}
        </main>
        <aside className="review__legend" aria-label="Keys">
          <div className="review__caps">
            {[
              ['T', 'Today'],
              ['D', 'Another day'],
              ['B', 'Backlog / not today'],
              ['Space', 'Done'],
              ['X', 'Cancel'],
              ['↑↓', 'Move'],
            ].map(([k, label]) => (
              <span key={k} className="review__cap">
                <span className={`review__capkey${k!.length > 1 ? ' review__capkey--wide' : ''}`}>
                  {k}
                </span>
                <span className="review__caplabel">{label}</span>
              </span>
            ))}
          </div>
          <p className="review__hint">
            After D: 1–9 pick today up to 8 days out, or move with the arrows and press Enter. Z
            undoes the last choice. ↑↓ go back to an item to change its choice. On the last row,
            Space starts the day.
          </p>
        </aside>
      </div>
    </div>
  )
}
