import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getBrandConfig } = vi.hoisted(() => ({
  getBrandConfig: vi.fn(),
}))

vi.mock('./lib/brand-config', () => ({ getBrandConfig }))

describe('server instrumentation', () => {
  const originalRuntime = process.env.NEXT_RUNTIME

  beforeEach(() => {
    getBrandConfig.mockReset()
  })

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME
    else process.env.NEXT_RUNTIME = originalRuntime
    vi.restoreAllMocks()
  })

  it('validates and caches brand configuration at Node.js process startup', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const { register } = await import('./instrumentation')

    await register()

    expect(getBrandConfig).toHaveBeenCalledOnce()
  })

  it('terminates Node.js startup when brand configuration is invalid', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    getBrandConfig.mockImplementationOnce(() => {
      throw new Error('Invalid brand configuration')
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${code}`)
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { register } = await import('./instrumentation')

    await expect(register()).rejects.toThrow('process.exit:1')
    expect(exit).toHaveBeenCalledWith(1)
  })
})
