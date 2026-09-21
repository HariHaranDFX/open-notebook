import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InviteFromDirectoryDialog } from './InviteFromDirectoryDialog'
import {
  useDirectoryUserSearch,
  useStubEntraUser,
} from '@/lib/hooks/use-sharing'
import type {
  DirectoryUserCandidate,
  UserPickerItem,
} from '@/lib/api/sharing'

const dict: Record<string, string> = {
  'common.cancel': 'Cancel',
  'common.saving': 'Saving…',
  'sharing.inviteFromDirectory': 'Invite from directory',
  'sharing.inviteFromDirectoryDescription':
    "Find a colleague in your organization who hasn't signed in yet.",
  'sharing.searchDirectory': 'Search directory',
  'sharing.searchDirectoryPlaceholder': 'Type a name or email…',
  'sharing.noDirectoryResults': 'No matches in the directory',
  'sharing.showingTopResults': 'Showing top {{count}} — type to filter',
}

function t(key: string, options?: Record<string, unknown>): string {
  let str = dict[key] ?? key
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      str = str.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return str
}

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({ t, language: 'en-US' }),
}))

vi.mock('@/lib/hooks/use-sharing', () => ({
  useDirectoryUserSearch: vi.fn(),
  useStubEntraUser: vi.fn(),
}))

const mockUseDirectoryUserSearch = vi.mocked(useDirectoryUserSearch)
const mockUseStubEntraUser = vi.mocked(useStubEntraUser)

const asResult = <T,>(value: Partial<T>) => value as T

const candidates: DirectoryUserCandidate[] = [
  { entra_oid: 'oid-1', email: 'alice@x', display_name: 'Alice' },
  { entra_oid: 'oid-2', email: 'bob@x', display_name: 'Bob' },
]

describe('InviteFromDirectoryDialog', () => {
  let mutateAsync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: empty query → returns nothing (matches hook's `enabled: q > 0`)
    mockUseDirectoryUserSearch.mockReturnValue(
      asResult<ReturnType<typeof useDirectoryUserSearch>>({
        data: undefined,
        isFetching: false,
      })
    )
    mutateAsync = vi.fn().mockResolvedValue({
      id: 'user:new',
      email: 'alice@x',
      display_name: 'Alice',
      pending: true,
    } satisfies UserPickerItem)
    // TanStack's UseMutationResult is a discriminated union whose Partial
    // cannot be satisfied structurally, so cast through unknown at the seam
    // — matches the pattern in ShareSheet.test.tsx.
    mockUseStubEntraUser.mockReturnValue(
      {
        mutate: vi.fn(),
        mutateAsync,
        isPending: false,
        isError: false,
        error: null,
        variables: undefined,
      } as unknown as ReturnType<typeof useStubEntraUser>
    )
  })

  it('renders the input placeholder while the dialog is open', () => {
    render(
      <InviteFromDirectoryDialog open={true} onOpenChange={vi.fn()} />
    )
    expect(
      screen.getByPlaceholderText('Type a name or email…')
    ).toBeInTheDocument()
  })

  it('shows the browse-mode hint when the input is empty but Graph returned rows', () => {
    // Empty query + non-empty results = "browse mode" (WBS 4.21 top-25 fetch).
    mockUseDirectoryUserSearch.mockReturnValue(
      asResult<ReturnType<typeof useDirectoryUserSearch>>({
        data: candidates,
        isFetching: false,
      })
    )
    render(
      <InviteFromDirectoryDialog open={true} onOpenChange={vi.fn()} />
    )
    expect(screen.getByTestId('directory-browse-hint')).toHaveTextContent(
      /Showing top 2 — type to filter/
    )
  })

  it('shows directory results and disables submit until one is picked', async () => {
    mockUseDirectoryUserSearch.mockReturnValue(
      asResult<ReturnType<typeof useDirectoryUserSearch>>({
        data: candidates,
        isFetching: false,
      })
    )
    const onOpenChange = vi.fn()
    const onInvited = vi.fn()
    render(
      <InviteFromDirectoryDialog
        open={true}
        onOpenChange={onOpenChange}
        onInvited={onInvited}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Type a name or email…'), {
      target: { value: 'al' },
    })

    // Submit button is disabled until we pick a radio.
    const submit = screen.getByRole('button', { name: 'Invite from directory' })
    expect(submit).toBeDisabled()

    // Debounce (300ms) delays results appearing; wait for the radio to exist.
    const alice = await waitFor(() =>
      screen.getByRole('radio', { name: /Alice/ })
    )
    fireEvent.click(alice)
    expect(submit).not.toBeDisabled()

    fireEvent.click(submit)
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ entra_oid: 'oid-1' })
    )
    expect(onInvited).toHaveBeenCalledWith('user:new')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('surfaces the empty-results message when Graph returned no matches', () => {
    mockUseDirectoryUserSearch.mockReturnValue(
      asResult<ReturnType<typeof useDirectoryUserSearch>>({
        data: [],
        isFetching: false,
      })
    )
    render(
      <InviteFromDirectoryDialog open={true} onOpenChange={vi.fn()} />
    )
    fireEvent.change(screen.getByPlaceholderText('Type a name or email…'), {
      target: { value: 'nobody' },
    })
    // The dialog debounces input, so wait one tick.
    return waitFor(() =>
      expect(
        screen.getByText('No matches in the directory')
      ).toBeInTheDocument()
    )
  })
})
