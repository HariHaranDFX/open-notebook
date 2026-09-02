export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { validateBrandAtStartup } = await import('./lib/brand-startup')
  validateBrandAtStartup()
}
