import type { Section } from '@daybreak/core'
import { create } from 'zustand'

export interface Draft {
  section: Section
  parentId: string | null
  afterId?: string
  beforeId?: string
}

export interface UiState {
  pane: 'tree' | 'day'
  treeSel: string | null
  daySel: string | null
  editing: { id: string | 'draft'; initial: string } | null
  draft: Draft | null
  confirm: { id: string; status: 'done' | 'cancelled'; openCount: number; until: number } | null
  detailId: string | null
  showCompleted: boolean
  reviewOpen: boolean
  /** Bumped by the title bar's "Add to My Day"; the My Day add field (Task 18) reacts to it. */
  dayAddNonce: number
  focusDayAdd: () => void
  set: (patch: Partial<Omit<UiState, 'set' | 'focusDayAdd'>>) => void
}

/** The store's actions; `UiState` already carries them, this names them for CommandEnv. */
export type UiActions = Pick<UiState, 'set' | 'focusDayAdd'>

export const useUi = create<UiState>((set) => ({
  pane: 'tree',
  treeSel: null,
  daySel: null,
  editing: null,
  draft: null,
  confirm: null,
  detailId: null,
  showCompleted: false,
  reviewOpen: false,
  dayAddNonce: 0,
  focusDayAdd: () => set((s) => ({ dayAddNonce: s.dayAddNonce + 1 })),
  set: (patch) => set(patch),
}))
