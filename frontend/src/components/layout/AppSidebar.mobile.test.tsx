import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/hooks/use-settings-dialog')
vi.mock('@/lib/hooks/use-media-query', () => ({
  useMediaQuery: () => true,
}))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => <button role="menuitem" onClick={onSelect}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/app/(dashboard)/settings/components/SettingsForm', () => ({
  SettingsForm: () => <div>general-form</div>,
}))
vi.mock('@/components/settings', () => ({
  SystemInfo: () => <div>system-info</div>,
  RebuildEmbeddings: () => <div>rebuild-embeddings</div>,
}))

import { SettingsDialogProvider } from '@/lib/hooks/use-settings-dialog'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'

function OpenMobileSidebar() {
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(true)
  }, [setOpenMobile])

  return <AppSidebar />
}

describe('AppSidebar mobile overlays', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  it('closes mobile navigation before opening Settings on the next frame', async () => {
    let openSettingsFrame: FrameRequestCallback | undefined
    vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
      openSettingsFrame = callback
      return 1
    })

    render(
      <SettingsDialogProvider>
        <SidebarProvider>
          <OpenMobileSidebar />
        </SidebarProvider>
      </SettingsDialogProvider>
    )

    fireEvent.click(await screen.findByRole('menuitem', { name: 'navigation.settings' }))

    expect(screen.queryByText('general-form')).not.toBeInTheDocument()
    expect(openSettingsFrame).toBeTypeOf('function')

    act(() => openSettingsFrame?.(0))

    expect(await screen.findByText('general-form')).toBeInTheDocument()
  })
})
