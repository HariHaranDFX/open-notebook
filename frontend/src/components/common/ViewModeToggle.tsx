import { LayoutGrid, List } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { LibraryViewMode } from '@/lib/stores/library-view-store'
import { cn } from '@/lib/utils'

interface ViewModeToggleProps {
  viewMode: LibraryViewMode
  onViewModeChange: (mode: LibraryViewMode) => void
  label: string
  listLabel: string
  cardLabel: string
}

export function ViewModeToggle({
  viewMode,
  onViewModeChange,
  label,
  listLabel,
  cardLabel,
}: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 items-center rounded-[var(--control-radius)] border border-border-strong bg-card p-px"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={listLabel}
            title={listLabel}
            aria-pressed={viewMode === 'list'}
            onClick={() => onViewModeChange('list')}
            className={cn('size-8', viewMode === 'list' && 'bg-secondary text-secondary-foreground')}
          >
            <List />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{listLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={cardLabel}
            title={cardLabel}
            aria-pressed={viewMode === 'card'}
            onClick={() => onViewModeChange('card')}
            className={cn('size-8', viewMode === 'card' && 'bg-secondary text-secondary-foreground')}
          >
            <LayoutGrid />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{cardLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}
