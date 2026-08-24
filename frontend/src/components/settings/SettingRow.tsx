'use client'

import * as React from 'react'
import { HelpCircle } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

/** A titled group of setting rows. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="text-[15px] font-medium text-foreground">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** An on-demand help affordance: a small "?" that opens a popover with guidance. */
export function SettingHelp({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('settings.helpMeChoose')}
          className="inline-flex shrink-0 items-center text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-[13px] leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  )
}

/**
 * One setting: label (with optional "?" help) and description on the left, the
 * control on the right, hairline between rows. Shared by every settings surface.
 */
export function SettingRow({
  label,
  htmlFor,
  description,
  help,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  description?: React.ReactNode
  help?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-t border-border/40 py-3.5',
        className
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
          {help && <SettingHelp>{help}</SettingHelp>}
        </div>
        {description && (
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
