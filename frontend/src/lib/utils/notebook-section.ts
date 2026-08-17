export type NotebookSection = 'sources' | 'notes'

export function getNotebookSection(value: string | null): NotebookSection | null {
  return value === 'sources' || value === 'notes' ? value : null
}

export function getNotebookSectionHref(notebookId: string, section: NotebookSection) {
  return `/notebooks/${encodeURIComponent(notebookId)}?section=${section}`
}
