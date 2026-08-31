import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SourceDetailContent } from './SourceDetailContent'
import { sourcesApi } from '@/lib/api/sources'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { SourceDetailResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/api/insights', () => ({
  insightsApi: {
    listForSource: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/api/transformations', () => ({
  transformationsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/api/embedding', () => ({
  embeddingApi: {
    embedSource: vi.fn(),
  },
}))

vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ isAdmin: false }),
}))

vi.mock('@/components/sources/SourceInsightDialog', () => ({
  SourceInsightDialog: () => null,
}))

vi.mock('@/components/sources/NotebookAssociations', () => ({
  NotebookAssociations: () => null,
}))

const mockSourcesGet = vi.mocked(sourcesApi.get)

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

function renderContent(onClose?: () => void, showBackButton = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SourceDetailContent
        sourceId="source:missing"
        onClose={onClose}
        showBackButton={showBackButton}
      />
    </QueryClientProvider>
  )
}

describe('SourceDetailContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the shared not-found state when the source returns 404', async () => {
    mockSourcesGet.mockRejectedValue(notFoundError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.notFoundDescription')).toBeInTheDocument()
  })

  it('shows the shared load-error state for non-404 failures', async () => {
    mockSourcesGet.mockRejectedValue(networkError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.errorTitle')).toBeInTheDocument()
    expect(
      screen.queryByText('common.contentUnavailable.notFoundTitle')
    ).not.toBeInTheDocument()
  })

  it('shows the read-only forbidden state when the source returns 403', async () => {
    mockSourcesGet.mockRejectedValue(forbiddenError)

    renderContent()

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.forbiddenTitle')).toBeInTheDocument()
    expect(screen.getByText('common.contentUnavailable.forbiddenDescription')).toBeInTheDocument()
    expect(
      screen.queryByText('common.contentUnavailable.errorTitle')
    ).not.toBeInTheDocument()
  })

  it('shows the not-found state over stale cached data when a refetch returns 404', async () => {
    // Simulates the orphan-reference path: the source was viewed (cached),
    // then deleted; reopening it serves the retained cache while the
    // background refetch 404s. React Query keeps the previous data alongside
    // the error — the definitive 404 must still win over the stale render.
    mockSourcesGet.mockRejectedValue(notFoundError)

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const cachedSource: SourceDetailResponse = {
      id: 'source:stale',
      title: 'Deleted but cached',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'stale content',
    }
    // Mark the cached entry as stale (older than useSource's 30s staleTime)
    // so mounting triggers a refetch, which rejects with the 404 above.
    queryClient.setQueryData(QUERY_KEYS.source('source:stale'), cachedSource, {
      updatedAt: Date.now() - 60_000,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent sourceId="source:stale" />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText('common.contentUnavailable.notFoundTitle')).toBeInTheDocument()
    expect(screen.queryByText('Deleted but cached')).not.toBeInTheDocument()
  })

  it('invokes onClose from the not-found close button', async () => {
    mockSourcesGet.mockRejectedValue(notFoundError)
    const onClose = vi.fn()

    renderContent(onClose)

    await waitFor(() => {
      expect(screen.getByText('common.close')).toBeInTheDocument()
    })
    screen.getByText('common.close').click()
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps a viewer read-only while preserving source content', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:viewer',
      title: 'Grounded source',
      access_role: 'viewer',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent sourceId="source:viewer" />
      </QueryClientProvider>
    )

    expect(await screen.findByText('Grounded source')).toBeInTheDocument()
    const evidence = screen.getByText('Visible evidence')
    expect(evidence).toBeInTheDocument()
    expect(evidence.closest('[data-slot="card"]')?.querySelector('[data-slot="card-header"]')).toBeNull()
    expect(evidence.closest('[data-slot="card-content"]')).toHaveClass('pt-4')
    expect(screen.queryByText('sharing.share')).not.toBeInTheDocument()
    expect(screen.queryByText('sources.generateNewInsight')).not.toBeInTheDocument()
    expect(screen.queryByText('sources.manageNotebooks')).not.toBeInTheDocument()
  })

  it('keeps compact vertical spacing fixed around the source sheet tabs', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:spacing',
      title: 'Grounded source',
      access_role: 'viewer',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })

    renderContent()

    const title = await screen.findByText('Grounded source')
    const tabList = screen.getByRole('tablist')
    const activePanel = screen.getByRole('tabpanel')

    expect(title.closest('header')).toHaveClass('pt-3')
    expect(tabList.closest('[data-slot="tabs"]')).toHaveClass('pt-2')
    expect(tabList).toHaveClass('sticky', 'top-2')
    expect(activePanel).toHaveClass('mt-2')
  })

  it('omits the redundant heading and divider inside the Details tab', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:details-tab',
      title: 'Grounded source',
      access_role: 'viewer',
      asset: null,
      embedded: true,
      embedded_chunks: 1,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })

    renderContent()

    const detailsTab = await screen.findByRole('tab', { name: 'sources.details' })
    fireEvent.mouseDown(detailsTab, { button: 0, ctrlKey: false })
    const inspector = screen.getByText('sources.metadata').closest(
      '[data-slot="source-details-inspector"]',
    )

    expect(inspector).not.toBeNull()
    expect(within(inspector as HTMLElement).queryByRole('heading', {
      name: 'sources.details',
    })).not.toBeInTheDocument()
    expect(screen.getAllByText('sources.details')).toHaveLength(1)
    expect(screen.getByRole('tabpanel')).toHaveClass('pb-4')
  })

  it('keeps the source return action inside the source header', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:header',
      title: 'Grounded source',
      access_role: 'owner',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })
    const onClose = vi.fn()

    renderContent(onClose, true)

    const title = await screen.findByText('Grounded source')
    const backButton = screen.getByRole('button', {
      name: 'common.back',
    })
    const shareButton = screen.getByRole('button', { name: 'sharing.share' })
    const headerLayout = title.closest('[data-slot="detail-header-layout"]')

    expect(backButton.closest('header')).toContainElement(title)
    expect(backButton.parentElement).toBe(shareButton.parentElement)
    expect(backButton.nextElementSibling).toBe(shareButton)
    expect(backButton.className).toBe(shareButton.className)
    expect(headerLayout).toContainElement(screen.getByText(/sources\.id/))
    expect(headerLayout).toHaveClass(
      'grid',
      'lg:grid-cols-[minmax(0,1fr)_auto]',
      'lg:items-center',
    )
    backButton.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives the editable source title a clear edit affordance and styled input', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:editable-title',
      title: 'Grounded source',
      access_role: 'owner',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })

    renderContent()

    const editButton = await screen.findByRole('button', { name: 'Grounded source' })
    expect(editButton).toHaveClass(
      'rounded-[var(--control-radius)]',
      'border-transparent',
      'hover:border-border',
    )
    expect(editButton.querySelector('.lucide-pencil')).not.toBeInTheDocument()

    fireEvent.click(editButton)
    expect(screen.getByDisplayValue('Grounded source')).toHaveClass(
      'h-8',
      'rounded-[var(--control-radius)]',
      'border-border-strong',
      'bg-card',
      'text-base',
    )
    expect(screen.getByDisplayValue('Grounded source')).not.toHaveClass('h-9', 'text-lg')
  })

  it('uses an undivided workspace header with an outlined actions button', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:header',
      title: 'Grounded source',
      access_role: 'owner',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent
          sourceId="source:header"
          showBackButton
          renderWorkspace={({ content }) => content}
        />
      </QueryClientProvider>,
    )

    const title = await screen.findByText('Grounded source')
    const actionsButton = screen.getByRole('button', { name: 'common.actions' })
    const sourceDetail = title.closest('header')?.parentElement

    expect(title.closest('header')).not.toHaveClass('border-b')
    expect(sourceDetail).toHaveClass('min-h-0', 'min-w-0', 'flex-1', 'overflow-hidden')
    expect(actionsButton).toHaveClass('border-border-strong', 'bg-card')
  })

  it('uses one-pixel menu dividers and the shared destructive delete treatment', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:menu',
      title: 'Grounded source',
      access_role: 'owner',
      asset: { file_path: '/uploads/source.pdf' },
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })
    renderContent()

    const actionsButton = await screen.findByRole('button', { name: 'common.actions' })
    fireEvent.keyDown(actionsButton, { key: 'Enter' })

    const deleteItem = await screen.findByRole('menuitem', { name: 'sources.deleteSource' })
    const menu = deleteItem.closest('[data-slot="dropdown-menu-content"]')
    const dividers = menu?.querySelectorAll('[data-slot="dropdown-menu-separator"]') ?? []
    expect(deleteItem).toHaveAttribute('data-variant', 'destructive')
    expect(dividers).toHaveLength(2)
    for (const divider of dividers) {
      expect(divider).toHaveClass('h-0', 'border-t', 'border-border')
      expect(divider).not.toHaveClass('h-px', 'bg-border')
    }
  })

  it('opens workspace source details in a full-height right sheet', async () => {
    mockSourcesGet.mockResolvedValue({
      id: 'source:details',
      title: 'Grounded source',
      access_role: 'owner',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      full_text: 'Visible evidence',
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <SourceDetailContent
          sourceId="source:details"
          renderWorkspace={({ content }) => content}
        />
      </QueryClientProvider>,
    )

    const actionsButton = await screen.findByRole('button', { name: 'common.actions' })
    fireEvent.keyDown(actionsButton, { key: 'Enter' })
    const detailsAction = await screen.findByRole('menuitem', { name: 'sources.details' })
    fireEvent.click(detailsAction)

    const detailsSheet = await screen.findByRole('dialog', { name: 'sources.details' })
    expect(detailsSheet).toHaveClass(
      'inset-y-0',
      'right-0',
      'h-dvh',
      'data-[state=open]:slide-in-from-right',
    )
    expect(detailsSheet.querySelector('[data-slot="sheet-header"]')).toBeInTheDocument()
    expect(detailsSheet.querySelector('[data-slot="sheet-footer"]')).toBeInTheDocument()
    expect(detailsSheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(within(detailsSheet).getAllByText('sources.details')).toHaveLength(1)
    expect(within(detailsSheet).getByText('sources.notEmbedded')).toBeInTheDocument()
    expect(within(detailsSheet).getByText('Grounded source')).toBeInTheDocument()
    expect(detailsSheet.querySelector('[data-slot="sheet-header"]')).toHaveClass(
      'flex-row',
      'items-center',
      'justify-between',
      'py-4',
    )
    expect(detailsSheet.querySelector('[data-slot="sheet-footer"]')).toHaveClass(
      'sm:justify-start',
    )
  })
})
