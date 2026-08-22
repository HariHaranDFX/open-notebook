import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ProfileCard, MetaChip } from './ProfileCard'

// useTranslation is mocked globally in setup.ts (t returns the key string)

function baseProps() {
  return {
    name: 'Deep dive',
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    deleteTitle: 'podcasts.deleteProfileTitle',
    deleteDescription: 'delete desc',
  }
}

describe('ProfileCard', () => {
  it('renders the name and description', () => {
    render(<ProfileCard {...baseProps()} description="Long-form analytical episodes" />)

    expect(screen.getByText('Deep dive')).toBeInTheDocument()
    expect(screen.getByText('Long-form analytical episodes')).toBeInTheDocument()
  })

  it('falls back to the no-description label when description is empty', () => {
    render(<ProfileCard {...baseProps()} description={null} />)

    expect(screen.getByText('podcasts.noDescription')).toBeInTheDocument()
  })

  it('shows the setup-required badge only when setupRequired is set', () => {
    const { rerender } = render(<ProfileCard {...baseProps()} />)
    expect(screen.queryByText('podcasts.setupRequired')).not.toBeInTheDocument()

    rerender(<ProfileCard {...baseProps()} setupRequired />)
    expect(screen.getByText('podcasts.setupRequired')).toBeInTheDocument()
  })

  it('calls onEdit when the Edit button is clicked', () => {
    const props = baseProps()
    render(<ProfileCard {...props} />)

    fireEvent.click(screen.getByText('podcasts.edit'))
    expect(props.onEdit).toHaveBeenCalledTimes(1)
  })

  it('renders body children', () => {
    render(
      <ProfileCard {...baseProps()}>
        <MetaChip label="Segments" value={5} />
      </ProfileCard>
    )

    expect(screen.getByText('Segments')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
