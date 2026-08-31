import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EpisodeProfileFormDialog } from './EpisodeProfileFormDialog'
import { SpeakerProfileFormDialog } from './SpeakerProfileFormDialog'

vi.mock('@/lib/hooks/use-podcasts', () => ({
  useCreateEpisodeProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEpisodeProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSpeakerProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSpeakerProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLanguages: () => ({ data: [] }),
}))

vi.mock('@/components/common/ModelSelector', () => ({
  ModelSelector: ({ label }: { label: string }) => <div>{label}</div>,
}))

function expectDividedProfileSheet(title: string) {
  const sheet = screen.getByRole('dialog', { name: title })
  const header = sheet.querySelector('[data-slot="sheet-header"]')
  const footer = sheet.querySelector('[data-slot="sheet-footer"]')
  const form = sheet.querySelector('form')
  const cancel = within(footer as HTMLElement).getByRole('button', { name: 'common.cancel' })

  expect(sheet).toHaveClass('flex', 'flex-col', 'gap-0', 'overflow-hidden', 'p-0')
  expect(sheet).not.toHaveClass('overflow-y-auto')
  expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
  expect(header).toHaveClass('border-b', 'border-border', 'px-6')
  expect(form).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
  expect(form?.querySelector('.overflow-y-auto')).toHaveClass('min-h-0', 'flex-1', 'p-6')
  expect(footer).toHaveClass(
    'flex-row',
    'justify-between',
    'border-t',
    'border-border',
    'px-6',
    'py-3',
  )
  expect(cancel).toBe(footer?.firstElementChild)
}

describe('podcast profile form sheets', () => {
  it('keeps the episode profile header and footer fixed edge to edge', () => {
    render(
      <EpisodeProfileFormDialog
        mode="create"
        open
        onOpenChange={vi.fn()}
        speakerProfiles={[]}
      />,
    )

    expectDividedProfileSheet('podcasts.createEpisodeProfile')
  })

  it('keeps the speaker profile header and footer fixed edge to edge', () => {
    render(
      <SpeakerProfileFormDialog
        mode="create"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expectDividedProfileSheet('podcasts.createSpeakerProfile')
  })
})
