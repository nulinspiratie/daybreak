// What the service worker does with a request. Kept apart from sw.ts so it can be tested in node.

export interface RequestInfo {
  method: string
  mode: string
  url: string
}

/**
 * Only page loads of the app itself are handled, and only to show the "not running" page when the
 * server can't be reached. The API, the live feed and assets always go straight to the server:
 * nothing is cached, so the page never shows stale tasks or an old build.
 */
export function handlesRequest(req: RequestInfo, origin: string): boolean {
  return req.method === 'GET' && req.mode === 'navigate' && new URL(req.url).origin === origin
}

/**
 * The offline page with the theme tokens and the app icon inlined: its colours follow tokens.css,
 * and it needs nothing from the server, which is down whenever it's shown.
 */
export function offlinePage(template: string, tokensCss: string, iconSvg: string): string {
  return template.replace('/* TOKENS */', () => tokensCss).replace('<!-- ICON -->', () => iconSvg)
}
