import { render, screen } from '@testing-library/react'
import { MoreVertical } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { Button } from './button'

describe('Button sizing', () => {
  it('gives compact text and icon-only buttons the same height', () => {
    render(
      <>
        <Button size="sm">Share</Button>
        <Button size="icon-sm" aria-label="Actions">
          <MoreVertical />
        </Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Share' })).toHaveClass('h-8')
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveClass('size-8')
  })
})
