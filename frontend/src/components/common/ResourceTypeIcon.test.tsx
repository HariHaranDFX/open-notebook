import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { getSourceResourceKind, ResourceTypeIcon } from './ResourceTypeIcon'

describe('getSourceResourceKind', () => {
  it.each([
    [{ url: 'https://example.com' }, 'link'],
    [{ original_filename: 'report.pdf' }, 'document'],
    [{ original_filename: 'briefing.pptx' }, 'presentation'],
    [{ original_filename: 'register.xlsx' }, 'spreadsheet'],
    [{ original_filename: 'diagram.png' }, 'image'],
    [{ original_filename: 'interview.m4a' }, 'audio'],
    [{ original_filename: 'demo.mp4' }, 'video'],
    [{ original_filename: 'evidence.tar.gz' }, 'archive'],
    [{ original_filename: 'notes.md' }, 'text'],
    [{ original_filename: 'unknown.bin' }, 'document'],
    [null, 'text'],
  ] as const)('maps %o to the %s resource family', (asset, expected) => {
    expect(getSourceResourceKind(asset)).toBe(expected)
  })

  it('renders a compact colored icon without a background surface', () => {
    render(<ResourceTypeIcon kind="spreadsheet" />)

    const tile = screen.getByTestId('resource-type-icon')
    expect(tile).toHaveAttribute('data-resource-kind', 'spreadsheet')
    expect(tile).toHaveAttribute('aria-hidden', 'true')
    expect(tile).toHaveClass(
      'size-7',
      'text-[var(--resource-spreadsheet)]',
    )
    expect([...tile.classList].some(className => className.startsWith('bg-'))).toBe(false)
    expect(tile.querySelector('.lucide-file-spreadsheet')).toBeInTheDocument()
  })
})
