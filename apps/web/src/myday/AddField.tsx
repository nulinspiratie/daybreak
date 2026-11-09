import type { Task } from '@daybreak/core'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useMutate } from '../api/hooks'
import { toast } from '../shell/toastStore'
import { useUi } from '../ui/store'
import { recorded } from '../undo/history'

/**
 * The inline add at the bottom of My Day. N (or the title bar's "Add to My Day") focuses it;
 * Enter creates an Inbox task scheduled today and keeps the focus; Esc goes back to navigate mode.
 */
export function AddField({ today }: { today: string }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const nonce = useUi((s) => s.dayAddNonce)
  const seen = useRef(nonce)
  const setUi = useUi((s) => s.set)
  const mutate = useMutate()

  useEffect(() => {
    if (nonce === seen.current) return
    seen.current = nonce
    ref.current?.focus()
  }, [nonce])

  const add = () => {
    const title = text.trim()
    if (title === '' || today === '') return
    setText('')
    // Undo deletes the new task, redo brings it back.
    let id: string | undefined
    const path = (action = '') => `/api/tasks/${id}${action}`
    recorded(
      mutate,
      {
        label: `Added '${title}' to My Day`,
        revert: () => api.send('DELETE', path()),
        reapply: () => api.send('POST', path('/restore')),
      },
      async () => {
        const task = await api.send<Task>('POST', '/api/tasks', {
          title,
          section: 'inbox',
          scheduledOn: today,
        })
        id = task.id
        return task
      },
    ).catch((e: unknown) => {
      console.error(e)
      toast.show({ message: `Couldn't save '${title}'` })
      // Put the title back for a retry, unless something else has been typed meanwhile.
      setText((now) => (now === '' ? title : now))
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  return (
    <label className="dayadd">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
        <path
          d="M8 2.5v11M2.5 8h11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <input
        ref={ref}
        type="text"
        className="dayadd__input"
        aria-label="Add to My Day"
        placeholder="Add to My Day — goes to Inbox, scheduled today"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setUi({ pane: 'day' })}
      />
      <span className="dayadd__key" aria-hidden="true">
        N
      </span>
    </label>
  )
}
