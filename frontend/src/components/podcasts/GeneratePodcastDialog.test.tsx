import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GeneratePodcastDialog } from './GeneratePodcastDialog'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const notebookName = 'A very long notebook title that must stay on one line inside the podcast sheet'

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { time?: string }) =>
      key === 'common.updated'
        ? `Updated ${options?.time ?? '{{time}}'}`
        : key,
    language: 'en-US',
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueries: ({ queries }: { queries: Array<{ enabled: boolean; queryKey: readonly unknown[] }> }) =>
      queries.map((query) => ({
        data: query.enabled
          ? query.queryKey[0] === 'sources'
            ? [{
                id: 'source:1',
                title: 'Source one',
                asset: null,
                embedded: false,
                embedded_chunks: 0,
                insights_count: 0,
                created: '2026-09-01T00:00:00Z',
                updated: '2026-09-01T00:00:00Z',
              }]
            : [{
                id: 'note:1',
                title: 'Note one',
                content: 'Note content',
                note_type: 'human',
                created: '2026-09-01T00:00:00Z',
                updated: '2026-09-01T00:00:00Z',
              }]
          : [],
        isFetching: false,
      })),
    useQueryClient: () => ({ prefetchQuery: vi.fn() }),
  }
})

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({
    data: [{
      id: 'notebook:1',
      name: notebookName,
      description: '',
      archived: false,
      created: '2026-09-01T00:00:00Z',
      updated: '2026-09-01T00:00:00Z',
      source_count: 1,
      note_count: 1,
    }],
    isLoading: false,
  }),
}))

vi.mock('@/lib/hooks/use-podcasts', () => ({
  useEpisodeProfiles: () => ({ episodeProfiles: [], isLoading: false }),
  useGeneratePodcast: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/api/chat', () => ({
  chatApi: {
    buildContext: vi.fn(async () => ({ context: {}, token_count: 0, char_count: 0 })),
  },
}))

describe('GeneratePodcastDialog layout', () => {
  it('uses compact sheet chrome and keeps the notebook list full width without wrapping titles', () => {
    render(<GeneratePodcastDialog open onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'podcasts.generateEpisode' })
    const header = dialog.querySelector('[data-slot="sheet-header"]')
    const footer = dialog.querySelector<HTMLElement>('[data-slot="sheet-footer"]')
    const title = screen.getByText(notebookName)
    const notebookTrigger = title.closest('button')
    const notebookRow = notebookTrigger?.parentElement

    expect(dialog.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(header).toHaveClass('gap-1', 'py-3')
    expect(footer).toHaveClass('flex-row', 'justify-between', 'sm:justify-between')
    expect(within(footer!).getByRole('button', { name: 'common.cancel' })).toBe(
      footer?.firstElementChild,
    )

    expect(title).toHaveClass('truncate')
    expect(title.parentElement).toHaveClass('min-w-0', 'flex-1')
    expect(notebookTrigger).toHaveClass('min-w-0', 'w-full', 'gap-2')
    expect(notebookRow).toHaveClass('w-full', 'items-center', 'py-3')
  })

  it('stretches the notebook list to the available sheet height', () => {
    render(<GeneratePodcastDialog open onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'podcasts.generateEpisode' })
    const header = dialog.querySelector('[data-slot="sheet-header"]')
    const body = header?.nextElementSibling
    const contentPanel = body?.firstElementChild
    const scrollArea = dialog.querySelector('[data-slot="scroll-area"]')
    const listFrame = scrollArea?.parentElement

    expect(body).toHaveClass('md:overflow-hidden')
    expect(contentPanel).toHaveClass('min-h-0', 'md:h-full')
    expect(listFrame).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
    expect(scrollArea).toHaveClass('flex-1', 'md:min-h-0')
    expect(scrollArea).not.toHaveClass('h-[60vh]')
  })

  it('loads expanded notebook content without selecting it', async () => {
    render(<GeneratePodcastDialog open onOpenChange={vi.fn()} />)

    const notebookTrigger = screen.getByText(notebookName).closest('button')
    fireEvent.click(notebookTrigger!)

    expect(await screen.findByText('Source one')).toBeVisible()
    expect(screen.getByText('Note one')).toBeVisible()
    expect(screen.queryByText(/\{\{time\}\}/)).not.toBeInTheDocument()

    const sourcesHeading = screen.getByRole('heading', { name: 'podcasts.sources' })
    expect(sourcesHeading.parentElement?.parentElement?.previousElementSibling).toHaveAttribute(
      'data-slot',
      'separator',
    )

    await waitFor(() => {
      for (const checkbox of screen.getAllByRole('checkbox')) {
        expect(checkbox).toHaveAttribute('data-state', 'unchecked')
      }
    })
  })

  it('selects loaded content after the notebook checkbox is explicitly selected', async () => {
    render(<GeneratePodcastDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'checked')
    })
  })
})
