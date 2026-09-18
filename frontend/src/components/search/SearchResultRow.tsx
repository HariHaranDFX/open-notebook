'use client'

import { ChevronDown, FileText, StickyNote, Lightbulb } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import type { SearchResult } from '@/lib/types/search'
import type { PreviewResourceType } from '@/lib/hooks/use-resource-preview'

const TYPE_META: Record<PreviewResourceType, { Icon: typeof FileText; labelKey: string }> = {
  source: { Icon: FileText, labelKey: 'common.source' },
  note: { Icon: StickyNote, labelKey: 'common.note' },
  source_insight: { Icon: Lightbulb, labelKey: 'common.insight' },
}

const PREVIEW_TYPES: readonly string[] = ['source', 'note', 'source_insight']

/**
 * Parse a search result's own `id` (`<type>:<id>`) into a preview target.
 * Returns null for orphaned or unknown-type records so the row can be skipped.
 *
 * Uses `result.id` (not `parent_id`) so that a hit on a source insight opens
 * the insight preview itself, not the parent source. For source-body chunk
 * matches the two are the same shape, so this is a no-op.
 */
export function parseResultTarget(resultId: string | null | undefined): { type: PreviewResourceType; id: string } | null {
  if (!resultId) return null
  const idx = resultId.indexOf(':')
  if (idx <= 0) return null
  const type = resultId.slice(0, idx)
  const id = resultId.slice(idx + 1)
  if (!PREVIEW_TYPES.includes(type) || !id) return null
  return { type: type as PreviewResourceType, id }
}

// Kept for backwards compatibility during a soft migration; callers should
// switch to parseResultTarget so insight hits open the insight, not the source.
export const parseParentId = parseResultTarget

interface SearchResultRowProps {
  result: SearchResult
  onPreview: (type: PreviewResourceType, id: string) => void
  isActive?: boolean
}

export function SearchResultRow({ result, onPreview, isActive = false }: SearchResultRowProps) {
  const { t } = useTranslation()
  // Use result.id so an insight hit opens the insight (parent_id would open
  // the parent source instead — regression fixed upstream in #1345).
  const parsed = parseResultTarget(result.id)
  if (!parsed) return null

  const { Icon, labelKey } = TYPE_META[parsed.type]

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--surface-radius)] border transition-colors hover:border-primary hover:bg-accent',
        isActive ? 'border-primary bg-accent' : 'border-border'
      )}
    >
      {/* The whole main row is the click target that opens the preview. */}
      <button
        type="button"
        onClick={() => onPreview(parsed.type, parsed.id)}
        aria-current={isActive ? 'true' : undefined}
        className="flex w-full items-start justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-medium text-foreground">{result.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="gap-1">
            <Icon className="size-3" aria-hidden="true" />
            {t(labelKey)}
          </Badge>
          <Badge variant="secondary" className="tabular-nums">{result.final_score.toFixed(2)}</Badge>
        </span>
      </button>

      {result.matches && result.matches.length > 0 && (
        <Collapsible className="border-t border-border/60 px-3 pb-3 pt-2">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5" aria-hidden="true" />
            {t('searchPage.matches', { count: result.matches.length })}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 space-y-1">
            {result.matches.map((match, i) => (
              <p key={i} className="border-l-2 border-border pl-3 text-xs text-muted-foreground">{match}</p>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
