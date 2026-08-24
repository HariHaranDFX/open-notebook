import * as React from 'react'

import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  title: string
  description?: string
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode
  eyebrow?: string
  /** Extend the divider to the page frame's edges (full-width rule). */
  bleed?: boolean
}

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
  eyebrow,
  bleed = false,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'grid min-w-0 gap-3 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
        bleed && '-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8'
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1
          className="truncate text-2xl font-semibold leading-[1.2] text-foreground"
          title={title}
        >
          {title}
        </h1>
        {description && (
          <p
            className="mt-1 truncate text-sm leading-5 text-muted-foreground"
            title={description}
          >
            {description}
          </p>
        )}
      </div>
      {(secondaryActions || primaryAction) && (
        <div
          data-slot="page-header-actions"
          className="flex flex-wrap items-center gap-2 sm:justify-end"
        >
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  )
}
