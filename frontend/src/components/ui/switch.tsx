'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

interface SwitchProps
  extends Omit<React.ComponentProps<'button'>, 'onChange' | 'value' | 'type'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/**
 * Minimal, dependency-free toggle (no @radix-ui/react-switch). A native button
 * with role="switch" gives keyboard + screen-reader support for free.
 */
function Switch({ checked = false, onCheckedChange, disabled, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-slot="switch"
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/35',
        className
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-[var(--motion-standard)]',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export { Switch }
