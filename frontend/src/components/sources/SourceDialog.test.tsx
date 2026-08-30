import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SourceDialog } from './SourceDialog'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('./SourceDetailContent', () => ({
  SourceDetailContent: () => <div>Source detail body</div>,
}))

describe('SourceDialog', () => {
  it('uses a sheet with a header, body, and footer actions', () => {
    render(
      <SourceDialog
        open
        onOpenChange={vi.fn()}
        sourceId="source:example"
      />
    )

    const sheet = screen.getByRole('dialog', { name: 'sources.detailsTitle' })
    expect(sheet.querySelector('[data-slot="sheet-header"]')).toBeInTheDocument()
    expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(sheet).toHaveClass('sm:max-w-3xl')
    expect(sheet).toHaveTextContent('Source detail body')
    const footer = sheet.querySelector<HTMLElement>('[data-slot="sheet-footer"]')
    expect(footer).toBeInTheDocument()
    expect(footer).not.toBeNull()
    expect(footer).toHaveClass('flex-row', 'justify-between', 'sm:justify-between')
    const closeButton = within(footer!).getByRole('button', { name: 'common.close' })
    const chatButton = screen.getByRole('button', { name: 'chat.chatWith' })
    expect(closeButton.nextElementSibling).toBe(chatButton)
  })
})
