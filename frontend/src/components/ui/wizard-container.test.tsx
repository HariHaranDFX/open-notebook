import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WizardContainer } from './wizard-container'

describe('WizardContainer', () => {
  it('uses check icons for completed steps', () => {
    const { container } = render(
      <WizardContainer
        currentStep={3}
        steps={[
          { number: 1, title: 'Add source', description: 'Add content' },
          { number: 2, title: 'Notebooks', description: 'Choose notebooks' },
          { number: 3, title: 'Process', description: 'Choose processing' },
        ]}
      >
        Content
      </WizardContainer>,
    )

    expect(container.querySelectorAll('svg.lucide-check')).toHaveLength(2)
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('keeps the step indicator compact and the numbered markers consistent', () => {
    const { container } = render(
      <WizardContainer
        currentStep={1}
        steps={[
          { number: 1, title: 'Add source', description: 'Add content' },
          { number: 2, title: 'Notebooks', description: 'Choose notebooks' },
          { number: 3, title: 'Process', description: 'Choose processing' },
        ]}
      >
        Content
      </WizardContainer>,
    )

    expect(container.querySelector('[data-slot="wizard-steps"]')).toHaveClass('py-3')

    for (const number of ['1', '2', '3']) {
      expect(screen.getByText(number)).toHaveClass('size-7', 'shrink-0')
    }

    for (const description of ['Add content', 'Choose notebooks', 'Choose processing']) {
      expect(screen.getByText(description)).toHaveClass('truncate', 'hidden', 'sm:block')
    }
  })
})
