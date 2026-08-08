import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import type { BrandConfig } from './types/brand'

const LIGHT_FOREGROUND = '#FFFFFF'
const DARK_FOREGROUND = '#0C2130'
const MINIMUM_CONTRAST = 4.5

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a six-digit hex color')

function isSafeBrandUrl(value: string): boolean {
  if (value.includes('\\')) return false

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }

  const pathname = decoded.split(/[?#]/, 1)[0]
  if (pathname.split('/').includes('..')) return false
  if (value.startsWith('/')) return !value.startsWith('//')

  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const safeBrandUrl = z.string().refine(isSafeBrandUrl, {
  message: 'must be a root-relative path or HTTPS URL without path traversal',
})

const brandSchema = z.object({
  appName: z.string().trim().min(1),
  logoUrl: safeBrandUrl,
  logoDarkUrl: safeBrandUrl.optional(),
  faviconUrl: safeBrandUrl.optional(),
  actionLight: hexColor,
  actionDark: hexColor,
  supportUrl: safeBrandUrl.optional(),
}).strict().superRefine((brand, context) => {
  for (const field of ['actionLight', 'actionDark'] as const) {
    try {
      getReadableBrandForeground(brand[field])
    } catch {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'must reach 4.5:1 contrast with an approved foreground',
      })
    }
  }
})

let cachedBrandConfig: BrandConfig | undefined

function relativeLuminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)!.map(channel => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

export function getReadableBrandForeground(actionColor: string): '#FFFFFF' | '#0C2130' {
  if (!/^#[0-9A-Fa-f]{6}$/.test(actionColor)) {
    throw new Error('Brand action color must be a six-digit hex value')
  }

  const candidates = [LIGHT_FOREGROUND, DARK_FOREGROUND] as const
  const foreground = candidates
    .map(color => ({ color, contrast: contrastRatio(actionColor, color) }))
    .sort((left, right) => right.contrast - left.contrast)[0]

  if (foreground.contrast < MINIMUM_CONTRAST) {
    throw new Error('Brand action color does not meet 4.5:1 contrast')
  }

  return foreground.color
}

export function getBrandConfig(): BrandConfig {
  if (cachedBrandConfig) return cachedBrandConfig

  const configuredPath = process.env.BRAND_CONFIG_PATH
  if (configuredPath && !path.isAbsolute(configuredPath)) {
    throw new Error('BRAND_CONFIG_PATH must be an absolute path')
  }

  const configPath = configuredPath ?? path.resolve(process.cwd(), '../config/brand.default.json')

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    cachedBrandConfig = Object.freeze(brandSchema.parse(parsed)) as BrandConfig
    return cachedBrandConfig
  } catch (error) {
    const detail = error instanceof z.ZodError
      ? error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ')
      : error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Invalid brand configuration at ${configPath}: ${detail}`)
  }
}

export function resetBrandConfigCacheForTests(): void {
  cachedBrandConfig = undefined
}
