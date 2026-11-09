// Daybreak's service worker. It makes the app installable as a window of its own (Edge or Chrome:
// "Install Daybreak") and shows a "Daybreak isn't running" page instead of the browser's error
// page when the server is off. It caches nothing, so there is nothing to go stale after an update;
// the offline page is built into this file, so changing it changes the worker and updates it.
//
// Not registered inside Tauri (see register.ts).
import iconSvg from '../../public/daybreak.svg?raw'
import tokensCss from '../theme/tokens.css?raw'
import template from './offline.html?raw'
import { handlesRequest, offlinePage } from './route'

// The DOM lib and the WebWorker lib can't share one program, so type just what is used here.
interface FetchEventLike {
  request: Request
  respondWith(response: Promise<Response>): void
}
interface ExtendableEventLike {
  waitUntil(work: Promise<unknown>): void
}
interface WorkerScope {
  location: { origin: string }
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEventLike) => void): void
  addEventListener(type: 'fetch', listener: (e: FetchEventLike) => void): void
}

const scope = globalThis as unknown as WorkerScope
const OFFLINE = offlinePage(template, tokensCss, iconSvg)

// Nothing is cached, so a new version can take over at once.
scope.addEventListener('install', (e) => e.waitUntil(scope.skipWaiting()))
scope.addEventListener('activate', (e) => e.waitUntil(scope.clients.claim()))

scope.addEventListener('fetch', (e) => {
  if (!handlesRequest(e.request, scope.location.origin)) return
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(OFFLINE, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
    ),
  )
})
