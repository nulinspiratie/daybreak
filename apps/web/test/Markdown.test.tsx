// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '../src/detail/Markdown'

afterEach(cleanup)

describe('Markdown', () => {
  it('renders **bold**, lists and code', () => {
    const { container } = render(<Markdown source={'**bold** and `code`\n\n- one\n- two'} onOpenLink={() => {}} />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two'])
  })

  it('shows <img src=x onerror=alert(1)> as text, no img element', () => {
    const { container } = render(<Markdown source="<img src=x onerror=alert(1)>" onOpenLink={() => {}} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('links open with target=_blank rel=noopener', () => {
    const { container } = render(<Markdown source={'[docs](https://example.com/a) and https://example.org'} onOpenLink={() => {}} />)
    const links = [...container.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a', 'https://example.org'])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener')
    }
  })

  it('does not link javascript: urls', () => {
    const { container } = render(<Markdown source="[x](javascript:alert(1))" onOpenLink={() => {}} />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('a click on a link is intercepted and handed to onOpenLink', () => {
    const open = vi.fn()
    const { container } = render(<Markdown source="[docs](https://example.com/a)" onOpenLink={open} />)
    const notPrevented = fireEvent.click(container.querySelector('a')!)
    expect(notPrevented).toBe(false)
    expect(open).toHaveBeenCalledWith('https://example.com/a')
  })

  it('does not load images: the syntax stays as text', () => {
    const { container } = render(<Markdown source="![t](https://evil.example/p.png)" onOpenLink={() => {}} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('links with a scheme the server refuses stay plain text', () => {
    const { container } = render(<Markdown source={'[a](ms-msdt:foo) [b](file:///C:/x) [c](mailto:a@b.c)'} onOpenLink={() => {}} />)
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['mailto:a@b.c'])
  })
})
