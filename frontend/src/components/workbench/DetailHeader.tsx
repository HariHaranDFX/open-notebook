'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { cn } from '@/lib/utils'

export const MOBILE_DETAIL_ACTIONS_ID = 'mobile-detail-actions'

interface DetailHeaderProps {
  children: ReactNode
  className?: string
}

export function DetailHeader({
  children,
  className,
}: DetailHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-w-0 items-start gap-3 border-b border-border pb-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
    </header>
  )
}

interface DetailHeaderActionsProps {
  children: ReactNode
  className?: string
}

export function DetailHeaderActions({
  children,
  className,
}: DetailHeaderActionsProps) {
  const isDesktop = useIsDesktop()
  const [mobileTarget, setMobileTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setMobileTarget(document.getElementById(MOBILE_DETAIL_ACTIONS_ID))
  }, [])

  const actions = (
    <div
      data-slot="detail-header-actions"
      className={cn('flex shrink-0 flex-wrap items-center gap-1 sm:gap-2', className)}
    >
      {children}
    </div>
  )

  return !isDesktop && mobileTarget
    ? createPortal(actions, mobileTarget)
    : actions
}
