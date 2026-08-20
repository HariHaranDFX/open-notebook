import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  // Fills its container and centers so the guided empty state sits in the middle
  // of the surface. Degrades to content height when the parent has no set height.
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center px-6 py-12 text-center',
        className
      )}
    >
      <Icon className="mb-4 h-12 w-12 text-muted-foreground/60" />
      <h3 className="mb-2 text-lg font-medium text-foreground">{title}</h3>
      {description && <p className="mb-4 max-w-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}
