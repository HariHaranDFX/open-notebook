import { getBrandConfig } from './brand-config'

export function validateBrandAtStartup(): void {
  try {
    getBrandConfig()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid brand configuration')
    process.exit(1)
  }
}
