import type { DayView, ReviewView, TreeView } from '@daybreak/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { api } from './client'
import { createMutationQueue } from './queue'
import { connectEvents } from './sse'

export type CompletedMode = 'recent' | 'all' | 'none'
export interface Status {
  today: string
  needsReview: boolean
  dayStartsAt: string
}

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => api.get<Status>('/api/status') })

/**
 * The tree. A fetch that answers while writes are still queued keeps the cached tree instead: it
 * predates those writes and would drop their optimistic rows. The refetch on drain reconciles.
 */
export function useTree(completed: CompletedMode) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['tree', completed],
    queryFn: async () => {
      const fetched = await api.get<TreeView>(`/api/tree?completed=${completed}`)
      const shown = qc.getQueryData<TreeView>(['tree', completed])
      return queue.busy() && shown ? shown : fetched
    },
  })
}

export const useDay = (date: string) =>
  useQuery({ queryKey: ['day', date], queryFn: () => api.get<DayView>(`/api/day/${date}`), enabled: date !== '' })

export const useReview = (date: string) =>
  useQuery({ queryKey: ['review', date], queryFn: () => api.get<ReviewView>(`/api/review/${date}`) })

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

/** Invalidates every query each time the mutation queue drains. Mounted once, in App. */
export function useDrainInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => queue.onDrain(() => void qc.invalidateQueries()), [qc])
}

const CHANGED_DEBOUNCE_MS = 100

/** Subscribes to the SSE feed: debounced refetch on `changed`, status refetch on `day_changed`. */
export function useLiveUpdates(): void {
  const qc = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const close = connectEvents(
      () => {
        clearTimeout(timer.current)
        // While writes are queued the refetch on drain covers this change too.
        timer.current = setTimeout(() => {
          if (!queue.busy()) void qc.invalidateQueries()
        }, CHANGED_DEBOUNCE_MS)
      },
      () => void qc.invalidateQueries(),
    )
    return () => {
      clearTimeout(timer.current)
      close()
    }
  }, [qc])
}
