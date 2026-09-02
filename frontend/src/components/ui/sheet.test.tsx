import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet'

describe('Sheet', () => {
  it('opens from the right and exposes an accessible title', () => {
    render(
      <Sheet open onOpenChange={vi.fn()}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Research tools</SheetTitle>
          </SheetHeader>
          <div>Panel content</div>
          <SheetFooter>Panel actions</SheetFooter>
        </SheetContent>
      </Sheet>
    )

    const sheet = screen.getByRole('dialog', { name: 'Research tools' })
    expect(sheet).toHaveClass('right-0', 'data-[state=open]:slide-in-from-right')
    expect(sheet).toHaveClass('inset-y-0', 'h-dvh')
    expect(sheet).not.toHaveClass('inset-y-3')
    expect(sheet).not.toHaveClass('left-0', 'data-[state=open]:slide-in-from-left')
    expect([...sheet.classList].some(className => className.startsWith('rounded'))).toBe(false)
    expect(sheet.querySelector('[data-slot="sheet-header"]')).toBeInTheDocument()
    expect(sheet.querySelector('[data-slot="sheet-footer"]')).toBeInTheDocument()
    expect(sheet.querySelector('.lucide-x')).toBeInTheDocument()
  })

  it('can omit the header close button when a sheet has a footer dismissal action', () => {
    render(
      <Sheet open onOpenChange={vi.fn()}>
        <SheetContent showCloseButton={false}>
          <SheetHeader>
            <SheetTitle>Share</SheetTitle>
          </SheetHeader>
          <SheetFooter>Done</SheetFooter>
        </SheetContent>
      </Sheet>
    )

    expect(screen.getByRole('dialog', { name: 'Share' }).querySelector('.lucide-x')).not.toBeInTheDocument()
  })
})
