import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SourceInsightDialog } from './SourceInsightDialog'
import { useInsight } from '@/lib/hooks/use-insights'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-insights', () => ({
  useInsight: vi.fn(),
}))

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: vi.fn() }),
}))

const mockUseInsight = vi.mocked(useInsight)

const notFoundError = Object.assign(new Error('Request failed with status code 404'), {
  isAxiosError: true,
  response: { status: 404 },
})

const networkError = Object.assign(new Error('Network Error'), {
  isAxiosError: true,
  response: undefined,
})

const forbiddenError = Object.assign(new Error('Request failed with status code 403'), {
  isAxiosError: true,
  response: { status: 403 },
})

type UseInsightResult = ReturnType<typeof useInsight>

const asResult = (value: Partial<UseInsightResult>) => value as UseInsightResult

describe('SourceInsightDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the shared not-found state when the insight returns 404', () => {
    mockUseInsight.mockReturnValue(
      asResult({ data: undefined, isLoading: false, isError: true, error: notFoundError })
    )

    render(
      <SourceInsightDialog
        open={true}
        onOpenChange={vi.fn()}
        insight={{ id: 'insight-1', insight_type: '', content: '' }}
      />
    )

    expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.notFoundDescription')).toBeInTheDocument()
    // No ghost fallback content and no "view source" affordance
    expect(screen.queryByText('sources.viewSource')).not.toBeInTheDocument()
  })

  it('shows the shared load-error state for non-404 failures', () => {
    mockUseInsight.mockReturnValue(
      asResult({ data: undefined, isLoading: false, isError: true, error: networkError })
    )

    render(
      <SourceInsightDialog
        open={true}
        onOpenChange={vi.fn()}
        insight={{ id: 'insight-1', insight_type: '', content: '' }}
      />
    )

    expect(screen.getByText('common.contentUnavailable.errorTitle')).toBeInTheDocument()
    expect(
      screen.queryByText('common.contentUnavailable.notFoundTitle')
    ).not.toBeInTheDocument()
  })

  it('shows the read-only forbidden state when the insight returns 403', () => {
    mockUseInsight.mockReturnValue(
      asResult({ data: undefined, isLoading: false, isError: true, error: forbiddenError })
    )

    render(
      <SourceInsightDialog
        open={true}
        onOpenChange={vi.fn()}
        insight={{ id: 'insight-1', insight_type: '', content: '' }}
      />
    )

    expect(screen.getByText('common.contentUnavailable.forbiddenTitle')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.forbiddenDescription')).toBeInTheDocument()
    expect(
      screen.queryByText('common.contentUnavailable.errorTitle')
    ).not.toBeInTheDocument()
  })

  it('closes the dialog from the not-found state close button', () => {
    mockUseInsight.mockReturnValue(
      asResult({ data: undefined, isLoading: false, isError: true, error: notFoundError })
    )
    const onOpenChange = vi.fn()

    render(
      <SourceInsightDialog
        open={true}
        onOpenChange={onOpenChange}
        insight={{ id: 'insight-1', insight_type: '', content: '' }}
      />
    )

    within(screen.getByTestId('content-unavailable')).getByText('common.close').click()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders the insight content when the fetch succeeds', () => {
    mockUseInsight.mockReturnValue(
      asResult({
        data: {
          id: 'insight-1',
          source_id: 'source:1',
          insight_type: 'summary',
          content: 'Fetched insight content',
          created: null,
          updated: null,
        },
        isLoading: false,
        isError: false,
        error: null,
      })
    )

    render(
      <SourceInsightDialog
        open={true}
        onOpenChange={vi.fn()}
        insight={{ id: 'insight-1', insight_type: '', content: '' }}
      />
    )

    expect(screen.getByText('Fetched insight content')).toBeInTheDocument()
    expect(screen.queryByTestId('content-unavailable')).not.toBeInTheDocument()
  })

  it('uses an edge-to-edge divided layout with a centered title, pill, and left Cancel action', () => {
    mockUseInsight.mockReturnValue(
      asResult({
        data: {
          id: 'insight-1',
          source_id: 'source:1',
          insight_type: 'summary',
          content: 'Fetched insight content',
          created: null,
          updated: null,
        },
        isLoading: false,
        isError: false,
        error: null,
      })
    )

    render(
      <SourceInsightDialog
        open={true}
        onOpenChange={vi.fn()}
        insight={{ id: 'insight-1', insight_type: '', content: '' }}
        onDelete={vi.fn()}
      />
    )

    const sheet = screen.getByRole('dialog', { name: 'sources.sourceInsight' })
    const header = sheet.querySelector('[data-slot="sheet-header"]')
    const headerRow = screen.getByTestId('source-insight-header-row')
    const footer = sheet.querySelector('[data-slot="sheet-footer"]')
    const cancel = within(footer as HTMLElement).getByRole('button', { name: 'common.cancel' })
    const deleteButton = within(footer as HTMLElement).getByRole('button', { name: 'common.delete' })

    expect(sheet).toHaveClass('gap-0', 'p-0')
    expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('sources.viewSource')).not.toBeInTheDocument()
    expect(header).toHaveClass('border-b', 'border-border')
    expect(headerRow).toHaveClass('items-center', 'justify-between')
    expect(within(headerRow).getByText('summary')).toBeVisible()
    expect(footer).toHaveClass('flex-row', 'justify-between', 'border-t', 'border-border', 'px-6')
    expect(cancel.nextElementSibling).toBe(deleteButton)
  })
})
