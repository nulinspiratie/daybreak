# CLAUDE.md

Conventions for the `docs/` knowledge base.

## Layout

- `papers/`, `web/`: raw sources (PDFs, articles). Immutable.
- `journal/`: dated quick captures (`YYYY-MM-DD.md`). Append-only.
- `notes/`: one page per source: `## My notes` (your framing) + `## Summary` (AI restatement).
- `wiki/`: AI-owned multi-source pages that compound across notes.
- Co-authored project docs live at the top of `docs/`: `spec.md`,
  `design.md`, `keyboard.md`, `handoff.md`, `future-ideas.md`. Canvas mock-ups are in
  `mockups/`; finished plans go in `archive/`.

## Mutation classes

- **Immutable** (`papers/`, `web/`): never edit.
- **AI-owned** (`## Summary` sections, `wiki/` bodies): regenerate freely.
- **Intent-preserving** (`## My notes`): reformat and fix transcription only;
  never alter meaning or add claims except as a flagged suggestion.

## Page format

- `notes/` and `wiki/` pages lead with an H1 title. No `title:` frontmatter.
- Wikilinks are rooted at `docs/`: `[[notes/<slug>]]`, `[[wiki/<slug>]]`.
  No `../`, no `.md`. The Obsidian vault opens at `docs/`.
- `wiki/` pages hold synthesized knowledge only; no TODO or status sections.
  Provenance lives in `sources:`, not prose.

## Synthesis

- Synthesis is downstream of notes: draw primarily from `## My notes` (the
  steering signal), substantiated by `## Summary` and raw sources. Never
  auto-extract a whole paper into the wiki.
- Every `wiki/` page's `sources:` frontmatter lists the `notes/` pages it
  draws from. This is the freshness index; there is no `stale` flag.
