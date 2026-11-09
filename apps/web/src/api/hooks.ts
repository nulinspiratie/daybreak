import type { DayView, ReviewView, TreeView } from '@daybreak/core'
import { hashKey, type QueryClient, type QueryKey, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { api, isUnreachable } from './client'
import { createMutationQueue } from './queue'
import { connectEvents } from './sse'

export type CompletedMode = 'recent' | 'all' | 'none'
export interface Status {
  today: string
  needsReview: boolean
  dayStartsAt: string
}

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => api.get<Status>('/api/status') })

// What the server last answered for each query that is patched optimistically (tree, day, review),
// by query hash. A write that never reached the server is undone by putting these back.
const confirmed = new Map<string, unknown>()

function confirm<T>(key: QueryKey, fetched: T): T {
  confirmed.set(hashKey(key), fetched)
  return fetched
}

/** Puts the server's last answer back into every query that has one, dropping optimistic patches. */
export function restoreConfirmed(qc: QueryClient): void {
  for (const q of qc.getQueryCache().getAll()) {
    if (confirmed.has(q.queryHash)) qc.setQueryData(q.queryKey, confirmed.get(q.queryHash))
  }
}

/**
 * The tree. A fetch that answers while writes are still queued keeps the cached tree instead: it
 * predates those writes and would drop their optimistic rows. The refetch on drain reconciles.
 */
export function useTree(completed: CompletedMode) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['tree', completed],
    queryFn: async () => {
      const fetched = confirm(['tree', completed], await api.get<TreeView>(`/api/tree?completed=${completed}`))
      const shown = qc.getQueryData<TreeView>(['tree', completed])
      return queue.busy() && shown ? shown : fetched
    },
  })
}

/** The day, held back like the tree: a fetch answering while writes are queued would undo their optimistic changes. */
export function useDay(date: string) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['day', date],
    queryFn: async () => {
      const fetched = confirm(['day', date], await api.get<DayView>(`/api/day/${date}`))
      const shown = qc.getQueryData<DayView>(['day', date])
      return queue.busy() && shown ? shown : fetched
    },
    enabled: date !== '',
  })
}

/** The morning review, held back like the tree: its rapid decisions are shown optimistically while queued. */
export function useReview(date: string) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['review', date],
    queryFn: async () => {
      const fetched = confirm(['review', date], await api.get<ReviewView>(`/api/review/${date}`))
      const shown = qc.getQueryData<ReviewView>(['review', date])
      return queue.busy() && shown ? shown : fetched
    },
    enabled: date !== '',
  })
}

export const useDayCounts = (from: string, to: string) =>
  useQuery({
    queryKey: ['days', from, to],
    queryFn: () => api.get<Record<string, number>>(`/api/days?from=${from}&to=${to}`),
  })

// One queue for the whole app: every write goes through it, strictly in order.
export const queue = createMutationQueue()

/** Enqueue a write; all queries are refetched once the queue drains (see useDrainInvalidation). */
export function useMutate(): <T>(fn: () => Promise<T>) => Promise<T> {
  return useCallback(<T>(fn: () => Promise<T>) => queue.enqueue(fn), [])
}

/**
 * Invalidates every query each time the mutation queue drains, so a failed write's optimistic
 * change is replaced by the server's state. If a write could not reach the server, that refetch
 * fails too and react-query would keep the optimistic data, so the server's last answers are put
 * back first: an unsaved edit never looks saved. Mounted once, in App.
 */
export function useDrainInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => {
    let unreachable = false
    const offFailure = queue.onFailure((e) => {
      if (isUnreachable(e)) unreachable = true
    })
    const offDrain = queue.onDrain(() => {
      if (unreachable) restoreConfirmed(qc)
      unreachable = false
      void qc.invalidateQueries()
    })
    return () => {
      offFailure()
      offDrain()
    }
  }, [qc])
}

const CHANGED_DEBOUNCE_MS = 100

/**
 * Subscribes to the SSE feed: debounced refetch on `changed`. On `day_changed` it only raises a
 * flag; the next window focus or keydown refetches everything, the status (and so the morning
 * review) included. A tab left open overnight shows the review when you come back to it. Keys
 * pressed until that refetch lands do nothing.
 */
export function useLiveUpdates(): void {
  const qc = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dayChanged = useRef(false)
  useEffect(() => {
    const close = connectEvents(
      () => {
        clearTimeout(timer.current)
        // While writes are queued the refetch on drain covers this change too.
        timer.current = setTimeout(() => {
          if (!queue.busy()) void qc.invalidateQueries()
        }, CHANGED_DEBOUNCE_MS)
      },
      () => {
        dayChanged.current = true
      },
    )
    // The key that wakes the app (and any key until the refetch lands) is swallowed (R41): run
    // now, it would act on yesterday, e.g. T would schedule the selected task on the old day.
    let refetching = false
    const wake = (e: Event) => {
      if (dayChanged.current) {
        dayChanged.current = false
        refetching = true
        void qc.invalidateQueries().finally(() => {
          refetching = false
        })
      }
      if (refetching && e.type === 'keydown') {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('focus', wake)
    window.addEventListener('keydown', wake, true)
    return () => {
      clearTimeout(timer.current)
      close()
      window.removeEventListener('focus', wake)
      window.removeEventListener('keydown', wake, true)
    }
  }, [qc])
}
