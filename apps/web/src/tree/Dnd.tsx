import type { TreeNode } from '@daybreak/core'
import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  type Modifier,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { type SortingStrategy, useSortable } from '@dnd-kit/sortable'
import {
  type CSSProperties,
  createContext,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { type CommandEnv, moveTo, scheduleAt } from '../keyboard/commands'
import { reportWriteError, useCommandEnv } from '../keyboard/useKeyboard'
import { PATH_SEPARATOR } from '../myday/DayRow'
import { useUi } from '../ui/store'
import { type DropProjection, isUnchanged, projectDayDrop, projectDrop } from './projectDrop'
import { CheckMark } from './RowCheckbox'
import { GUIDE_DOTS, stateOf } from './TreeRow'

// dnd-kit ids carry the pane, since a task can be listed in both.
type Pane = 'tree' | 'day'
export const dndId = (pane: Pane, id: string) => `${pane}:${id}`
const PANE_ID: Record<Pane, string> = { tree: 'pane:tree', day: 'pane:day' }

function parse(id: string | number | undefined): { pane: Pane | 'pane'; id: string } | null {
  const m = typeof id === 'string' ? /^(tree|day|pane):(.*)$/.exec(id) : null
  return m ? { pane: m[1] as Pane | 'pane', id: m[2]! } : null
}

type DayAt = { afterId?: string; beforeId?: string }

export interface DragState {
  active: { pane: Pane; id: string } | null
  /** The pane under the pointer. */
  over: Pane | null
  /** Over the tree, for a tree task: where it would land (null: it can't). */
  tree: DropProjection | null
  /** Over My Day: where it would land (null: nowhere new). */
  day: DayAt | null
}

const IDLE: DragState = { active: null, over: null, tree: null, day: null }
const DragContext = createContext<DragState>(IDLE)
export const useDrag = () => useContext(DragContext)

/** The pane under the pointer decides the targets; within it, the row closest to the dragged card. */
const collide: CollisionDetection = (args) => {
  const p = args.pointerCoordinates
  const inside = (pane: Pane) => {
    const r = args.droppableRects.get(PANE_ID[pane])
    return !!p && !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
  }
  const pane: Pane | null = inside('day') ? 'day' : inside('tree') ? 'tree' : null
  if (!pane) return []
  const rows = args.droppableContainers.filter((c) => parse(c.id)?.pane === pane)
  const hit = closestCenter({ ...args, droppableContainers: rows })
  return hit.length > 0 ? hit : [{ id: PANE_ID[pane] }]
}

function project(env: CommandEnv, e: DragMoveEvent): DragState {
  const active = parse(e.active.id) as DragState['active']
  const over = parse(e.over?.id)
  if (!active || !over) return { ...IDLE, active }
  const overPane: Pane = over.pane === 'pane' ? (over.id as Pane) : over.pane
  if (overPane === 'tree') {
    // A My Day item dropped on the tree does nothing.
    const tree =
      active.pane === 'tree' && over.pane === 'tree'
        ? projectDrop(env.rows, active.id, over.id, e.delta.x)
        : null
    return { active, over: 'tree', tree, day: null }
  }
  const ids = env.dayItems.map((i) => i.task.id)
  const overId = over.pane === 'day' ? over.id : null
  let side: 'before' | 'after' = 'after'
  if (overId !== null && active.pane === 'day') {
    // Within My Day it takes the slot of the row it is over, as the sortable list shows it.
    side = ids.indexOf(overId) > ids.indexOf(active.id) ? 'after' : 'before'
  } else if (overId !== null && e.over) {
    // From the tree: above or below the middle of the row it is over.
    const card = e.active.rect.current.translated
    const middle = e.over.rect.top + e.over.rect.height / 2
    side = card && card.top + card.height / 2 < middle ? 'before' : 'after'
  }
  return { active, over: 'day', tree: null, day: projectDayDrop(ids, active.id, overId, side) }
}

/** Sends the drop and shows it at once in the cached tree and day. */
function drop(env: CommandEnv, s: DragState): void {
  const { active } = s
  if (!active) return
  const ui = env.ui
  if (s.over === 'tree' && s.tree) {
    const p = s.tree
    ui.set({ treeSel: active.id, pane: 'tree' })
    if (isUnchanged(env.rows, active.id, p)) return
    const to = {
      parentId: p.parentId,
      section: p.section,
      ...(p.afterId !== undefined && { afterId: p.afterId }),
      ...(p.beforeId !== undefined && { beforeId: p.beforeId }),
    }
    // Under a collapsed parent the task would vanish; open it, as Tab does.
    const parent = p.parentId === null ? undefined : env.rows.find((r) => r.id === p.parentId)
    const expand = parent?.node.collapsed === true
    env.cache.move(active.id, to)
    if (expand) env.cache.update(parent!.id, { collapsed: false })
    moveTo(env, active.id, to, expand).catch(reportWriteError)
    return
  }
  if (s.over === 'day') {
    ui.set({ daySel: active.id, pane: 'day' })
    if (!s.day) return
    env.cache.moveInDay(active.id, s.day)
    env.cache.update(active.id, { scheduledOn: env.today })
    scheduleAt(env, active.id, env.today, s.day).catch(reportWriteError)
  }
}

/** The card under the pointer: a tree row, or a My Day row once over My Day. */
function DragCard({ env, s, grabX }: { env: CommandEnv; s: DragState; grabX: number }) {
  const { active } = s
  if (!active) return null
  if (active.pane === 'day' || s.over === 'day') {
    const item = env.dayItems.find((i) => i.task.id === active.id)
    const row = env.rows.find((r) => r.id === active.id)
    const path = item?.path ?? treePath(env, active.id)
    const title = item?.task.title ?? row?.node.title ?? ''
    return (
      <div
        className={`dragcard dragcard--day${active.pane === 'day' ? ' dragcard--fill' : ''}`}
        // From the tree, the small card sits just right of the pointer, wherever on the row it grabbed.
        style={active.pane === 'tree' ? { marginLeft: Math.max(0, grabX - 24) } : undefined}
      >
        <span className="dragcard__path">{path.join(PATH_SEPARATOR)}</span>
        <span className="dragcard__title">{title}</span>
      </div>
    )
  }
  const row = env.rows.find((r) => r.id === active.id)
  if (!row) return null
  const subtasks = countDescendants(row.node)
  const state = stateOf(row)
  // Just below and right of where the drop line starts, so the line and its ring stay in view;
  // its x follows the projected depth, not the pointer.
  return (
    <div className="dragcard" style={{ '--depth': s.tree?.depth ?? row.depth } as CSSProperties}>
      <span className="row__handle" aria-hidden="true">
        {GUIDE_DOTS}
      </span>
      <span className="row__chev" aria-hidden="true">
        {row.hasChildren && (
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M4.5 3 7.5 6 4.5 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className={`cb cb--${state === 'worked' ? 'open' : state}`} aria-hidden="true">
        <CheckMark state={state} />
      </span>
      <span className="dragcard__title">{row.node.title}</span>
      {subtasks > 0 && <span className="dragcard__badge">+{subtasks}</span>}
    </div>
  )
}

const countDescendants = (n: TreeNode): number =>
  n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)

/** My Day's path for a tree task: its ancestors' titles, or "Inbox". */
function treePath(env: CommandEnv, id: string): string[] {
  const path: string[] = []
  let row = env.rows.find((r) => r.id === id)
  if (row?.section === 'inbox') return ['Inbox']
  while (row?.parentId) {
    const parentId: string = row.parentId
    row = env.rows.find((r) => r.id === parentId)
    if (row) path.unshift(row.node.title)
  }
  return path
}

const titleOf = (env: CommandEnv | null, id: string) =>
  env?.rows.find((r) => r.id === id)?.node.title ??
  env?.dayItems.find((i) => i.task.id === id)?.task.title ??
  'task'

/** In the tree the card's x is set by the projected depth (see DragCard and .dragcard), not the pointer. */
const treeCard =
  (s: DragState): Modifier =>
  ({ transform }) =>
    s.active?.pane === 'tree' && s.over !== 'day' ? { ...transform, x: 0 } : transform

/** While a drop would be refused (a parent over Inbox), the rows stay put instead of opening a slot. */
export const STAY_PUT: SortingStrategy = () => null

/** One DndContext around the tree and My Day: reorder and indent in the tree, plan and reorder My Day. */
export function DragAndDrop({ children }: { children: ReactNode }) {
  const getEnv = useCommandEnv()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [state, setState] = useState<DragState>(IDLE)
  const [grabX, setGrabX] = useState(0)
  const shown = useRef('')
  const keysBack = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      clearTimeout(keysBack.current)
      useUi.getState().set({ dragging: false })
    },
    [],
  )

  const update = (e: DragMoveEvent) => {
    const env = getEnv()
    if (!env) return
    const next = project(env, e)
    // Re-render only when the drop target changes, not on every pointer move.
    const key = JSON.stringify(next)
    if (key !== shown.current) {
      shown.current = key
      setState(next)
    }
  }
  const reset = () => {
    shown.current = ''
    setState(IDLE)
    useUi.getState().set({ dragging: false })
  }
  const cancel = () => {
    shown.current = ''
    setState(IDLE)
    // dnd-kit cancels on Esc from a document listener, before the window one sees that same Esc;
    // keys stay off until it has passed.
    keysBack.current = setTimeout(() => useUi.getState().set({ dragging: false }), 0)
  }

  const announce = (id: string | number) => titleOf(getEnv(), parse(id)?.id ?? '')
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      // Measured while dragging, and again as rows come and go (a dragged parent's children
      // leave the list for the card).
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      onDragStart={(e: DragStartEvent) => {
        useUi.getState().set({ dragging: true, confirm: null })
        const pointer = e.activatorEvent as MouseEvent
        const row = pointer.target instanceof Element ? pointer.target.closest('.dragrow') : null
        setGrabX(row ? pointer.clientX - row.getBoundingClientRect().left : 0)
        setState({ ...IDLE, active: parse(e.active.id) as DragState['active'] })
      }}
      onDragMove={update}
      onDragOver={update}
      onDragEnd={(e: DragEndEvent) => {
        const env = getEnv()
        reset()
        if (env) drop(env, project(env, e))
      }}
      onDragCancel={cancel}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up '${announce(active.id)}'`,
          onDragOver: () => undefined,
          onDragEnd: ({ active }) => `Dropped '${announce(active.id)}'`,
          onDragCancel: ({ active }) => `Put '${announce(active.id)}' back`,
        },
      }}
    >
      <DragContext.Provider value={state}>{children}</DragContext.Provider>
      <DragOverlay dropAnimation={null} modifiers={[treeCard(state)]}>
        {state.active && <DragCardHost getEnv={getEnv} s={state} grabX={grabX} />}
      </DragOverlay>
    </DndContext>
  )
}

function DragCardHost({
  getEnv,
  s,
  grabX,
}: {
  getEnv: () => CommandEnv | null
  s: DragState
  grabX: number
}) {
  const env = getEnv()
  // dnd-kit measures the overlay's only child to pick the drop target. This anchor keeps that box
  // the size of the grabbed row, on the pointer, while the card inside sits offset from it.
  return env ? (
    <div className="dragcard__anchor">
      <DragCard env={env} s={s} grabX={grabX} />
    </div>
  ) : null
}

/** Registers a pane as a drop area, so the pointer's pane picks the targets. */
export function usePaneDrop(pane: Pane): (el: HTMLElement | null) => void {
  return useDroppable({ id: PANE_ID[pane] }).setNodeRef
}

// Controls keep their clicks: a drag never starts on them, nor in a title being edited.
const NO_DRAG = 'button, input, textarea, a, [data-title-editor]'

/** The drop indicator on a row: from the depth the task lands at (tree) or full width (My Day), above or below the row. */
export interface Indicator {
  depth: number | 'full'
  at?: 'top' | 'bottom'
}

export interface DragRowProps {
  pane: Pane
  id: string
  disabled: boolean
  indicator?: Indicator
  /** The class while this row is the one being dragged. */
  activeClass?: string
  children: ReactNode
}

/** A row that can be dragged and dropped onto: it moves aside as the list sorts itself. */
export function DragRow({ pane, id, disabled, indicator, activeClass, children }: DragRowProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: dndId(pane, id),
    disabled,
  })
  const style: CSSProperties = { transition }
  if (transform) style.transform = `translate3d(0, ${Math.round(transform.y)}px, 0)`
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest(NO_DRAG)) return
    listeners?.onPointerDown?.(e)
  }
  const cls = ['dragrow', isDragging && activeClass].filter(Boolean).join(' ')
  return (
    <div ref={setNodeRef} role="none" style={style} className={cls} onPointerDown={onPointerDown}>
      {children}
      {indicator && <DropLine {...indicator} />}
    </div>
  )
}

/** A heading rows sort around and can be dropped onto; it never moves itself. */
export function DropHeading({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, transform, transition } = useSortable({
    id: dndId('tree', id),
    disabled: { draggable: true },
  })
  const style: CSSProperties = { transition }
  if (transform) style.transform = `translate3d(0, ${Math.round(transform.y)}px, 0)`
  return (
    <div ref={setNodeRef} role="none" style={style}>
      {children}
    </div>
  )
}

/** The insertion line: a 2 px accent line, in the tree with a ring where the task will land. */
function DropLine({ depth, at = 'top' }: Indicator) {
  const cls = [
    'dropline',
    depth === 'full' && 'dropline--full',
    at === 'bottom' && 'dropline--bottom',
  ]
  const style = depth === 'full' ? undefined : ({ '--depth': depth } as CSSProperties)
  return <span className={cls.filter(Boolean).join(' ')} style={style} aria-hidden="true" />
}

/** The bar under the tree during a drag: "Level 3 becomes a sibling of '…' · Esc cancels". */
export function DropLabel({ label }: { label: string }) {
  const cut = label.indexOf(' · ')
  return (
    <div className="keyhints droplabel" role="status">
      <span className="droplabel__level">{label.slice(0, cut)}</span>{' '}
      <span>{label.slice(cut + 3)} · Esc cancels</span>
    </div>
  )
}
