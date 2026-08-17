import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('keeps library copy on one line and centers its actions responsively', () => {
    render(
      <PageHeader
        title="A deliberately long collection title"
        description="A deliberately long collection description"
        secondaryActions={<button type="button">Refresh</button>}
        primaryAction={<button type="button">Add source</button>}
      />,
    )

    const title = screen.getByRole('heading', { level: 1 })
    const description = screen.getByText('A deliberately long collection description')
    const actions = document.querySelector('[data-slot="page-header-actions"]')

    expect(title).toHaveClass('truncate')
    expect(title).toHaveAttribute('title', 'A deliberately long collection title')
    expect(description).toHaveClass('truncate', 'text-sm', 'leading-5')
    expect(description).toHaveAttribute(
      'title',
      'A deliberately long collection description',
    )
    expect(title.closest('header')).toHaveClass(
      'pb-3',
      'sm:grid-cols-[minmax(0,1fr)_auto]',
      'sm:items-center',
    )
    expect(actions).toHaveClass('items-center', 'sm:justify-end')
  })
})
