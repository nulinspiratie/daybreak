import type { Daybreak } from './service'
import type { Section } from './types'

// Fictional data transcribed from docs/mockups/Main.dc.html. `due` is a day offset from today.
interface Seed {
  title: string
  link?: string
  notes?: string
  due?: number
  doing?: boolean
  status?: 'done' | 'cancelled'
  collapsed?: boolean
  children?: Seed[]
}

const INBOX: Seed[] = [
  { title: 'Message Anja about the cryostat cooldown slot', due: 0 },
  { title: 'Reply to Marcus re: wire-bonding quote', due: -3 },
  { title: 'Book a room for Thursday’s design review', due: 2 },
  { title: 'Check whether the spare HEMT amplifier arrived' },
  { title: 'Renew lab safety training', due: 4 },
  { title: 'Ask IT about VPN on the measurement PC', status: 'cancelled' },
  { title: 'Forward fridge maintenance log to facilities', due: 13 },
  { title: 'Call facilities about the helium delivery', due: 0 },
  { title: 'Send cooldown slides to Priya', status: 'done' },
]

const PROJECTS: Seed[] = [
  {
    title: 'Fridge 3 readout upgrade',
    link: '\\\\labshare\\fridge3',
    notes: '**Scope:** replace the HEMT-only chain with TWPA + HEMT on all four lines.',
    children: [
      {
        title: 'Milestone 1 — Design and procurement',
        collapsed: true,
        children: [
          { title: 'Finalise wiring plan', status: 'done' },
          { title: 'Get quotes for TWPA and HEMT', status: 'done' },
          { title: 'Order attenuators and filters', status: 'done' },
        ],
      },
      {
        title: 'Milestone 2 — Install and cooldown',
        children: [
          { title: 'Order replacement coax lines', status: 'done' },
          {
            title: 'Install TWPA on the mixing chamber plate',
            link: '\\\\labshare\\fridge3\\wiring\\F3-MXC-rev4.pdf',
            notes: [
              '**Goal:** TWPA mounted and wired on the MXC plate before the next cooldown.',
              '',
              '- Use the rev 4 bulkhead drawing for the SMA feedthroughs',
              '- Pump line needs the 20 dB attenuator at the 4 K stage',
              '- Check with Anja that there is room next to the circulators',
            ].join('\n'),
            children: [
              { title: 'Verify pump tone frequency with the VNA', doing: true },
              { title: 'Thermal anchoring check before closing the can' },
            ],
          },
          {
            title: 'Update wiring diagram in the lab wiki',
            link: 'https://wiki.lab/fridge3/wiring',
            due: 0,
          },
          { title: 'Plan cooldown window with Anja', due: 1 },
        ],
      },
      {
        title: 'Milestone 3 — Characterise noise temperature',
        collapsed: true,
        children: [
          { title: 'Y-factor measurement with hot/cold load', due: 10 },
          { title: 'Compare against HEMT-only baseline' },
          { title: 'Write up results for the readout review' },
          { title: 'Present at group meeting' },
        ],
      },
    ],
  },
  {
    title: 'Parity-readout calibration pipeline',
    children: [
      {
        title: 'Port fit routines to the new data format',
        children: [
          {
            title: 'Write loader for HDF5 v2 files',
            notes: [
              '**Status:** reader works for single runs; sweeps still fail on the nested groups.',
              '',
              '- Keep the old loader behind a flag until regression tests pass',
            ].join('\n'),
          },
          { title: 'Regression tests against the March datasets', due: 7 },
        ],
      },
      {
        title: 'Automate the daily tune-up run',
        children: [{ title: 'Draft runbook for the tune-up sequence', due: -1 }],
      },
      { title: 'Review Jonas’s PR on drift correction', status: 'done' },
    ],
  },
  {
    title: 'Hiring: lab engineer',
    collapsed: true,
    children: [
      { title: 'Write job description' },
      { title: 'Screen applications', due: 17 },
      { title: 'Line up interview panel' },
      { title: 'Prepare practical exercise' },
    ],
  },
]

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** Fill an empty database with fictional data, using only the public facade. */
export function seed(d: Daybreak): void {
  const today = d.today()
  const later: (() => void)[] = []

  const add = (node: Seed, section: Section, parentId: string | null) => {
    const t = d.create({ title: node.title, section, parentId })
    if (node.link !== undefined || node.notes !== undefined) {
      d.update(t.id, { link: node.link ?? null, notes: node.notes ?? '' })
    }
    if (node.due !== undefined) d.schedule(t.id, addDays(today, node.due))
    for (const child of node.children ?? []) add(child, section, t.id)
    // Marks, closing and collapsing wait until the whole tree exists.
    if (node.doing) later.push(() => d.setMark(t.id, 'doing'))
    if (node.status) later.push(() => d.setStatus(t.id, node.status!))
    if (node.collapsed) later.push(() => d.update(t.id, { collapsed: true }))
  }

  for (const node of INBOX) add(node, 'inbox', null)
  for (const node of PROJECTS) add(node, 'projects', null)
  for (const run of later) run()
}
