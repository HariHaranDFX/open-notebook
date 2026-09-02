import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SessionManager } from './SessionManager'

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({ data: [] }),
}))

const session = {
  id: 'session:research',
  title: 'Research notes',
  created: '2026-08-26T12:00:00.000Z',
  updated: '2026-08-26T12:00:00.000Z',
}

function renderSessionManager() {
  render(
    <SessionManager
      sessions={[session]}
      currentSessionId={session.id}
      onCreateSession={vi.fn()}
      onSelectSession={vi.fn()}
      onUpdateSession={vi.fn()}
      onDeleteSession={vi.fn()}
      loadingSessions={false}
    />,
  )
}

describe('SessionManager', () => {
  it('uses a flat container with one divided, evenly spaced header', () => {
    renderSessionManager()

    const card = screen.getByText('Research notes').closest('[data-slot="card"]')
    const header = screen.getByText('chat.sessions').closest('[data-slot="card-header"]')
    const title = screen.getByText('chat.sessions').closest('[data-slot="card-title"]')
    const action = screen
      .getByRole('button', { name: 'common.create' })
      .closest('[data-slot="card-action"]')

    expect(card).toHaveClass('gap-0', 'rounded-none', 'border-0', 'py-0')
    expect(header).toHaveClass('grid-rows-1', 'items-center', 'border-b', 'border-border')
    expect(title).toHaveClass('items-center')
    expect(title).not.toHaveClass('pr-8')
    expect(action).toHaveClass('row-span-1', 'row-start-1', 'self-center')
    expect(screen.getByTestId('session-scroll-content')).toHaveClass('py-4')
  })

  it('uses primary edit and destructive delete colors on session actions', () => {
    renderSessionManager()

    expect(screen.getByRole('button', { name: 'common.edit' })).toHaveClass(
      'text-primary',
      'hover:bg-primary/10',
      'hover:text-primary',
    )
    expect(screen.getByRole('button', { name: 'common.delete' })).toHaveClass(
      'text-destructive',
      'hover:bg-destructive/10',
      'hover:text-destructive',
    )
  })
})
