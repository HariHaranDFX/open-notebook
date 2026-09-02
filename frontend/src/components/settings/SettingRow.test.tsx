import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingRow } from './SettingRow'

describe('SettingRow', () => {
  it('stacks descriptive settings before their control on narrow screens', () => {
    render(
      <SettingRow label="Document Processing Engine" description="Enable an optional engine.">
        <button>Choose engine</button>
      </SettingRow>
    )

    const row = screen.getByText('Document Processing Engine').closest('[class*="border-t"]')
    const control = screen.getByRole('button', { name: 'Choose engine' }).parentElement

    expect(row).toHaveClass('flex-col', 'items-stretch', 'min-[480px]:flex-row', 'min-[480px]:items-center')
    expect(control).toHaveClass('w-full', 'min-[480px]:w-auto')
  })
})
