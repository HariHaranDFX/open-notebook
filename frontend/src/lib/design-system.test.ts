import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
const scrollArea = readFileSync(
  path.resolve(process.cwd(), 'src/components/ui/scroll-area.tsx'),
  'utf8',
)

describe('WP3 design tokens', () => {
  it.each([
    '--background: #F1F4F7',
    '--primary: var(--brand-action-light, #275E91)',
    '--ring: #AD7620',
    '--provenance: #3D6D8D',
    '--surface-radius: 4px',
    '--control-radius: 5px',
    '--overlay-radius: 10px',
    '--motion-fast: 120ms',
    '--motion-standard: 160ms',
    '--motion-overlay: 220ms',
  ])('contains %s', (token) => expect(css).toContain(token))

  it('contains the independent dark theme', () => {
    expect(css).toContain('--background: #101820')
    expect(css).toContain('--primary: var(--brand-action-dark, #74A9D6)')
    expect(css).toContain('--ring: #EFB65B')
  })

  it('defines accessible light and dark resource icon colors', () => {
    expect(css).toContain('--resource-notebook: #5B4B8A')
    expect(css).toContain('--resource-spreadsheet: #356B62')
    expect(css).toContain('--resource-media: #5F5489')
    expect(css).toContain('--resource-notebook: #C4B5E6')
    expect(css).toContain('--resource-spreadsheet: #86CFBE')
    expect(css).toContain('--resource-media: #C4B9ED')
    expect(css).not.toContain('--resource-notebook-surface')
  })

  it('gives the sidebar distinct light and dark theme canvases', () => {
    expect(css).toContain('--sidebar: #E5EBF0')
    expect(css).toContain('--sidebar: #0C1218')
  })

  it('uses one thin scrollbar treatment throughout the app', () => {
    expect(css).toContain('--scrollbar-thumb: var(--border-strong)')
    expect(css).toContain('--scrollbar-thumb-hover: var(--muted-foreground)')
    expect(css).toMatch(/\*\s*\{[\s\S]*?scrollbar-width:\s*thin;/)
    expect(css).toMatch(/\*::-webkit-scrollbar\s*\{[\s\S]*?width:\s*6px;/)
    expect(css).toContain('scrollbar-color: var(--scrollbar-thumb) transparent')
    expect(scrollArea).toContain('bg-[var(--scrollbar-thumb)]')
    expect(scrollArea).toContain('hover:bg-[var(--scrollbar-thumb-hover)]')
    expect(css).not.toContain('.sidebar-scroll-region::-webkit-scrollbar')
    expect(css).not.toMatch(/\.sidebar-scroll-region\s*\{[\s\S]*?scrollbar-/)
  })

  it('uses semantic cursors for interactive and disabled controls', () => {
    expect(css).toContain('a[href]')
    expect(css).toContain('button:not(:disabled)')
    expect(css).toContain('[role="button"]:not([aria-disabled="true"])')
    expect(css).toContain('cursor: pointer')
    expect(css).toContain('[aria-disabled="true"]')
    expect(css).toContain('cursor: not-allowed')
  })
})
