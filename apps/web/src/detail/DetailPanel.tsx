import type { ISODate, Mark, Task, TreeNode } from '@daybreak/core'
import { addDays, dayLabel, weekdayName } from '@daybreak/core/dates'
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useDay, useStatus, useTree } from '../api/hooks'
import { type CommandEnv, type DetailStatus, pickDay, setDetailStatus } from '../keyboard/commands'
import { reportWriteError, useCommandEnv } from '../keyboard/useKeyboard'
import { PATH_SEPARATOR } from '../myday/DayRow'
import { CheckMark, RowCheckbox, type RowState } from '../tree/RowCheckbox'
import { DRAFT_ID } from '../tree/flatten'
import { useUi } from '../ui/store'
import { Markdown } from './Markdown'

interface Found {
  task: Task
  mark: Mark | null
  children: TreeNode[]
  /** Section name or ancestors, as My Day shows a path. */
  path: string[]
}

function findIn(nodes: TreeNode[], id: string, ancestors: string[]): { node: TreeNode; ancestors: string[] } | undefined {
  for (const n of nodes) {
    if (n.id === id) return { node: n, ancestors }
    const hit = findIn(n.children, id, [...ancestors, n.title])
    if (hit) return hit
  }
  return undefined
}

const stateOf = (task: Task, mark: Mark | null): RowState => (task.status !== 'open' ? task.status : (mark ?? 'open'))

/** Writes a field. Only a changed value is sent, and a value saved a moment ago is not sent twice (Enter, then the blur it causes). */
function useSaved(current: string) {
  const saved = useRef(current)
  useEffect(() => {
    saved.current = current
  }, [current])
  return saved
}

function useWrite(): (fn: (env: CommandEnv) => Promise<unknown>) => void {
  const getEnv = useCommandEnv()
  return (fn) => {
    const env = getEnv()
    if (env) fn(env).catch(reportWriteError)
  }
}

const apiPath = (id: string, action = '') => `/api/tasks/${id}${action}`

function TitleField({ task }: { task: Task }) {
  const [text, setText] = useState(task.title)
  const ref = useRef<HTMLInputElement>(null)
  const saved = useSaved(task.title)
  const skipBlur = useRef(false)
  const write = useWrite()

  // A change from elsewhere shows, unless it is being typed over.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(task.title)
  }, [task.title])

  const commit = (value: string) => {
    const title = value.trim()
    // An emptied title reverts: the server rejects an empty one.
    if (title === '' || title === saved.current) return setText(saved.current)
    saved.current = title
    setText(title)
    write((env) => {
      env.cache.update(task.id, { title })
      return env.mutate(() => env.api.send('PATCH', apiPath(task.id), { title }))
    })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(e.currentTarget.value)
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setText(saved.current)
      skipBlur.current = true
      e.currentTarget.blur() // the next Esc reaches the global handler and closes the panel
      skipBlur.current = false
    }
  }
  return (
    <input
      ref={ref}
      className="detail__title"
      aria-label="Title"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={(e) => !skipBlur.current && commit(e.currentTarget.value)}
    />
  )
}

function LinkField({ task }: { task: Task }) {
  const [text, setText] = useState(task.link ?? '')
  const ref = useRef<HTMLInputElement>(null)
  const saved = useSaved(task.link ?? '')
  const skipBlur = useRef(false)
  const write = useWrite()

  useEffect(() => {
    if (document.activeElement !== ref.current) setText(task.link ?? '')
  }, [task.link])

  const commit = (value: string) => {
    const link = value.trim()
    setText(link)
    if (link === saved.current) return
    saved.current = link
    write((env) => {
      env.cache.update(task.id, { link: link === '' ? null : link })
      return env.mutate(() => env.api.send('PATCH', apiPath(task.id), { link: link === '' ? null : link }))
    })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(e.currentTarget.value)
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setText(saved.current)
      skipBlur.current = true
      e.currentTarget.blur()
      skipBlur.current = false
    }
  }
  return (
    <>
      <div className="detail__link">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
          <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <input
          ref={ref}
          className="detail__linkinput"
          aria-label="Link"
          placeholder="Paste a file, folder or URL"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(e) => !skipBlur.current && commit(e.currentTarget.value)}
        />
      </div>
      <button
        type="button"
        className="detail__btn"
        aria-label="Open link"
        disabled={text.trim() === ''}
        onClick={() => write((env) => env.mutate(() => env.api.send('POST', apiPath(task.id, '/open-link'))))}
      >
        Open
      </button>
    </>
  )
}

/** "Tue 10 Nov". */
function fullDay(date: ISODate): string {
  const d = new Date(`${date}T00:00:00Z`)
  return `${weekdayName(date, 'short')} ${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`
}

const PLACEHOLDER = 'Add notes — **bold**, - lists and `code` work.'

function Notes({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(task.notes)
  const saved = useSaved(task.notes)
  const write = useWrite()

  const leave = (value: string) => {
    setEditing(false)
    if (value === saved.current) return
    saved.current = value
    write((env) => {
      env.cache.update(task.id, { notes: value })
      return env.mutate(() => env.api.send('PATCH', apiPath(task.id), { notes: value }))
    })
  }
  const edit = () => {
    setText(saved.current)
    setEditing(true)
  }
  // Ctrl+O on the open panel asks for the notes editor.
  const nonce = useUi((s) => s.notesNonce)
  const seen = useRef(nonce)
  useEffect(() => {
    if (nonce === seen.current) return
    seen.current = nonce
    edit()
  })
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Already in the notes: keep the browser's own Ctrl+O (Open file) from firing.
    if (e.ctrlKey && e.key.toLowerCase() === 'o') e.preventDefault()
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      leave(e.currentTarget.value)
      // Focus goes back to the page, so the tree's keys work again; the panel stays open.
      e.currentTarget.blur()
    }
  }
  const openLink = (target: string) => write((env) => env.mutate(() => env.api.send('POST', '/api/open-link', { target })))

  return (
    <div className="detail__notes">
      <div className="detail__label">
        <span>Notes</span>
        <span className="detail__sub">· Markdown</span>
        {!editing && (
          <button type="button" className="detail__edit" onClick={edit}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          className="detail__textarea"
          aria-label="Notes"
          placeholder={PLACEHOLDER}
          // biome-ignore lint/a11y/noAutofocus: the click that opened it asked for it
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(e) => leave(e.currentTarget.value)}
        />
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the Edit button is the keyboard way in
        <div className="detail__rendered" onClick={edit}>
          {task.notes.trim() === '' ? <span className="detail__placeholder">{PLACEHOLDER}</span> : <Markdown source={task.notes} onOpenLink={openLink} />}
        </div>
      )}
    </div>
  )
}

const STATUSES: { k: DetailStatus; label: string; key: string }[] = [
  { k: 'open', label: 'Open', key: '' },
  { k: 'doing', label: 'Doing', key: 'S' },
  { k: 'worked', label: 'Worked on', key: 'W' },
  { k: 'done', label: 'Done', key: 'Space' },
  { k: 'cancelled', label: 'Cancelled', key: 'X' },
]

function Chip({ date, today }: { date: ISODate; today: ISODate }) {
  const { text, kind, fade } = dayLabel(date, today)
  return (
    <span className={`day day--${kind} detail__chip`} style={{ '--fade': String(fade) } as CSSProperties}>
      {text}
    </span>
  )
}

function Body({ found, today }: { found: Found; today: ISODate }) {
  const { task, mark, children } = found
  const setUi = useUi((s) => s.set)
  const getEnv = useCommandEnv()
  const write = useWrite()
  const state = stateOf(task, mark)
  const closed = task.status !== 'open'
  const tomorrow = addDays(today, 1)

  // The segment that shows the state does nothing: reopening goes through Open.
  // The checkboxes toggle, like Space.
  const toggle = (t: Task, m: Mark | null) => write((env) => setDetailStatus(env, t, 'done', m))
  const setStatus = (t: Task, m: Mark | null, want: DetailStatus) => {
    if (stateOf(t, m) === want) return
    write((env) => setDetailStatus(env, t, want, m))
  }
  const schedule = (date: ISODate | null) => write((env) => pickDay(env, task, date))
  const select = (id: string) => {
    const visible = getEnv()?.rows.some((r) => r.id === id)
    setUi({ detailId: id, ...(visible && { treeSel: id, pane: 'tree' as const }) })
  }

  const on = { today: task.scheduledOn === today, tomorrow: task.scheduledOn === tomorrow, none: task.scheduledOn === null }
  const other = !on.today && !on.tomorrow && !on.none
  const done = children.filter((c) => c.status === 'done').length
  const where = found.path.length > 0 ? found.path.join(PATH_SEPARATOR) : 'Projects'

  return (
    <div className="detail__body">
      <div className="detail__titlerow">
        <button
          type="button"
          className={`cb cb--${state === 'worked' ? 'open' : state} cb--lg`}
          aria-label={state === 'done' ? 'Done, untick' : state === 'cancelled' ? 'Cancelled, reopen' : 'Tick off'}
          onClick={() => toggle(task, mark)}
        >
          <CheckMark state={state} />
        </button>
        <TitleField task={task} />
      </div>

      <div className="detail__grid">
        <span className="detail__label">Scheduled</span>
        <div className="detail__row">
          <button type="button" className="detail__seg" aria-pressed={on.today} onClick={() => schedule(today)}>Today</button>
          <button type="button" className="detail__seg" aria-pressed={on.tomorrow} onClick={() => schedule(tomorrow)}>Tomorrow</button>
          <button type="button" className="detail__seg" aria-pressed={other} onClick={() => setUi({ picker: { taskId: task.id, allowNoDay: true } })}>
            {other ? fullDay(task.scheduledOn!) : 'Pick a day…'}
          </button>
          <button type="button" className="detail__seg" aria-pressed={on.none} onClick={() => schedule(null)}>No day</button>
          <span className="kbd">D</span>
        </div>

        <span className="detail__label">Status</span>
        <div className="detail__statuses">
          {STATUSES.map((s) => (
            <button
              type="button"
              key={s.k}
              className={`detail__st detail__st--${s.k}`}
              aria-pressed={state === s.k}
              disabled={closed && (s.k === 'doing' || s.k === 'worked')}
              onClick={() => setStatus(task, mark, s.k)}
            >
              {s.label}
              {s.key && <span className="detail__stkey"> {s.key}</span>}
            </button>
          ))}
        </div>

        <span className="detail__label">Link</span>
        <div className="detail__row detail__row--link">
          <LinkField task={task} />
        </div>

        <span className="detail__label">In tree</span>
        <span className="detail__path">{where}</span>
      </div>

      <Notes task={task} />

      {children.length > 0 && (
        <div className="detail__kids">
          <span className="detail__label">Subtasks · {done} of {children.length} done</span>
          {children.map((c) => (
            <div className="detail__kid" key={c.id}>
              <RowCheckbox state={stateOf(c, c.mark)} onToggle={() => toggle(c, c.mark)} />
              <button type="button" className={`detail__kidtitle${c.status !== 'open' ? ' detail__kidtitle--closed' : ''}`} onClick={() => select(c.id)}>
                {c.title}
              </button>
              {c.scheduledOn && c.status === 'open' && <Chip date={c.scheduledOn} today={today} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const HINTS = [['Space', 'Done'], ['S', 'Doing'], ['W', 'Worked on'], ['X', 'Cancel'], ['Ctrl+O', 'Notes'], ['Esc', 'Close']] as const

/** The task detail panel, standing where My Day is while `detailId` is set. */
export function DetailPanel() {
  const detailId = useUi((s) => s.detailId)
  const treeSel = useUi((s) => s.treeSel)
  const showCompleted = useUi((s) => s.showCompleted)
  const setUi = useUi((s) => s.set)
  const tree = useTree(showCompleted ? 'all' : 'recent')
  const today = useStatus().data?.today ?? ''
  const day = useDay(today)

  // It follows the tree selection (↑↓, clicks). A task hidden under a collapsed parent keeps the
  // panel until the selection next changes.
  const previous = useRef(treeSel)
  useEffect(() => {
    if (previous.current === treeSel) return
    previous.current = treeSel
    if (useUi.getState().detailId !== null && treeSel !== null && treeSel !== DRAFT_ID) setUi({ detailId: treeSel })
  }, [treeSel, setUi])

  let found: Found | null = null
  if (detailId !== null) {
    const nodes = tree.data ? [...tree.data.inbox, ...tree.data.projects] : []
    const hit = findIn(nodes, detailId, [])
    if (hit) {
      found = { task: hit.node, mark: hit.node.mark, children: hit.node.children, path: hit.node.section === 'inbox' ? ['Inbox'] : hit.ancestors }
    } else {
      // Listed in My Day but not in the tree (a task closed days ago).
      const item = day.data?.items.find((i) => i.task.id === detailId)
      if (item) found = { task: item.task, mark: item.mark, children: [], path: item.path }
    }
  }

  // The task is gone (deleted, or hidden): nothing to show.
  const settled = tree.isSuccess && (day.isSuccess || day.isError || today === '')
  useEffect(() => {
    if (detailId !== null && !found && settled) setUi({ detailId: null })
  }, [detailId, found, settled, setUi])

  if (detailId === null || !found || today === '') return null
  return (
    <section className="pane pane--detail" aria-label="Task detail">
      <div className="detail__head">
        <span className="detail__headpath">{found.path.length > 0 ? found.path.join(PATH_SEPARATOR) : 'Projects'}</span>
        <button type="button" className="btn" onClick={() => setUi({ detailId: null })}>
          Back to My Day <span className="kbd">Esc</span>
        </button>
      </div>
      <Body key={found.task.id} found={found} today={today} />
      <div className="keyhints" aria-label="Keyboard hints">
        {HINTS.map(([key, label]) => (
          <span className="keyhints__item" key={key}>
            <kbd className="keyhints__key">{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </section>
  )
}
