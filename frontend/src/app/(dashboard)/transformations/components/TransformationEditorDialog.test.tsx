import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { TransformationEditorDialog } from './TransformationEditorDialog'
import type { Transformation } from '@/lib/types/transformations'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('@/lib/hooks/use-transformations', () => ({
  TRANSFORMATION_QUERY_KEYS: {
    transformation: (id: string) => ['transformations', id],
  },
  useTransformation: () => ({ data: undefined, isLoading: false }),
  useCreateTransformation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTransformation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/components/ui/markdown-editor', () => ({
  MarkdownEditor: ({ textareaId }: { textareaId?: string }) => (
    <textarea id={textareaId} data-testid="markdown-editor" />
  ),
}))

const transformation: Transformation = {
  id: 'transformation:1',
  name: 'summarize',
  title: 'Summarize',
  description: 'Create a concise summary',
  prompt: 'Summarize the input.',
  apply_default: false,
  model_id: null,
  created: '2026-08-31T00:00:00Z',
  updated: '2026-08-31T00:00:00Z',
}

function renderEditor(currentTransformation?: Transformation) {
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <TransformationEditorDialog
        open
        onOpenChange={onOpenChange}
        transformation={currentTransformation}
      />
    </QueryClientProvider>
  )

  return onOpenChange
}

describe('TransformationEditorDialog', () => {
  it.each([
    {
      mode: 'create',
      currentTransformation: undefined,
      heading: 'transformations.createTransformation',
      description: 'transformations.createSheetDescription',
      action: 'transformations.createNew',
    },
    {
      mode: 'edit',
      currentTransformation: transformation,
      heading: 'common.editTransformation',
      description: 'transformations.editSheetDescription',
      action: 'common.editTransformation',
    },
  ])('uses divided header/footer chrome with one left-aligned Close action in $mode mode', ({
    currentTransformation,
    heading,
    description,
    action,
  }) => {
    const onOpenChange = renderEditor(currentTransformation)
    const dialog = screen.getByRole('dialog', { name: heading })
    const header = dialog.querySelector('[data-slot="sheet-header"]')
    const form = dialog.querySelector('form')
    const footer = dialog.querySelector<HTMLElement>('[data-slot="sheet-footer"]')

    expect(dialog.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(within(dialog).getByText(description)).toBeInTheDocument()
    expect(header).toHaveClass('gap-1', 'border-b', 'border-border', 'py-3')
    expect(form).toHaveClass('min-h-0', 'flex-1')
    expect(form).not.toHaveClass('h-full')
    expect(footer).toHaveClass(
      'flex-row',
      'justify-between',
      'sm:justify-between',
      'border-t',
      'border-border'
    )

    const closeButton = within(footer!).getByRole('button', { name: 'common.close' })
    const submitButton = within(footer!).getByRole('button', { name: action })
    expect(closeButton.nextElementSibling).toBe(submitButton)

    fireEvent.click(closeButton)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
