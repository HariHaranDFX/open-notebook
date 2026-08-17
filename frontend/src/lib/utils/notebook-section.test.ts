import { describe, expect, it } from 'vitest'

import { getNotebookSection, getNotebookSectionHref } from './notebook-section'

describe('notebook section navigation', () => {
  it('builds encoded links to a notebook resource section', () => {
    expect(getNotebookSectionHref('notebook:research', 'sources')).toBe(
      '/notebooks/notebook%3Aresearch?section=sources',
    )
  })

  it('accepts only resource sections supported by the notebook workbench', () => {
    expect(getNotebookSection('notes')).toBe('notes')
    expect(getNotebookSection('chat')).toBeNull()
    expect(getNotebookSection(null)).toBeNull()
  })
})
