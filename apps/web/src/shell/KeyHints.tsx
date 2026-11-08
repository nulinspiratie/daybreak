import { useUi } from '../ui/store'

type Hint = readonly [key: string, label: string]

const NAVIGATE: readonly Hint[] = [
  ['Enter', 'Edit'], ['N', 'New'], ['Tab', 'Indent'], ['Ctrl+↑↓', 'Move'], ['Ctrl+←→', 'Fold'],
  ['M', 'My Day'], ['T', 'Today'], ['D', 'Day'], ['B', 'Backlog'], ['S', 'Doing'], ['W', 'Worked on'],
  ['Space', 'Done'], ['X', 'Cancel'], ['Del', 'Delete'], ['Ctrl+O', 'Details'],
]

const EDIT: readonly Hint[] = [['Enter', 'New below'], ['Tab', 'Indent'], ['Esc', 'Done']]

/** The bar under the tree. Shows edit-mode hints while a title is being edited. */
export function KeyHints() {
  const editing = useUi((s) => s.editing !== null)
  const hints = editing ? EDIT : NAVIGATE
  return (
    <div className="keyhints" aria-label="Keyboard hints">
      {hints.map(([key, label]) => (
        <span className="keyhints__item" key={key}>
          <kbd className="keyhints__key">{key}</kbd>
          {label}
        </span>
      ))}
    </div>
  )
}
