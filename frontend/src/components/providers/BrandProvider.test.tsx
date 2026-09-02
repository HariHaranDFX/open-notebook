import { render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BrandLogo } from '@/components/common/BrandLogo'
import type { BrandConfig } from '@/lib/types/brand'
import { BrandProvider, useBrand } from './BrandProvider'

const atlasBrand: BrandConfig = {
  appName: 'Atlas Research',
  logoUrl: '/brand/atlas.svg',
  logoDarkUrl: '/brand/atlas-dark.svg',
  faviconUrl: '/brand/atlas.svg',
  actionLight: '#275E91',
  actionDark: '#74A9D6',
}

describe('BrandProvider', () => {
  it('returns the root-provided deployment brand', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <BrandProvider brand={atlasBrand}>{children}</BrandProvider>
    )

    expect(renderHook(() => useBrand(), { wrapper }).result.current).toEqual(atlasBrand)
  })

  it('uses the checked-in development brand for isolated components', () => {
    expect(renderHook(() => useBrand()).result.current).toMatchObject({
      appName: 'Open Notebook',
      logoUrl: '/logo.svg',
      actionLight: '#275E91',
      actionDark: '#74A9D6',
    })
  })

  it('renders one accessible logo with distinct light and dark assets', () => {
    render(
      <BrandProvider brand={atlasBrand}>
        <BrandLogo />
      </BrandProvider>
    )

    expect(screen.getByRole('img', { name: 'Atlas Research' })).toBeInTheDocument()
    expect(screen.getByTestId('brand-logo-light')).toHaveAttribute('src', '/brand/atlas.svg')
    expect(screen.getByTestId('brand-logo-dark')).toHaveAttribute('src', '/brand/atlas-dark.svg')
  })

  it('falls back to the light asset when no dark logo is configured', () => {
    render(
      <BrandProvider brand={{ ...atlasBrand, logoDarkUrl: undefined }}>
        <BrandLogo />
      </BrandProvider>
    )

    expect(screen.getByTestId('brand-logo-light')).toHaveAttribute('src', '/brand/atlas.svg')
    expect(screen.queryByTestId('brand-logo-dark')).not.toBeInTheDocument()
  })
})
