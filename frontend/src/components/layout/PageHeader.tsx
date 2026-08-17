import * as React from 'react'

export interface PageHeaderProps {
  title: string
  description?: string
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode
  eyebrow?: string
}

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
  eyebrow,
}: PageHeaderProps) {
  return (
    <header className="grid min-w-0 gap-3 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
