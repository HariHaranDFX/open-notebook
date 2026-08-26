"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

interface CheckboxListItem {
  id: string
  title: string
  description?: string
}

interface CheckboxListProps {
  items: CheckboxListItem[]
  selectedIds: string[]
  onToggle: (id: string) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
  fill?: boolean
}

export function CheckboxList({
  items,
  selectedIds,
  onToggle,
  loading = false,
  emptyMessage = "No items found.",
  className,
  fill = false
}: CheckboxListProps) {
  const containerClassName = cn(
    'rounded-[var(--surface-radius)] border border-border bg-card',
    fill && 'flex min-h-0 flex-1 flex-col',
    className
  )

  if (loading) {
    return (
      <div data-slot="checkbox-list" className={cn(containerClassName, 'p-4')}>
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-4 h-4 bg-muted rounded" />
              <div className="flex-1">
                <div className="h-4 bg-muted rounded w-3/4 mb-1" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div data-slot="checkbox-list" className={cn(containerClassName, 'p-4')}>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div data-slot="checkbox-list" className={containerClassName}>
      <div
        data-slot="checkbox-list-content"
        className={cn("overflow-y-auto p-4", fill ? "max-h-none min-h-0 flex-1" : "max-h-48")}
      >
        <div className="space-y-3">
          {items.map((item) => (
            <label
              key={item.id}
              htmlFor={`checkbox-${item.id}`}
              className="flex items-start gap-3 cursor-pointer hover:bg-muted p-2 rounded-md -m-2 transition-colors"
            >
              <Checkbox
                id={`checkbox-${item.id}`}
                name={`checkbox-${item.id}`}
                checked={selectedIds.includes(item.id)}
                onCheckedChange={() => onToggle(item.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium block">
                  {item.title}
                </span>
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {item.description}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
