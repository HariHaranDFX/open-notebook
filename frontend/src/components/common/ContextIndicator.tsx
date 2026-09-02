'use client'

import { FileText, Lightbulb, StickyNote } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

interface ContextIndicatorProps {
  sourcesInsights: number
  sourcesFull: number
  notesCount: number
  tokenCount?: number
  charCount?: number
  className?: string
}

// Helper function to format large numbers with K/M suffixes
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}

export function ContextIndicator({
  sourcesInsights,
  sourcesFull,
  notesCount,
  tokenCount,
  charCount,
  className
}: ContextIndicatorProps) {
  const { t } = useTranslation()
  const hasContext = (sourcesInsights + sourcesFull) > 0 || notesCount > 0

  if (!hasContext) {
    return (
      <div className={cn('flex-shrink-0 border-t px-3 py-2 text-xs text-muted-foreground', className)}>
        {t('common.contextSummary.empty')}
      </div>
    )
  }

  return (
    <div className={cn('workbench-context-summary flex flex-shrink-0 items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2', className)}>
      <div className="workbench-context-details flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('common.contextSummary.label')}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {sourcesInsights > 0 && (
            <Badge variant="outline" className="gap-1 border-provenance/50 px-1.5 py-0.5 text-xs text-provenance tabular-nums">
              <Lightbulb />
              <span>{sourcesInsights}</span>
              <span className="sr-only">{t('common.contextModes.insights')}</span>
            </Badge>
          )}

          {sourcesFull > 0 && (
            <Badge variant="outline" className="gap-1 border-primary/50 px-1.5 py-0.5 text-xs text-primary tabular-nums">
              <FileText />
              <span>{sourcesFull}</span>
              <span className="sr-only">{t('common.contextModes.full')}</span>
            </Badge>
          )}
        </div>

        {notesCount > 0 && (
          <>
            {(sourcesInsights > 0 || sourcesFull > 0) && (
              <span className="text-muted-foreground">•</span>
            )}
            <Badge variant="outline" className="gap-1 border-primary/50 px-1.5 py-0.5 text-xs text-primary tabular-nums">
              <StickyNote />
              <span>{notesCount}</span>
              <span className="sr-only">{t('common.contextModes.included')}</span>
            </Badge>
          </>
        )}
      </div>

      {(tokenCount !== undefined || charCount !== undefined) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {tokenCount !== undefined && tokenCount > 0 && (
            <span>{t('common.contextSummary.tokens', { value: formatNumber(tokenCount) })}</span>
          )}
          {tokenCount !== undefined && charCount !== undefined && tokenCount > 0 && charCount > 0 && (
            <span>/</span>
          )}
          {charCount !== undefined && charCount > 0 && (
            <span>{t('common.contextSummary.characters', { value: formatNumber(charCount) })}</span>
          )}
        </div>
      )}
    </div>
  )
}
