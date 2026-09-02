import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkspaceSkeleton } from './WorkspaceSkeleton'

describe('WorkspaceSkeleton', () => {
  it('uses localized loading copy for its status name', () => {
    render(<WorkspaceSkeleton kind="source" />)

    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('Loading workspace')).not.toBeInTheDocument()
  })
})
