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
  /** The row whose title is being edited: `initial` is the title last saved, `text` what the input holds. */
  editing: { id: string | 'draft'; initial: string; text: string } | null
  draft: Draft | null
  confirm: { id: string; status: 'done' | 'cancelled'; openCount: number; until: number } | null
  detailId: string | null
  showCompleted: boolean
  reviewOpen: boolean
  /** Bumped by the title bar's "Add to My Day"; the My Day add field (Task 18) reacts to it. */
  dayAddNonce: number
  focusDayAdd: () => void
  /** Points every reference to `from` (selection, editing, draft, detail) at `to`: a new task got its real id. */
  replaceId: (from: string, to: string) => void
  set: (patch: Partial<Omit<UiState, Action>>) => void
}

type Action = 'set' | 'focusDayAdd' | 'replaceId'

/** The store's actions; `UiState` already carries them, this names them for CommandEnv. */
export type UiActions = Pick<UiState, Action>

function withId(s: UiState, from: string, to: string): Partial<UiState> {
  const swap = <T extends string | null | undefined>(id: T): T | string => (id === from ? to : id)
  return {
    treeSel: swap(s.treeSel),
    daySel: swap(s.daySel),
    detailId: swap(s.detailId),
    editing: s.editing && { ...s.editing, id: swap(s.editing.id) },
    draft: s.draft && {
      ...s.draft,
      parentId: swap(s.draft.parentId),
      ...(s.draft.afterId !== undefined && { afterId: swap(s.draft.afterId) }),
      ...(s.draft.beforeId !== undefined && { beforeId: swap(s.draft.beforeId) }),
    },
    confirm: s.confirm && { ...s.confirm, id: swap(s.confirm.id) },
  }
}

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
  replaceId: (from, to) => set((s) => withId(s, from, to)),
  set: (patch) => set(patch),
}))
