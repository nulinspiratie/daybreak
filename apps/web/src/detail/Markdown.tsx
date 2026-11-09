import MarkdownIt from 'markdown-it'
import { useMemo } from 'react'

// html: false turns raw HTML in notes into text. markdown-it's own link check refuses javascript: and data: urls.
const md = new MarkdownIt({ html: false, linkify: true })

// No image is fetched from notes (a remote fetch would leak): the syntax stays as text.
md.disable('image')
// Only what the server will open becomes an anchor; anything else shows as plain text.
const openable = /^(https?:\/\/|mailto:)/i
const baseValidate = md.validateLink.bind(md)
md.validateLink = (url) => baseValidate(url) && openable.test(url.trim())

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options))
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i]!.attrSet('target', '_blank')
  tokens[i]!.attrSet('rel', 'noopener')
  return defaultLinkOpen(tokens, i, options, env, self)
}

export const renderMarkdown = (source: string): string => md.render(source)

/**
 * Notes as HTML. A click on a link is not left to the WebView (it would open a pop-up window): it
 * is handed to `onOpenLink`, which asks the server to open it.
 */
export function Markdown({
  source,
  onOpenLink,
}: {
  source: string
  onOpenLink: (href: string) => void
}) {
  const html = useMemo(() => renderMarkdown(source), [source])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: links inside are real anchors, which the keyboard already activates
    <div
      className="md"
      onClick={(e) => {
        const a = e.target instanceof Element ? e.target.closest('a') : null
        if (!a) return
        e.preventDefault()
        e.stopPropagation()
        const href = a.getAttribute('href')
        if (href) onOpenLink(href)
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it output with html: false
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
