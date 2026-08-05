'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/use-auth'

/** Redirects non-admins away from admin-only pages. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.replace('/notebooks')
    }
  }, [isAdmin, isLoading, router])

  if (isLoading || !isAdmin) {
    return null
  }

  return <>{children}</>
}
