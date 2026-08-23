'use client'

import { AppShell } from '@/components/layout/AppShell'
import { AdminOnly } from '@/components/auth/AdminOnly'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AdminOnly>{children}</AdminOnly>
    </AppShell>
  )
}
