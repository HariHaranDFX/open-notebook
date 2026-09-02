import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { getSourceResourceKind, ResourceTypeIcon } from './ResourceTypeIcon'

describe('getSourceResourceKind', () => {
  it.each([
    [{ url: 'https://example.com' }, 'link'],
    [{ file_path: '/uploads/report.pdf' }, 'document'],
    [{ file_path: '/uploads/briefing.pptx' }, 'presentation'],
    [{ file_path: '/uploads/register.xlsx' }, 'spreadsheet'],
    [{ file_path: '/uploads/diagram.png' }, 'image'],
    [{ file_path: '/uploads/interview.m4a' }, 'audio'],
    [{ file_path: '/uploads/demo.mp4' }, 'video'],
    [{ file_path: '/uploads/evidence.tar.gz' }, 'archive'],
    [{ file_path: '/uploads/notes.md' }, 'text'],
    [{ file_path: '/uploads/unknown.bin' }, 'document'],
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
