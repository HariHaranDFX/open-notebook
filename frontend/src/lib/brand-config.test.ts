import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  getBrandConfig,
  getReadableBrandForeground,
  resetBrandConfigCacheForTests,
} from './brand-config'

const defaultConfigPath = path.resolve(process.cwd(), '../config/brand.default.json')
const exampleConfigPath = path.resolve(process.cwd(), '../config/brand.example-client.json')

function writeConfig(value: unknown): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'open-notebook-brand-'))
  const configPath = path.join(directory, 'brand.json')
  writeFileSync(configPath, JSON.stringify(value), 'utf8')
  return configPath
}

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    appName: 'Atlas Research',
    logoUrl: '/brand/atlas.svg',
    actionLight: '#275E91',
    actionDark: '#74A9D6',
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.BRAND_CONFIG_PATH
  resetBrandConfigCacheForTests()
})

describe('getBrandConfig', () => {
  it('loads and freezes the repository default when BRAND_CONFIG_PATH is unset', () => {
    expect(getBrandConfig()).toEqual(JSON.parse(readFileSync(defaultConfigPath, 'utf8')))
    expect(Object.isFrozen(getBrandConfig())).toBe(true)
  })

  it('loads a valid absolute BRAND_CONFIG_PATH', () => {
    const configPath = writeConfig(validConfig({ supportUrl: 'https://support.example.com/help' }))
    process.env.BRAND_CONFIG_PATH = configPath

    expect(getBrandConfig()).toEqual(validConfig({ supportUrl: 'https://support.example.com/help' }))
  })

  it('loads two visibly different deployment fixtures through the same loader', () => {
    process.env.BRAND_CONFIG_PATH = defaultConfigPath
    const defaultBrand = getBrandConfig()
    resetBrandConfigCacheForTests()
    process.env.BRAND_CONFIG_PATH = exampleConfigPath
    const exampleBrand = getBrandConfig()

    expect(exampleBrand.appName).not.toBe(defaultBrand.appName)
    expect(exampleBrand.logoUrl).not.toBe(defaultBrand.logoUrl)
    expect(exampleBrand.actionLight).not.toBe(defaultBrand.actionLight)
    expect(exampleBrand.actionDark).not.toBe(defaultBrand.actionDark)
  })

  it.each([
    ['unknown properties', validConfig({ arbitraryCss: 'body { display: none }' })],
    ['missing required identity', { logoUrl: '/logo.svg', actionLight: '#275E91', actionDark: '#74A9D6' }],
    ['blank application name', validConfig({ appName: '   ' })],
    ['unsafe data URL', validConfig({ logoUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })],
    ['unsafe protocol-relative URL', validConfig({ logoUrl: '//cdn.example.com/logo.svg' })],
    ['root-relative path traversal', validConfig({ logoUrl: '/brand/../secret.svg' })],
    ['HTTPS path traversal', validConfig({ supportUrl: 'https://example.com/help/../admin' })],
    ['malformed color', validConfig({ actionLight: '#12345' })],
    ['inadequate contrast', validConfig({ actionLight: '#777777' })],
  ])('rejects %s', (_case, config) => {
    process.env.BRAND_CONFIG_PATH = writeConfig(config)
    expect(() => getBrandConfig()).toThrow(/brand configuration/i)
  })

  it('rejects malformed JSON without exposing its contents', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'open-notebook-brand-'))
    const configPath = path.join(directory, 'brand.json')
    const secretContents = '{"appName":"do-not-echo"'
    writeFileSync(configPath, secretContents, 'utf8')
    process.env.BRAND_CONFIG_PATH = configPath

    expect(() => getBrandConfig()).toThrow(/brand configuration/i)
    expect(() => getBrandConfig()).not.toThrow(secretContents)
  })

  it('rejects a relative BRAND_CONFIG_PATH', () => {
    process.env.BRAND_CONFIG_PATH = 'config/brand.json'
    expect(() => getBrandConfig()).toThrow(/absolute/i)
  })

  it('caches the validated config until the process cache is reset', () => {
    const configPath = writeConfig(validConfig())
    process.env.BRAND_CONFIG_PATH = configPath
    const first = getBrandConfig()
    writeFileSync(configPath, JSON.stringify(validConfig({ appName: 'Changed' })), 'utf8')

    expect(getBrandConfig()).toBe(first)
    expect(getBrandConfig().appName).toBe('Atlas Research')
  })
})

describe('getReadableBrandForeground', () => {
  it('chooses fixed readable foreground candidates for light and dark action colors', () => {
    expect(getReadableBrandForeground('#275E91')).toBe('#FFFFFF')
    expect(getReadableBrandForeground('#74A9D6')).toBe('#0C2130')
  })

  it('rejects a color that cannot reach 4.5:1 with either candidate', () => {
    expect(() => getReadableBrandForeground('#777777')).toThrow(/contrast/i)
  })
})
