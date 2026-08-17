import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ContextSelector } from './ContextSelector'

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common.contextModes.off': 'Excluded',
      'common.contextModes.insights': 'Insights only',
      'common.contextModes.full': 'Full source',
      'common.contextModes.included': 'Included',
      'common.contextModes.sourceLabel': 'Source context',
      'common.contextModes.noteLabel': 'Note context',
    })[key] ?? key,
  }),
}))

describe('ContextSelector', () => {
  it('uses a compact selector that fits a resized pane', () => {
    render(
      <ContextSelector
        value="off"
        kind="source"
        hasInsights
        onValueChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Source context' })).toBeVisible()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('removes insights-only when a source has no insights', () => {
    render(
      <ContextSelector
        value="full"
        kind="source"
        onValueChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Source context' }))
    expect(screen.queryByRole('option', { name: 'Insights only' })).not.toBeInTheDocument()
  })

  it('gives notes only Excluded and Included choices', () => {
    render(
      <ContextSelector
        value="full"
        kind="note"
        onValueChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Note context' }))
    expect(screen.getByRole('option', { name: 'Excluded' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'Included' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Full source' })).not.toBeInTheDocument()
  })

  it('opens without activating the parent row', () => {
    const onValueChange = vi.fn()
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <ContextSelector
          value="off"
          kind="source"
          hasInsights
          onValueChange={onValueChange}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Source context' }))
    expect(onRowClick).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('uses an announced compact select and honors disabled state', () => {
    render(
      <ContextSelector
        value="off"
        kind="note"
        onValueChange={vi.fn()}
        disabled
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Note context' })).toBeDisabled()
    expect(screen.getByText('Excluded')).toBeVisible()
  })
})
