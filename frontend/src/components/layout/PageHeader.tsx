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
    <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold leading-[1.2] text-foreground">{title}</h1>
        {description && (
          <p className="mt-2 text-base text-muted-foreground">{description}</p>
        )}
      </div>
      {(secondaryActions || primaryAction) && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  )
}
