'use client'

import Image from 'next/image'

import { useBrand } from '@/components/providers/BrandProvider'
import { cn } from '@/lib/utils'

interface BrandLogoProps {
  size?: number
  className?: string
  priority?: boolean
}

export function BrandLogo({ size = 32, className, priority = false }: BrandLogoProps) {
  const { appName, logoUrl, logoDarkUrl } = useBrand()

  return (
    <span
      role="img"
      aria-label={appName}
      className={cn('relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <Image
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        priority={priority}
        unoptimized
        data-testid="brand-logo-light"
        className={cn('size-full object-contain', logoDarkUrl && 'dark:hidden')}
      />
      {logoDarkUrl && (
        <Image
          src={logoDarkUrl}
          alt=""
          width={size}
          height={size}
          priority={priority}
          unoptimized
          data-testid="brand-logo-dark"
          className="hidden size-full object-contain dark:block"
        />
      )}
    </span>
  )
}
