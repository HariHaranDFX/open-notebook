'use client'

import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AddSourceDialog } from './AddSourceDialog'

interface AddSourceButtonProps {
  defaultNotebookId?: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default' | 'lg'
  className?: string
  iconOnly?: boolean
}

export function AddSourceButton({ 
  defaultNotebookId, 
  variant = 'default',
  size = 'default',
  className,
  iconOnly = false
}: AddSourceButtonProps) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Button
        onClick={() => setDialogOpen(true)}
        variant={variant}
        size={size}
        className={className}
        aria-label={iconOnly ? t('sources.add') : undefined}
      >
        <PlusIcon className="h-4 w-4" />
        {!iconOnly && t('sources.add')}
      </Button>

      <AddSourceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultNotebookId={defaultNotebookId}
      />
    </>
  )
}
