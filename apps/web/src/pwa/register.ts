/**
 * Whether to register the service worker: only in a production build served by Daybreak's own
 * server, and never inside the Tauri shell (phase 6). Tauri has its own window, tray and single
 * instance, and service workers don't work on its custom asset protocol, so the worker would only
 * get in the way there.
 */
export function shouldRegister(env: { prod: boolean; win: object; nav: object }): boolean {
  return env.prod && 'serviceWorker' in env.nav && !('__TAURI_INTERNALS__' in env.win)
}

export function registerServiceWorker(): void {
  if (!shouldRegister({ prod: import.meta.env.PROD, win: window, nav: navigator })) return
  // After the page has loaded, so it never competes with the first render.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
      console.warn('Daybreak: service worker not registered', e)
    })
  })
}
