import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shouldRegister } from '../src/pwa/register'
import { handlesRequest, offlinePage } from '../src/pwa/route'

const ORIGIN = 'http://127.0.0.1:47815'
const req = (url: string, mode = 'navigate', method = 'GET') => ({ url, mode, method })

describe('service worker routing', () => {
  it('handles page loads of the app', () => {
    expect(handlesRequest(req(`${ORIGIN}/`), ORIGIN)).toBe(true)
    expect(handlesRequest(req(`${ORIGIN}/?x=1`), ORIGIN)).toBe(true)
  })

  it('leaves the API, the live feed and assets alone', () => {
    expect(handlesRequest(req(`${ORIGIN}/api/tasks`, 'cors'), ORIGIN)).toBe(false)
    expect(handlesRequest(req(`${ORIGIN}/api/tasks`, 'same-origin', 'POST'), ORIGIN)).toBe(false)
    expect(handlesRequest(req(`${ORIGIN}/events/stream`, 'cors'), ORIGIN)).toBe(false)
    expect(handlesRequest(req(`${ORIGIN}/assets/main.js`, 'no-cors'), ORIGIN)).toBe(false)
  })

  it('leaves other origins alone', () => {
    expect(handlesRequest(req('https://example.com/'), ORIGIN)).toBe(false)
    expect(handlesRequest(req('http://localhost:47815/'), ORIGIN)).toBe(false)
  })

  it('inlines the theme tokens and the icon into the offline page', () => {
    const template = readFileSync(new URL('../src/pwa/offline.html', import.meta.url), 'utf8')
    const page = offlinePage(template, ':root { --win: #f3f3f3; } /* $& */', '<svg>$&</svg>')
    expect(page).toContain(':root { --win: #f3f3f3; } /* $& */')
    expect(page).toContain('<svg>$&</svg>')
    expect(page).not.toContain('/* TOKENS */')
    expect(page).not.toContain('<!-- ICON -->')
    expect(page).toContain("Daybreak isn't running")
  })
})

describe('service worker registration', () => {
  const nav = { serviceWorker: {} }

  it('registers in a production build in a browser', () => {
    expect(shouldRegister({ prod: true, win: {}, nav })).toBe(true)
  })

  it('does not register in development, inside Tauri, or without service workers', () => {
    expect(shouldRegister({ prod: false, win: {}, nav })).toBe(false)
    expect(shouldRegister({ prod: true, win: { __TAURI_INTERNALS__: {} }, nav })).toBe(false)
    expect(shouldRegister({ prod: true, win: {}, nav: {} })).toBe(false)
  })
})
