'use client'

import { AppShell } from '@/components/layout/AppShell'
import { AdminOnly } from '@/components/auth/AdminOnly'
import { AdminNav } from '@/components/settings/AdminNav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AdminOnly>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <AdminNav />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
      </AdminOnly>
    </AppShell>
  )
}
