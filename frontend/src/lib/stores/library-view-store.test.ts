import { beforeEach, describe, expect, it } from 'vitest'

import { useLibraryViewStore } from './library-view-store'

describe('library view preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    useLibraryViewStore.setState({
      notebooks: 'list',
      sources: 'list',
      hasHydrated: false,
    })
  })

  it('stores notebook and source view choices independently', () => {
    useLibraryViewStore.getState().setViewMode('notebooks', 'card')

    expect(useLibraryViewStore.getState().notebooks).toBe('card')
    expect(useLibraryViewStore.getState().sources).toBe('list')

    const persisted = JSON.parse(localStorage.getItem('library-view-storage') ?? '{}')
    expect(persisted.state).toMatchObject({ notebooks: 'card', sources: 'list' })
    expect(persisted.state).not.toHaveProperty('hasHydrated')
  })

  it('does not hydrate persisted preferences until explicitly requested', () => {
    expect(useLibraryViewStore.getState().hasHydrated).toBe(false)
    expect(useLibraryViewStore.persist.getOptions().skipHydration).toBe(true)
  })
})
