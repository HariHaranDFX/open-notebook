'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LibraryId = 'notebooks' | 'sources'
export type LibraryViewMode = 'list' | 'card'

interface LibraryViewState {
  notebooks: LibraryViewMode
  sources: LibraryViewMode
  hasHydrated: boolean
  setViewMode: (library: LibraryId, mode: LibraryViewMode) => void
  setHasHydrated: (hasHydrated: boolean) => void
}

export const useLibraryViewStore = create<LibraryViewState>()(
  persist(
    (set) => ({
      notebooks: 'list',
      sources: 'list',
      hasHydrated: false,
      setViewMode: (library, mode) => set({ [library]: mode }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'library-view-storage',
      skipHydration: true,
      partialize: ({ notebooks, sources }) => ({ notebooks, sources }),
      onRehydrateStorage: () => state => state?.setHasHydrated(true),
    },
  ),
)

export function useLibraryView(library: LibraryId) {
  const viewMode = useLibraryViewStore(state => state[library])
  const hasHydrated = useLibraryViewStore(state => state.hasHydrated)
  const setStoredViewMode = useLibraryViewStore(state => state.setViewMode)

  useEffect(() => {
    if (!hasHydrated) void useLibraryViewStore.persist.rehydrate()
  }, [hasHydrated])

  return {
    viewMode: hasHydrated ? viewMode : 'list',
    setViewMode: (mode: LibraryViewMode) => setStoredViewMode(library, mode),
  }
}
