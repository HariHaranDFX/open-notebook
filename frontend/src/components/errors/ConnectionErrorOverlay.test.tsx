import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BrandProvider } from '@/components/providers/BrandProvider'
import type { BrandConfig } from '@/lib/types/brand'
import { ConnectionErrorOverlay } from './ConnectionErrorOverlay'

const clientBrand: BrandConfig = {
  appName: 'Atlas Research',
  logoUrl: '/brand/atlas.svg',
  actionLight: '#275E91',
  actionDark: '#74A9D6',
  supportUrl: 'https://support.example.com/help',
}

describe('ConnectionErrorOverlay brand support', () => {
  it('uses the deployment support URL and identity when configured', () => {
    render(
      <BrandProvider brand={clientBrand}>
        <ConnectionErrorOverlay
          error={{ type: 'api-unreachable' }}
          onRetry={vi.fn()}
        />
      </BrandProvider>
    )

    expect(screen.getByRole('link', { name: /Atlas Research/i })).toHaveAttribute(
      'href',
      clientBrand.supportUrl
    )
  })

  it('keeps the upstream documentation fallback when support is unset', () => {
    render(
      <ConnectionErrorOverlay
        error={{ type: 'api-unreachable' }}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'connectionErrors.docLink' })).toHaveAttribute(
      'href',
      'https://github.com/lfnovo/open-notebook'
    )
  })
})
