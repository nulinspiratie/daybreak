import { create } from 'zustand'

export interface ToastInput {
  message: string
  /** Set on a delete toast: Z or the Undo button restores this task's subtree. */
  restoreId?: string
}
export interface Toast extends ToastInput {
  id: number
}
export interface ToastApi {
  show(t: ToastInput): void
  dismiss(): void
  current(): Toast | null
}

export const TOAST_MS = 8000

export const useToastStore = create<{ toast: Toast | null }>(() => ({ toast: null }))

/** The full line as shown, e.g. "Deleted 'Port fit routines' and 6 subtasks · Undo (Z)". */
export const toastText = (t: ToastInput): string => (t.restoreId ? `${t.message} · Undo (Z)` : t.message)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** One toast at a time: a newer one replaces the older one and restarts the 8 s. */
export const toast: ToastApi = {
  show(t) {
    clearTimeout(timer)
    const next: Toast = { ...t, id: ++seq }
    useToastStore.setState({ toast: next })
    timer = setTimeout(() => {
      if (useToastStore.getState().toast?.id === next.id) useToastStore.setState({ toast: null })
    }, TOAST_MS)
  },
  dismiss() {
    clearTimeout(timer)
    useToastStore.setState({ toast: null })
  },
  current: () => useToastStore.getState().toast,
}
