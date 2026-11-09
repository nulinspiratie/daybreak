import type { TreeNode } from '@daybreak/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Fragment, useCallback, useMemo, useRef } from 'react'
import { api } from '../api/client'
import { useMutate, useStatus, useTree } from '../api/hooks'
import type { Command } from '../keyboard/keymap'
import { reportWriteError, useCommandRunner } from '../keyboard/useKeyboard'
import { CONFIRM_NOTE_ID, ConfirmNote } from '../shell/ConfirmNote'
import { KeyHints } from '../shell/KeyHints'
import { useUi } from '../ui/store'
import { DragRow, DropHeading, DropLabel, dndId, STAY_PUT, useDrag, usePaneDrop } from './Dnd'
import { flatten, type FlatRow } from './flatten'
import { rowKey } from './optimistic'
import { PROJECTS_HEAD, withoutDescendants } from './projectDrop'
import { TreeRow } from './TreeRow'

function expandedParents(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length > 0) {
      if (!n.collapsed) out.push(n.id)
      expandedParents(n.children, out)
    }
  }
  return out
}

function SectionHead({ title, count }: { title: string; count: number }) {
  return (
    <div className="tree__section" role="none">
      <span>{title}</span>
      <span className="tree__section-count">{count}</span>
    </div>
  )
}

export function TreePane() {
  const showCompleted = useUi((s) => s.showCompleted)
  const treeSel = useUi((s) => s.treeSel)
  const draft = useUi((s) => s.draft)
  // A task listed in both panes is edited in the one that is active.
  const editingId = useUi((s) => (s.pane === 'tree' ? s.editing?.id : undefined))
  const confirmId = useUi((s) => (s.pane === 'tree' ? s.confirm?.id : undefined))
  const setUi = useUi((s) => s.set)
  const dragOff = useUi((s) => s.editing !== null || s.picker !== null)
  const drag = useDrag()
  const paneDrop = usePaneDrop('tree')
  const { data: tree, isError } = useTree(showCompleted ? 'all' : 'recent')
  const { data: status } = useStatus()
  const mutate = useMutate()
  const runCommand = useCommandRunner()
  const today = status?.today ?? tree?.today ?? ''

  const allRows = useMemo(() => (tree ? flatten(tree, draft) : []), [tree, draft])
  // A dragged parent's children travel in the card under the pointer.
  const dragged = drag.active?.pane === 'tree' ? drag.active.id : null
  const rows = useMemo(() => (dragged ? withoutDescendants(allRows, dragged) : allRows), [allRows, dragged])
  const firstProject = rows.findIndex((r) => r.section === 'projects')
  const projectsAt = firstProject < 0 ? rows.length : firstProject
  // The Projects heading is in the list too: rows sort around it, and dropping on it crosses sections.
  const dndIds = useMemo(() => {
    const ids = rows.map((r) => dndId('tree', r.id))
    ids.splice(projectsAt, 0, dndId('tree', PROJECTS_HEAD))
    return ids
  }, [rows, projectsAt])
  const dropLabel = drag.over === 'tree' && drag.tree ? drag.tree.label : null
  const stayPut = dragged !== null && drag.over === 'tree' && !drag.tree

  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      mutate(fn).catch(reportWriteError)
    },
    [mutate],
  )

  // Handlers read the latest rows through a ref so their identity never changes
  // and memoised rows are not re-rendered by selection changes.
  const latest = useRef({ rows: allRows })
  latest.current = { rows: allRows }
  const find = (id: string): TreeNode | undefined => latest.current.rows.find((r) => r.id === id)?.node

  const onSelect = useCallback((id: string) => setUi({ treeSel: id, pane: 'tree' }), [setUi])
  // Clicks on a row's checkbox and quick actions select the row and run the same command as
  // the key, so a click follows the same rules (e.g. the double press on a parent).
  const onRowCommand = useCallback(
    (id: string, cmd: Command) => {
      setUi({ treeSel: id, pane: 'tree' })
      runCommand(cmd)
    },
    [setUi, runCommand],
  )
  const onToggleDone = useCallback((id: string) => onRowCommand(id, 'status.done'), [onRowCommand])
  const onToggleCollapse = useCallback(
    (id: string) => {
      const collapsed = find(id)?.collapsed === true
      run(() => api.send('PATCH', `/api/tasks/${id}`, { collapsed: !collapsed }))
    },
    [run],
  )
  const onScheduleToday = useCallback((id: string) => onRowCommand(id, 'schedule.today'), [onRowCommand])
  const onDoing = useCallback((id: string) => onRowCommand(id, 'mark.doing'), [onRowCommand])
  const onPickDay = useCallback((id: string) => onRowCommand(id, 'schedule.pick'), [onRowCommand])
  // Same as N: a draft after the selected task's subtree, or at the end of Inbox.
  const onNewTask = useCallback(() => {
    setUi({ pane: 'tree' })
    runCommand('new.below')
  }, [setUi, runCommand])
  // Blur from the title editor; one that comes after editing moved elsewhere is ignored.
  const onLeaveEdit = useCallback(
    (id: string) => {
      if (useUi.getState().editing?.id === id) runCommand('edit.exit')
    },
    [runCommand],
  )
  const collapseAll = () => {
    if (!tree) return
    for (const id of expandedParents([...tree.inbox, ...tree.projects])) {
      run(() => api.send('PATCH', `/api/tasks/${id}`, { collapsed: true }))
    }
  }

  const inboxOpen = tree ? tree.inbox.filter((n) => n.status === 'open').length : 0
  const renderRow = (r: FlatRow) => {
    const isDragged = r.id === dragged
    return (
      // Keyed by the placeholder a new row was first shown under, so it isn't remounted (and its
      // editor reset) when the server's answer gives it its real id.
      <Fragment key={rowKey(r.id)}>
        <DragRow
          pane="tree"
          id={r.id}
          disabled={dragOff || r.isDraft === true}
          indicator={isDragged && drag.over === 'tree' && drag.tree ? { depth: drag.tree.depth } : undefined}
          activeClass={drag.over === 'day' ? 'dragrow--origin' : 'dragrow--source'}
        >
          <TreeRow
            row={r}
            today={today}
            selected={treeSel === r.id}
            onSelect={onSelect}
            onToggleCollapse={onToggleCollapse}
            onToggleDone={onToggleDone}
            onScheduleToday={onScheduleToday}
            onDoing={onDoing}
            onPickDay={onPickDay}
            describedBy={confirmId === r.id ? CONFIRM_NOTE_ID : undefined}
            editing={editingId === r.id}
            onLeaveEdit={onLeaveEdit}
            previewToday={isDragged && drag.over === 'day'}
          />
        </DragRow>
        {confirmId === r.id && <ConfirmNote depth={r.depth} />}
      </Fragment>
    )
  }

  return (
    <section ref={paneDrop} className="pane pane--tree" aria-label="Task tree">
      <div className="pane__head tree__head">
        <h1>Tasks</h1>
        <span className="tree__grow" />
        <button
          type="button"
          className="btn btn--toggle"
          aria-pressed={showCompleted}
          onClick={() => setUi({ showCompleted: !showCompleted })}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
            <rect x="2.5" y="2.5" width="11" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.2 8.2 7.2 10.2 10.8 6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Show completed{!showCompleted && tree ? ` (${tree.hiddenCompletedCount})` : ''}
        </button>
        <button type="button" className="btn btn--icon" aria-label="Collapse all" onClick={collapseAll}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
            <path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onNewTask}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
            <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          New task
          <span className="btn__key">N</span>
        </button>
      </div>

      <div className="tree" role="tree" aria-label="Tasks">
        {isError && <p className="tree__msg">Could not load tasks.</p>}
        {!tree && !isError && <p className="tree__msg">Loading…</p>}
        {tree && (
          <SortableContext items={dndIds} strategy={stayPut ? STAY_PUT : verticalListSortingStrategy}>
            <SectionHead title="Inbox" count={inboxOpen} />
            {rows.slice(0, projectsAt).map(renderRow)}
            <DropHeading id={PROJECTS_HEAD}>
              <SectionHead title="Projects" count={tree.projects.length} />
            </DropHeading>
            {rows.slice(projectsAt).map(renderRow)}
          </SortableContext>
        )}
      </div>
      {/* The hints keep their place under the drop label, so the tree doesn't resize mid-drag. */}
      <div className={`tree__foot${dropLabel ? ' tree__foot--drop' : ''}`}>
        <KeyHints />
        {dropLabel && <DropLabel label={dropLabel} />}
      </div>
    </section>
  )
}
