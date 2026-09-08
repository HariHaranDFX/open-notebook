import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddSourceDialog } from './AddSourceDialog'

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useCreateSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: () => ({ data: undefined }),
}))

// SourceTypeStep (rendered inside AddSourceDialog) now consults useCapabilities
// via TanStack Query -- stub the hook so this test doesn't need a
// QueryClientProvider wrapper.
vi.mock('@/lib/hooks/use-capabilities', () => ({
  useCapabilities: () => ({ data: undefined, isLoading: false, isError: false }),
}))

describe('AddSourceDialog', () => {
  it('uses a compact full-height sheet layout with the actions pinned to the bottom', () => {
    render(<AddSourceDialog open onOpenChange={vi.fn()} />)

    const sheet = screen.getByRole('dialog', { name: 'sources.addNew' })
    expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    const header = sheet.querySelector('[data-slot="sheet-header"]')
    const footer = sheet.querySelector('[data-slot="sheet-footer"]')
    const form = sheet.querySelector('form')

    expect(screen.queryByRole('button', { name: 'common.done' })).not.toBeInTheDocument()
    expect(sheet).toHaveClass('flex', 'flex-col', 'overflow-hidden')
    expect(sheet).not.toHaveClass('overflow-y-auto')
    expect(header).toHaveClass('py-2.5')
    expect(header).not.toHaveClass('pr-14')
    expect(header).not.toHaveClass('pt-6')
    expect(form).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
    expect(footer).toHaveClass('py-2')
    expect(footer).not.toHaveClass('bg-muted')
  })
})
