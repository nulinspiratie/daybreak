import { type FocusEvent, useEffect, useLayoutEffect, useRef } from 'react'
import { useUi } from '../ui/store'

/** Set while a pointer button is held: a blur during a press is the user clicking away. */
let pointerDown = false
const onPointerDown = () => {
  pointerDown = true
}
const onPointerUp = () => {
  pointerDown = false
}

export interface TitleEditorProps {
  /** The row's id (`draft` for the draft row). */
  id: string
  strong: boolean
  placeholder?: string
  /** The user left the row: save and return to navigate mode. */
  onLeave: (id: string) => void
}

function setText(text: string): void {
  const { editing, set } = useUi.getState()
  if (editing) set({ editing: { ...editing, text } })
}

/**
 * A row's title while it is edited. Its keys go to the one global handler (useKeyboard), which lets
 * this input through because of `data-title-editor`; the text lives in the store's `editing`.
 */
export function TitleEditor({ id, strong, placeholder, onLeave }: TitleEditorProps) {
  const text = useUi((s) => s.editing?.text ?? '')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
    }
  }, [])

  useLayoutEffect(() => {
    pointerDown = false
    const el = ref.current!
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // The browser drops focus when a re-render moves this row in the DOM (after Tab or Mod+↓ is
  // refetched, say). Take it back; a real departure has already ended editing and unmounted us.
  useLayoutEffect(() => {
    const el = ref.current
    const active = document.activeElement
    if (el && active !== el && (active === null || active === document.body)) el.focus()
  })

  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    // Leaving means a click elsewhere, focus moving to another control, or the window losing focus.
    // Any other blur is the app's own doing (moving or replacing this row) and must not save twice.
    if (pointerDown || e.relatedTarget !== null || !document.hasFocus()) onLeave(id)
  }

  return (
    <input
      ref={ref}
      className={`row__editor${strong ? ' row__editor--strong' : ''}`}
      data-title-editor=""
      type="text"
      aria-label="Task title"
      autoComplete="off"
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={onBlur}
    />
  )
}

/** The tag an edited row carries on its right, so edit mode is never mistaken for a selection. */
export function EditingTag() {
  return (
    <span className="row__editing" aria-hidden="true">
      Editing <kbd>Esc</kbd>
    </span>
  )
}
