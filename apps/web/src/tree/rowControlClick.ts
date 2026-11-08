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
