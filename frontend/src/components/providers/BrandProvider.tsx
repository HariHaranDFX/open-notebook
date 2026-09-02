'use client'

import { createContext, useContext } from 'react'

import type { BrandConfig } from '@/lib/types/brand'

const developmentBrand = Object.freeze({
  appName: 'Open Notebook',
  logoUrl: '/logo.svg',
  faviconUrl: '/logo.svg',
  actionLight: '#275E91',
  actionDark: '#74A9D6',
} satisfies BrandConfig)

const BrandContext = createContext<BrandConfig>(developmentBrand)

interface BrandProviderProps {
  brand: BrandConfig
  children: React.ReactNode
}

export function BrandProvider({ brand, children }: BrandProviderProps) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

export function useBrand(): BrandConfig {
  return useContext(BrandContext)
}
