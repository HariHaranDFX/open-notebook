import { render, screen, within, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ShareSheet } from './ShareSheet'
import { useAuth } from '@/lib/hooks/use-auth'
import {
  useUsers,
  useGroups,
  useGrants,
  useCreateGrant,
  useUpdateGrant,
  useDeleteGrant,
} from '@/lib/hooks/use-sharing'
import type { GrantResponse, GroupResponse, UserPickerItem } from '@/lib/api/sharing'
import type { AccessSummary } from '@/lib/types/api'

// Local dictionary with interpolation support: the global setup.ts mock
// returns raw keys and drops options, which hides the interpolated origin/
// revoke copy this suite needs to assert on.
const dict: Record<string, string> = {
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.saving': 'Saving…',
  'common.deleting': 'Deleting…',
  'common.notebook': 'Notebook',
  'common.source': 'Source',
  'sharing.title': 'Share',
  'sharing.description': 'Manage who can access this',
  'sharing.grants': 'People with access',
  'sharing.noGrants': 'Not shared yet',
  'sharing.add': 'Add',
  'sharing.user': 'User',
  'sharing.group': 'Group',
  'sharing.viewer': 'Viewer',
  'sharing.editor': 'Editor',
  'sharing.owner': 'Owner',
  'sharing.revoke': 'Revoke',
  'sharing.selectUser': 'Select user',
  'sharing.selectGroup': 'Select group',
  'sharing.principalType': 'Share with',
  'sharing.originOpen': 'Open access',
  'sharing.originDirect': 'Shared with you',
  'sharing.originGroup': 'Shared via {{name}}',
  'sharing.originNotebook': 'Access via {{name}}',
  'sharing.yourAccess': 'Your access',
  'sharing.roleLabel': 'Role',
  'sharing.revokeConfirmTitle': "{{resource}} — revoke {{principal}}'s access?",
  'sharing.revokeConfirmDescription':
    'This removes their direct {{role}} grant. They may still have access through a group, a linked notebook, or another grant.',
}

function t(key: string, options?: Record<string, unknown>) {
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

vi.mock('@/lib/hooks/use-auth', () => ({ useAuth: vi.fn() }))

vi.mock('@/lib/hooks/use-sharing', () => ({
  useUsers: vi.fn(),
  useGroups: vi.fn(),
  useGrants: vi.fn(),
  useCreateGrant: vi.fn(),
  useUpdateGrant: vi.fn(),
  useDeleteGrant: vi.fn(),
}))

// The real Select is a Radix popover (button + portal listbox) that jsdom
// can't drive with fireEvent.change. Swap in a native <select> so tests can
// pick an option without re-testing Radix itself (already covered where it's
// defined).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    children?: React.ReactNode
  }) => (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseUsers = vi.mocked(useUsers)
const mockUseGroups = vi.mocked(useGroups)
const mockUseGrants = vi.mocked(useGrants)
const mockUseCreateGrant = vi.mocked(useCreateGrant)
const mockUseUpdateGrant = vi.mocked(useUpdateGrant)
const mockUseDeleteGrant = vi.mocked(useDeleteGrant)

type UseAuthResult = ReturnType<typeof useAuth>
type UseUsersResult = ReturnType<typeof useUsers>
type UseGroupsResult = ReturnType<typeof useGroups>
type UseGrantsResult = ReturnType<typeof useGrants>
type UseCreateGrantResult = ReturnType<typeof useCreateGrant>
type UseUpdateGrantResult = ReturnType<typeof useUpdateGrant>
type UseDeleteGrantResult = ReturnType<typeof useDeleteGrant>

const asResult = <T,>(value: Partial<T>) => value as T

function mutationStub<TVars>(overrides: Partial<{
  mutate: ReturnType<typeof vi.fn>
  mutateAsync: ReturnType<typeof vi.fn>
  isPending: boolean
  isError: boolean
  error: unknown
  variables: TVars | undefined
}> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
    ...overrides,
  }
}

const userGrant: GrantResponse = {
  id: 'grant:user',
  resource_type: 'notebook',
  resource_id: 'notebook:research',
  principal_type: 'user',
  principal_id: 'user:bob',
  role: 'viewer',
  principal_label: 'Bob Bobson',
}

const groupGrant: GrantResponse = {
  id: 'grant:group',
  resource_type: 'notebook',
  resource_id: 'notebook:research',
  principal_type: 'group',
  principal_id: 'group:eng',
  role: 'editor',
  principal_label: 'Engineering',
}

const users: UserPickerItem[] = [
  { id: 'user:alice', email: 'alice@example.com', display_name: 'Alice Anderson' },
]

const groups: GroupResponse[] = [
  { id: 'group:eng', name: 'Engineering', source: 'local', member_count: 3 },
]

function renderSheet(
  props: Partial<Parameters<typeof ShareSheet>[0]> = {},
  accessSummary?: AccessSummary | null
) {
  return render(
    <ShareSheet
      resourceType="notebook"
      resourceId="notebook:research"
      open={true}
      onOpenChange={vi.fn()}
      canManage={true}
      accessSummary={accessSummary}
      {...props}
    />
  )
}

describe('ShareSheet', () => {
  let createGrant: UseCreateGrantResult
  let updateGrant: UseUpdateGrantResult
  let deleteGrant: UseDeleteGrantResult

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue(asResult<UseAuthResult>({ isAdmin: false }))
    mockUseUsers.mockReturnValue(asResult<UseUsersResult>({ data: users }))
    mockUseGroups.mockReturnValue(asResult<UseGroupsResult>({ data: [], isSuccess: false }))
    mockUseGrants.mockReturnValue(
      asResult<UseGrantsResult>({ data: [userGrant, groupGrant], isLoading: false })
    )
    createGrant = mutationStub()
    updateGrant = mutationStub()
    deleteGrant = mutationStub()
    mockUseCreateGrant.mockReturnValue(createGrant)
    mockUseUpdateGrant.mockReturnValue(updateGrant)
    mockUseDeleteGrant.mockReturnValue(deleteGrant)
  })

  it('renders nothing when the caller lacks manage permission', () => {
    const { container } = renderSheet({ canManage: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('omits the header close icon while keeping the footer dismissal action', () => {
    renderSheet()

    const sheet = screen.getByRole('dialog', { name: 'Share' })
    const header = sheet.querySelector('[data-slot="sheet-header"]')
    expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(header).toHaveClass('gap-0', 'py-3')
    expect(header).not.toHaveClass('gap-2', 'pr-14')
    expect(within(sheet).getByRole('button', { name: 'Done' })).toBeVisible()
  })

  it('shows the current access role and origin for inherited group access', () => {
    renderSheet({}, { role: 'editor', origin: 'group', origin_label: 'Engineering' })

    const access = screen.getByTestId('share-sheet-access')
    expect(within(access).getByText('Editor')).toBeInTheDocument()
    expect(within(access).getByText('Shared via Engineering')).toBeInTheDocument()
  })

  it('does not duplicate the role label for the owner effect', () => {
    renderSheet({}, { role: 'owner', origin: 'owner' })

    const access = screen.getByTestId('share-sheet-access')
    expect(within(access).getAllByText('Owner')).toHaveLength(1)
  })

  it('lists direct user and group grants with distinct type labels', () => {
    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    expect(within(userRow).getByText('Bob Bobson')).toBeInTheDocument()
    expect(within(userRow).getByText('User')).toBeInTheDocument()

    const groupRow = screen.getByTestId(`share-sheet-grant-${groupGrant.id}`)
    expect(within(groupRow).getByText('Engineering')).toBeInTheDocument()
    expect(within(groupRow).getByText('Group')).toBeInTheDocument()
  })

  it('shows the viewer/editor role on each grant row', () => {
    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    const groupRow = screen.getByTestId(`share-sheet-grant-${groupGrant.id}`)
    expect(within(userRow).getByRole('combobox')).toHaveValue('viewer')
    expect(within(groupRow).getByRole('combobox')).toHaveValue('editor')
  })

  it('adds a grant with the picked user and role', () => {
    renderSheet()

    const addSection = screen.getByTestId('share-sheet-add')
    const [principalSelect, roleSelect] = within(addSection).getAllByRole('combobox')
    fireEvent.change(principalSelect, { target: { value: 'user:alice' } })
    fireEvent.change(roleSelect, { target: { value: 'editor' } })
    fireEvent.click(within(addSection).getByRole('button', { name: 'Add' }))

    expect(createGrant.mutateAsync).toHaveBeenCalledWith({
      principal_type: 'user',
      principal_id: 'user:alice',
      role: 'editor',
    })
  })

  it('updates a grant role from its row', () => {
    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    fireEvent.change(within(userRow).getByRole('combobox'), { target: { value: 'editor' } })

    expect(updateGrant.mutate).toHaveBeenCalledWith({ grantId: userGrant.id, role: 'editor' })
  })

  it('shows a revoke confirmation naming the principal and resource, and that other access may remain', () => {
    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    fireEvent.click(within(userRow).getByRole('button', { name: 'Revoke' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText("Notebook — revoke Bob Bobson's access?")).toBeInTheDocument()
    expect(
      screen.getByText(
        'This removes their direct Viewer grant. They may still have access through a group, a linked notebook, or another grant.'
      )
    ).toBeInTheDocument()
  })

  it('revokes only after the confirmation is accepted', () => {
    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    fireEvent.click(within(userRow).getByRole('button', { name: 'Revoke' }))
    expect(deleteGrant.mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(deleteGrant.mutateAsync).toHaveBeenCalledWith(userGrant.id)
  })

  it('shows the admin-only group option when the caller is an admin', () => {
    mockUseAuth.mockReturnValue(asResult<UseAuthResult>({ isAdmin: true }))
    mockUseGroups.mockReturnValue(asResult<UseGroupsResult>({ data: groups, isSuccess: true }))

    renderSheet()

    const addSection = screen.getByTestId('share-sheet-add')
    const [principalTypeSelect, principalSelect] = within(addSection).getAllByRole('combobox')
    const principalRow = screen.getByTestId('share-sheet-principal-row')
    expect(within(addSection).getAllByRole('combobox')).toHaveLength(3)
    expect(principalTypeSelect.parentElement).toBe(principalRow)
    expect(principalSelect.parentElement).toBe(principalRow)
    expect(principalRow).toHaveClass('flex', 'gap-2')
    expect(within(addSection).getByRole('option', { name: 'Group' })).toBeInTheDocument()
  })

  it('shares with users only for a non-admin owner', () => {
    mockUseAuth.mockReturnValue(asResult<UseAuthResult>({ isAdmin: false }))

    renderSheet()

    const addSection = screen.getByTestId('share-sheet-add')
    expect(within(addSection).getAllByRole('combobox')).toHaveLength(2)
    expect(within(addSection).queryByRole('option', { name: 'Group' })).not.toBeInTheDocument()
  })

  it('disables Add and shows a pending state while a create is in flight', () => {
    mockUseCreateGrant.mockReturnValue(mutationStub({ isPending: true }))

    renderSheet()

    const addSection = screen.getByTestId('share-sheet-add')
    // The label stays "Add" (loading buttons keep their label context) - a
    // spinner communicates the pending state instead.
    const addButton = within(addSection).getByRole('button', { name: 'Add' })
    expect(addButton).toBeDisabled()
    expect(within(addButton).getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('shows an inline error next to the add controls when creating a grant fails', () => {
    mockUseCreateGrant.mockReturnValue(
      mutationStub({
        isError: true,
        error: {
          isAxiosError: true,
          message: 'Request failed with status code 422',
          response: { status: 422, data: { detail: 'Email domain not allowed' } },
        },
      })
    )

    renderSheet()

    const addSection = screen.getByTestId('share-sheet-add')
    const alert = within(addSection).getByRole('alert')
    expect(alert).toHaveTextContent('Email domain not allowed')
  })

  it('disables the role select on a row while its own update is pending', () => {
    mockUseUpdateGrant.mockReturnValue(
      mutationStub({ isPending: true, variables: { grantId: userGrant.id, role: 'editor' } })
    )

    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    const groupRow = screen.getByTestId(`share-sheet-grant-${groupGrant.id}`)
    expect(within(userRow).getByRole('combobox')).toBeDisabled()
    expect(within(groupRow).getByRole('combobox')).not.toBeDisabled()
  })

  it('shows an inline error on the row whose update failed', () => {
    mockUseUpdateGrant.mockReturnValue(
      mutationStub({
        isError: true,
        error: {
          isAxiosError: true,
          message: 'Request failed with status code 409',
          response: { status: 409, data: { detail: 'Role change rejected' } },
        },
        variables: { grantId: userGrant.id, role: 'editor' },
      })
    )

    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    expect(within(userRow).getByRole('alert')).toHaveTextContent('Role change rejected')
  })

  it('disables the confirm button and shows a pending state while revoking', () => {
    mockUseDeleteGrant.mockReturnValue(
      mutationStub({ isPending: true, variables: userGrant.id })
    )

    renderSheet()

    const userRow = screen.getByTestId(`share-sheet-grant-${userGrant.id}`)
    fireEvent.click(within(userRow).getByRole('button', { name: 'Revoke' }))

    // Radix hides the rest of the page from the accessibility tree while the
    // alert dialog is open, so this "Revoke" match is the confirm action -
    // the label stays put and a spinner marks the pending state.
    const confirmButton = screen.getByRole('button', { name: 'Revoke' })
    expect(confirmButton).toBeDisabled()
    expect(within(confirmButton).getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('places Cancel on the left and Done on the right of the footer', () => {
    const onOpenChange = vi.fn()

    renderSheet({ onOpenChange })

    const sheet = screen.getByRole('dialog', { name: 'Share' })
    const footer = sheet.querySelector('[data-slot="sheet-footer"]')
    expect(footer).toHaveClass('flex-row', 'justify-between')

    const cancelButton = within(footer as HTMLElement).getByRole('button', { name: 'Cancel' })
    const doneButton = within(footer as HTMLElement).getByRole('button', { name: 'Done' })
    expect(cancelButton.nextElementSibling).toBe(doneButton)

    fireEvent.click(cancelButton)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('blocks the Sheet from closing while a grant mutation is in flight', () => {
    mockUseCreateGrant.mockReturnValue(mutationStub({ isPending: true }))
    const onOpenChange = vi.fn()

    renderSheet({ onOpenChange })

    // The visible close control matches the guard: Done is disabled while
    // the create mutation is pending.
    const doneButton = screen.getByRole('button', { name: 'Done' })
    expect(doneButton).toBeDisabled()

    // Clicking a disabled button does not fire its handler, so onOpenChange
    // is never invoked with false while the mutation is pending.
    fireEvent.click(doneButton)
    expect(onOpenChange).not.toHaveBeenCalled()

    // Escape/overlay-click both route through the Sheet's onOpenChange prop
    // (Radix's Dialog.Root). Simulate that call directly to prove the wrapper
    // swallows a close request while pending, without depending on Radix's
    // jsdom event wiring for Escape.
    const dialog = screen.getByRole('dialog', { hidden: true })
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('allows the Sheet to close once no grant mutation is pending', () => {
    const onOpenChange = vi.fn()

    renderSheet({ onOpenChange })

    const doneButton = screen.getByRole('button', { name: 'Done' })
    expect(doneButton).not.toBeDisabled()

    fireEvent.click(doneButton)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
