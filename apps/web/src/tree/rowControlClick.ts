import type { MouseEvent } from 'react'

/**
 * Row controls let go of focus after a mouse click (detail > 0), so Space and Enter go to the
 * selected row next. Keyboard activation (detail 0) keeps focus on a tabbed-to button.
 */
export function rowControlClick(e: MouseEvent<HTMLElement>, action: () => void): void {
  e.stopPropagation()
  if (e.detail > 0) e.currentTarget.blur()
  action()
}

/**
 * The quick actions show once a row is selected, so the second click of a double-click on the row
 * can land on one. That click (detail 2) is part of the double-click, not a press of the button.
 */
export function quickAction(e: MouseEvent<HTMLElement>, action: () => void): void {
  if (e.detail > 1) {
    e.stopPropagation()
    return
  }
  rowControlClick(e, action)
}
