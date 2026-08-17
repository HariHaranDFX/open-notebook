'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { SourceWorkspace } from '@/components/sources/SourceWorkspace'
import { useNavigation } from '@/lib/hooks/use-navigation'

export default function SourceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const sourceId = params?.id ? decodeURIComponent(params.id as string) : ''
  const navigation = useNavigation()

  const handleBack = useCallback(() => {
    const returnPath = navigation.getReturnPath()
    router.push(returnPath)
    navigation.clearReturnTo()
  }, [navigation, router])

  return (
    <AppShell>
      <div data-testid="detail-workspace" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <SourceWorkspace sourceId={sourceId} onClose={handleBack} />
      </div>
    </AppShell>
  )
}
