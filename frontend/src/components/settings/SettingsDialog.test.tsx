import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { SettingsDialog } from './SettingsDialog'

// useTranslation is mocked globally in setup.ts (t returns the key string).
// Stub the heavy section bodies — this test only covers the modal's rail + switching.
vi.mock('@/app/(dashboard)/settings/components/SettingsForm', () => ({
  SettingsForm: () => <div>general-form</div>,
}))
vi.mock('@/components/settings', () => ({
  SystemInfo: () => <div>system-info</div>,
  RebuildEmbeddings: () => <div>rebuild-embeddings</div>,
}))

describe('SettingsDialog', () => {
  it('shows General and Advanced as a labeled settings-navigation menu', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    const nav = screen.getByRole('navigation', { name: 'common.accessibility.settingsNav' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'navigation.general' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'navigation.advanced' })).toBeInTheDocument()
    expect(screen.getByText('navigation.settings')).toBeInTheDocument()
  })

  it('opens on the General section by default (settings form, not advanced tools)', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('general-form')).toBeInTheDocument()
    expect(screen.queryByText('system-info')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'navigation.general' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens on the Advanced section when requested (system info + rebuild, not the form)', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} defaultTab="advanced" />)

    expect(screen.getByText('system-info')).toBeInTheDocument()
    expect(screen.getByText('rebuild-embeddings')).toBeInTheDocument()
    expect(screen.getByText('advanced.desc')).toBeInTheDocument()
    expect(screen.queryByText('general-form')).not.toBeInTheDocument()
  })

  it('switches the visible section when a rail item is clicked', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('general-form')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'navigation.advanced' }))

    expect(screen.getByText('system-info')).toBeInTheDocument()
    expect(screen.queryByText('general-form')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'navigation.advanced' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders nothing while closed', () => {
    render(<SettingsDialog open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByText('navigation.settings')).not.toBeInTheDocument()
    expect(screen.queryByText('general-form')).not.toBeInTheDocument()
  })
})
