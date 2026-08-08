import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

describe('WP3 design tokens', () => {
  it.each([
    '--background: #F1F4F7',
    '--primary: var(--brand-action-light, #275E91)',
    '--ring: #AD7620',
    '--provenance: #3D6D8D',
    '--surface-radius: 2px',
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
})
