'use client'

import { ArrowDown, ArrowUp, Search } from 'lucide-react'

import { ViewModeToggle } from '@/components/common/ViewModeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LibraryViewMode } from '@/lib/stores/library-view-store'

interface SortOption {
  value: string
  label: string
}

interface LibraryToolbarProps {
  id: string
  searchValue: string
  onSearchChange: (value: string) => void
  searchLabel: string
  searchPlaceholder: string
  sortValue: string
  onSortChange: (value: string) => void
  sortLabel: string
  sortOptions: SortOption[]
  sortDirection: 'asc' | 'desc'
  onSortDirectionChange: (direction: 'asc' | 'desc') => void
  sortDirectionLabel: string
  viewMode: LibraryViewMode
  onViewModeChange: (mode: LibraryViewMode) => void
  viewModeLabel: string
  listLabel: string
  cardLabel: string
}

export function LibraryToolbar({
  id,
  searchValue,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  sortValue,
  onSortChange,
  sortLabel,
  sortOptions,
  sortDirection,
  onSortDirectionChange,
  sortDirectionLabel,
  viewMode,
  onViewModeChange,
  viewModeLabel,
  listLabel,
  cardLabel,
}: LibraryToolbarProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
      <div className="min-w-0 flex-1 space-y-2 md:basis-96">
        <Label htmlFor={`${id}-search`}>{searchLabel}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${id}-search`}
            name={`${id}-search`}
            value={searchValue}
            onChange={event => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex w-full min-w-0 items-end gap-2 md:w-auto md:flex-none">
        <div className="min-w-0 flex-1 space-y-2 md:w-48 md:flex-none">
          <Label htmlFor={`${id}-sort`}>{sortLabel}</Label>
          <Select value={sortValue} onValueChange={onSortChange}>
            <SelectTrigger
              id={`${id}-sort`}
              className="w-full bg-card dark:bg-card dark:hover:bg-card"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
            aria-label={sortDirectionLabel}
            title={sortDirectionLabel}
          >
            {sortDirection === 'asc' ? <ArrowUp /> : <ArrowDown />}
          </Button>

          <ViewModeToggle
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            label={viewModeLabel}
            listLabel={listLabel}
            cardLabel={cardLabel}
          />
        </div>
      </div>
    </div>
  )
}
