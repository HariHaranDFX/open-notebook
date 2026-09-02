"use client"

import { FormSection } from "@/components/ui/form-section"
import { useTranslation } from "@/lib/hooks/use-translation"
import { CheckboxList } from "@/components/ui/checkbox-list"
import { NotebookResponse } from "@/lib/types/api"

interface NotebooksStepProps {
  notebooks: NotebookResponse[]
  selectedNotebooks: string[]
  onToggleNotebook: (notebookId: string) => void
  loading?: boolean
}

export function NotebooksStep({
  notebooks,
  selectedNotebooks,
  onToggleNotebook,
  loading = false
}: NotebooksStepProps) {
  const { t } = useTranslation()
  const notebookItems = notebooks.map((notebook) => ({
    id: notebook.id,
    title: notebook.name,
    description: notebook.description || undefined
  }))

  return (
    <div data-slot="notebooks-step" className="flex h-full min-h-0 flex-col">
      <FormSection
        title={`${t('notebooks.title')} (${t('common.optional')})`}
        description={t('sources.addExistingDesc')}
        className="flex min-h-0 flex-1 flex-col"
        contentClassName="flex min-h-0 flex-1 flex-col"
      >
        <CheckboxList
          items={notebookItems}
          selectedIds={selectedNotebooks}
          onToggle={onToggleNotebook}
          loading={loading}
          emptyMessage={t('sources.noNotebooksFound')}
          fill
        />
      </FormSection>
    </div>
  )
}
