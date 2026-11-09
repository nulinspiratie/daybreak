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
  /** The day picker (D), floated over the panes by PickerHost. `allowNoDay` is true from the tree only. */
  picker: { taskId: string; allowNoDay: boolean } | null
  /** True once the picker's card is on screen. Until then the global keys still work, except Esc closes it. */
  pickerShown: boolean
  /** Bumped by the title bar's "Add to My Day"; the My Day add field (Task 18) reacts to it. */
  dayAddNonce: number
  focusDayAdd: () => void
  /** Points every reference to `from` (selection, editing, draft, detail) at `to`: a new task got its real id. */
  replaceId: (from: string, to: string) => void
  /**
   * Forgets a task the server refused to create: editing it ends, the selection moves to where it
   * would have gone, and a draft placed after or under it takes that place instead.
   */
  dropId: (id: string, fallback: { parentId: string | null; afterId?: string; beforeId?: string }) => void
  set: (patch: Partial<Omit<UiState, Action>>) => void
}

type Action = 'set' | 'focusDayAdd' | 'replaceId' | 'dropId'

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

function withoutId(s: UiState, id: string, fb: Parameters<UiState['dropId']>[1]): Partial<UiState> {
  const anchor = fb.afterId ?? fb.parentId ?? null
  let draft = s.draft
  // The same fallback the queued create of this draft will use (placementFor).
  if (draft?.parentId === id) draft = { ...draft, parentId: fb.parentId }
  if (draft?.afterId === id) {
    const { afterId: _after, beforeId: _before, ...rest } = draft
    draft = { ...rest, ...(fb.afterId !== undefined && { afterId: fb.afterId }), ...(fb.beforeId !== undefined && { beforeId: fb.beforeId }) }
  }
  if (draft?.beforeId === id) {
    const { beforeId: _before, ...rest } = draft
    draft = rest
  }
  return {
    treeSel: s.treeSel === id ? anchor : s.treeSel,
    daySel: s.daySel === id ? null : s.daySel,
    detailId: s.detailId === id ? null : s.detailId,
    editing: s.editing?.id === id ? null : s.editing,
    draft,
    confirm: s.confirm?.id === id ? null : s.confirm,
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
  picker: null,
  pickerShown: false,
  dayAddNonce: 0,
  focusDayAdd: () => set((s) => ({ dayAddNonce: s.dayAddNonce + 1 })),
  replaceId: (from, to) => set((s) => withId(s, from, to)),
  dropId: (id, fallback) => set((s) => withoutId(s, id, fallback)),
  set: (patch) => set(patch),
}))
