/**
 * Sets <meta name="theme-color"> to the window background, so an installed Daybreak window's
 * own title bar matches the app in either theme. Read from the `--win` token, after CSS has loaded.
 */
export function syncThemeColor(doc: Document = document): void {
  const view = doc.defaultView
  if (!view) return
  const color = view.getComputedStyle(doc.documentElement).getPropertyValue('--win').trim()
  const meta = doc.querySelector('meta[name="theme-color"]')
  if (color && meta) meta.setAttribute('content', color)
}
