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

export const useTree = (completed: CompletedMode) =>
  useQuery({ queryKey: ['tree', completed], queryFn: () => api.get<TreeView>(`/api/tree?completed=${completed}`) })

export const useDay = (date: string) =>
  useQuery({ queryKey: ['day', date], queryFn: () => api.get<DayView>(`/api/day/${date}`) })

export const useReview = (date: string) =>
  useQuery({ queryKey: ['review', date], queryFn: () => api.get<ReviewView>(`/api/review/${date}`) })

export const useDayCounts = (from: string, to: string) =>
  useQuery({
    queryKey: ['days', from, to],
    queryFn: () => api.get<Record<string, number>>(`/api/days?from=${from}&to=${to}`),
  })

// One queue for the whole app: every write goes through it, strictly in order.
const queue = createMutationQueue()
let drainWatched = false

/** Enqueue a write; once the queue drains, refetch everything (not after each item). */
export function useMutate(): <T>(fn: () => Promise<T>) => Promise<T> {
  const qc = useQueryClient()
  return useCallback(
    <T>(fn: () => Promise<T>) => {
      const result = queue.enqueue(fn)
      if (!drainWatched) {
        drainWatched = true
        void queue.idle().then(() => {
          drainWatched = false
          return qc.invalidateQueries()
        })
      }
      return result
    },
    [qc],
  )
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
        timer.current = setTimeout(() => void qc.invalidateQueries(), CHANGED_DEBOUNCE_MS)
      },
      () => void qc.invalidateQueries({ queryKey: ['status'] }),
    )
    return () => {
      clearTimeout(timer.current)
      close()
    }
  }, [qc])
}
