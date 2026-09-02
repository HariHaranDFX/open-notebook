import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DiscoverModelsDialog } from './DiscoverModelsDialog'
import type { Credential } from '@/lib/api/credentials'

vi.mock('@/lib/hooks/use-credentials', () => ({
  useDiscoverModels: () => ({
    mutate: vi.fn((_: string, options: { onSuccess: (result: unknown) => void }) => {
      options.onSuccess({
        discovered: [{ name: 'gpt-4o', provider: 'openai' }],
      })
    }),
    isPending: false,
  }),
  useRegisterModels: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/hooks/use-providers', () => ({
  useProviders: () => ({
    data: [{ name: 'openai', display_name: 'OpenAI', modalities: ['language'] }],
  }),
}))

const credential: Credential = {
  id: 'credential:1',
  name: 'Production',
  provider: 'openai',
  modalities: ['language'],
  has_api_key: true,
  created: '2026-08-31T00:00:00Z',
  updated: '2026-08-31T00:00:00Z',
  model_count: 0,
}

describe('DiscoverModelsDialog', () => {
  it('uses compact divided sheet chrome with a left-aligned Close action', () => {
    const onOpenChange = vi.fn()

    render(
      <DiscoverModelsDialog
        open
        onOpenChange={onOpenChange}
        credential={credential}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'models.discoverModels - OpenAI' })
    const header = dialog.querySelector('[data-slot="sheet-header"]')
    const footer = dialog.querySelector<HTMLElement>('[data-slot="sheet-footer"]')

    expect(dialog.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(header).toHaveClass('gap-1', 'border-b', 'border-border', 'py-3')
    expect(footer).toHaveClass(
      'flex-row',
      'justify-between',
      'sm:justify-between',
      'border-t',
      'border-border'
    )

    const closeButton = within(footer!).getByRole('button', { name: 'common.close' })
    const addButton = within(footer!).getByRole('button', { name: 'common.add (0)' })
    expect(closeButton.nextElementSibling).toBe(addButton)

    fireEvent.click(closeButton)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the controls fixed and scrolls only the model list', () => {
    render(
      <DiscoverModelsDialog
        open
        onOpenChange={vi.fn()}
        credential={credential}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'models.discoverModels - OpenAI' })
    const header = dialog.querySelector('[data-slot="sheet-header"]')
    const content = header?.nextElementSibling
    const modelList = screen.getByText('gpt-4o').closest('label')?.parentElement

    expect(content).toHaveClass('overflow-hidden')
    expect(content).not.toHaveClass('overflow-y-auto')
    expect(modelList).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  })
})
