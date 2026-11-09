import { describe, expect, it } from 'vitest'
import { createDaybreak, seed } from '../src/index'
import { makeCtx } from './helpers'

async function make() {
  const ctx = await makeCtx()
  return createDaybreak({ db: ctx.db, clock: ctx.clock, config: ctx.config })
}

describe('exportProject', () => {
  it('exports the seeded fridge project as indented Markdown', async () => {
    const d = await make()
    seed(d)
    const fridge = d.tree('all').projects[0]!
    const md = d.exportProject(fridge.id)
    const lines = md.split('\n')
    expect(lines[0]).toBe(`# Fridge 3 readout upgrade (#${fridge.id})`)
    const m2 = fridge.children[1]!
    const coax = m2.children[0]!
    const twpa = m2.children[1]!
    const pump = twpa.children[0]!
    const plan = m2.children[3]!
    expect(lines).toContain(`- [ ] Milestone 2 — Install and cooldown (#${m2.id})`)
    expect(lines).toContain(`  - [x] Order replacement coax lines (#${coax.id})`)
    expect(lines).toContain(
      `    - [ ] Verify pump tone frequency with the VNA (#${pump.id}) · Today`,
    )
    expect(lines).toContain(`  - [ ] Plan cooldown window with Anja (#${plan.id}) · Wed`)
    // project notes follow the heading; item notes sit 2 spaces past the item's "- "
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^\*\*Scope:\*\*|^Scope:/)
    expect(lines).toContain(`  - [ ] Install TWPA on the mixing chamber plate (#${twpa.id})`)
    const at = lines.indexOf(`  - [ ] Install TWPA on the mixing chamber plate (#${twpa.id})`)
    expect(lines[at + 1]).toMatch(/^ {4}\S/)
  })

  it('marks cancelled with [-], skips deleted tasks, and labels scheduled roots', async () => {
    const d = await make()
    const p = d.create({ title: 'P', section: 'projects' })
    const a = d.create({ title: 'A', section: 'projects', parentId: p.id })
    const b = d.create({ title: 'B', section: 'projects', parentId: p.id })
    const c = d.create({ title: 'C', section: 'projects', parentId: p.id })
    d.setStatus(a.id, 'cancelled')
    d.delete(b.id)
    d.update(c.id, { notes: 'line one\n\nline three' })
    d.schedule(p.id, '2026-10-22')
    expect(d.exportProject(p.id)).toBe(
      [
        `# P (#${p.id}) · 22 Oct`,
        '',
        `- [-] A (#${a.id})`,
        `- [ ] C (#${c.id})`,
        '  line one',
        '',
        '  line three',
        '',
      ].join('\n'),
    )
  })
})
