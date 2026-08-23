import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { SettingsDialog } from './SettingsDialog'

// useTranslation is mocked globally in setup.ts (t returns the key string).
// Stub the heavy tab bodies — this test only covers the modal's tab structure.
vi.mock('@/app/(dashboard)/settings/components/SettingsForm', () => ({
  SettingsForm: () => <div>general-form</div>,
}))
vi.mock('@/components/settings', () => ({
  SystemInfo: () => <div>system-info</div>,
  RebuildEmbeddings: () => <div>rebuild-embeddings</div>,
}))

describe('SettingsDialog', () => {
  it('shows General and Advanced as tabs under a labeled tablist', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    const tablist = screen.getByRole('tablist', { name: 'common.accessibility.settingsNav' })
    expect(tablist).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'navigation.general' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'navigation.advanced' })).toBeInTheDocument()
    expect(screen.getByText('navigation.settings')).toBeInTheDocument()
  })

  it('opens on the General tab by default (settings form, not advanced tools)', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('general-form')).toBeInTheDocument()
    expect(screen.queryByText('system-info')).not.toBeInTheDocument()
  })

  it('opens on the Advanced tab when requested (system info + rebuild, not the form)', () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} defaultTab="advanced" />)

    expect(screen.getByText('system-info')).toBeInTheDocument()
    expect(screen.getByText('rebuild-embeddings')).toBeInTheDocument()
    expect(screen.getByText('advanced.desc')).toBeInTheDocument()
    expect(screen.queryByText('general-form')).not.toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    render(<SettingsDialog open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByText('navigation.settings')).not.toBeInTheDocument()
    expect(screen.queryByText('general-form')).not.toBeInTheDocument()
  })
})
