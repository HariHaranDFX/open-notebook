import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GroupsPage from './page'
import {
  useGroups,
  useUsers,
  useCreateGroup,
  useDeleteGroup,
  useGroupMembers,
  useAddGroupMember,
  useRemoveGroupMember,
} from '@/lib/hooks/use-sharing'
import type { GroupResponse, GroupMemberResponse, UserPickerItem } from '@/lib/api/sharing'

// The global setup mock returns raw keys and drops options, which hides the
// interpolated "{{count}} members" copy this suite asserts on.
const dict: Record<string, string> = {
  'navigation.settings': 'Settings',
  'groups.title': 'Groups',
  'groups.description': 'Manage groups for sharing',
  'groups.groupCount': '{{count}} groups',
  'groups.memberCount': '{{count}} members',
  'groups.create': 'New group',
  'groups.noGroups': 'No groups yet',
  'groups.noMembers': 'No members yet',
  'groups.selectGroupHint': 'Select a group to see its members',
  'groups.name': 'Name',
  'groups.namePlaceholder': 'Group name',
  'groups.descriptionLabel': 'Description',
  'groups.members': 'Members',
  'groups.addMember': 'Add',
  'groups.removeMember': 'Remove',
  'groups.selectUser': 'Select user',
  'groups.deleteConfirm': 'Delete this group?',
  'common.actions': 'Actions',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
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

vi.mock('@/lib/hooks/use-sharing', () => ({
  useGroups: vi.fn(),
  useUsers: vi.fn(),
  useCreateGroup: vi.fn(),
  useDeleteGroup: vi.fn(),
  useGroupMembers: vi.fn(),
  useAddGroupMember: vi.fn(),
  useRemoveGroupMember: vi.fn(),
}))

// Real Select is a Radix popover jsdom can't drive; swap in a native <select>.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string
    onValueChange?: (value: string) => void
    children?: React.ReactNode
  }) => (
    <select value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="" />
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

const mockUseGroups = vi.mocked(useGroups)
const mockUseUsers = vi.mocked(useUsers)
const mockUseCreateGroup = vi.mocked(useCreateGroup)
const mockUseDeleteGroup = vi.mocked(useDeleteGroup)
const mockUseGroupMembers = vi.mocked(useGroupMembers)
const mockUseAddGroupMember = vi.mocked(useAddGroupMember)
const mockUseRemoveGroupMember = vi.mocked(useRemoveGroupMember)

const asResult = <T,>(value: Partial<T>) => value as T

function mutationStub(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  }
}

const groups: GroupResponse[] = [
  { id: 'group:research', name: 'Research team', description: 'Shared reading', source: 'local', member_count: 2 },
  { id: 'group:editors', name: 'Editors', source: 'local', member_count: 1 },
]

const members: GroupMemberResponse[] = [
  { user_id: 'user:maya', email: 'maya@atlas.co', display_name: 'Maya Rodriguez' },
  { user_id: 'user:sam', email: 'sam@atlas.co', display_name: 'Sam Okafor' },
]

const users: UserPickerItem[] = [
  { id: 'user:maya', email: 'maya@atlas.co', display_name: 'Maya Rodriguez' },
  { id: 'user:carol', email: 'carol@atlas.co', display_name: 'Carol Danvers' },
]

describe('GroupsPage', () => {
  let createGroup: ReturnType<typeof mutationStub>
  let deleteGroup: ReturnType<typeof mutationStub>
  let addMember: ReturnType<typeof mutationStub>
  let removeMember: ReturnType<typeof mutationStub>

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGroups.mockReturnValue(asResult<ReturnType<typeof useGroups>>({ data: groups, isLoading: false }))
    mockUseUsers.mockReturnValue(asResult<ReturnType<typeof useUsers>>({ data: users }))
    mockUseGroupMembers.mockReturnValue(
      asResult<ReturnType<typeof useGroupMembers>>({ data: members, isLoading: false })
    )
    createGroup = mutationStub({ mutateAsync: vi.fn().mockResolvedValue({ id: 'group:new' }) })
    deleteGroup = mutationStub()
    addMember = mutationStub()
    removeMember = mutationStub()
    mockUseCreateGroup.mockReturnValue(createGroup as unknown as ReturnType<typeof useCreateGroup>)
    mockUseDeleteGroup.mockReturnValue(deleteGroup as unknown as ReturnType<typeof useDeleteGroup>)
    mockUseAddGroupMember.mockReturnValue(addMember as unknown as ReturnType<typeof useAddGroupMember>)
    mockUseRemoveGroupMember.mockReturnValue(removeMember as unknown as ReturnType<typeof useRemoveGroupMember>)
  })

  it('lists groups with their descriptions and member counts', () => {
    render(<GroupsPage />)
    expect(screen.getByText('2 groups')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Research team/ })).toBeInTheDocument()
    expect(screen.getByText('Shared reading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Editors/ })).toBeInTheDocument()
  })

  it('shows the select-a-group hint before any group is chosen', () => {
    render(<GroupsPage />)
    expect(screen.getByText('Select a group to see its members')).toBeInTheDocument()
  })

  it('shows the empty state when there are no groups', () => {
    mockUseGroups.mockReturnValue(asResult<ReturnType<typeof useGroups>>({ data: [], isLoading: false }))
    render(<GroupsPage />)
    expect(screen.getByText('No groups yet')).toBeInTheDocument()
  })

  it('reveals members and the member count when a group is selected', () => {
    render(<GroupsPage />)
    fireEvent.click(screen.getByRole('button', { name: /Research team/ }))

    expect(screen.getByText('2 members')).toBeInTheDocument()
    expect(screen.getByText('Maya Rodriguez')).toBeInTheDocument()
    expect(screen.getByText('maya@atlas.co')).toBeInTheDocument()
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument()
  })

  it('shows the no-members state for a selected empty group', () => {
    mockUseGroupMembers.mockReturnValue(
      asResult<ReturnType<typeof useGroupMembers>>({ data: [], isLoading: false })
    )
    render(<GroupsPage />)
    fireEvent.click(screen.getByRole('button', { name: /Research team/ }))
    expect(screen.getByText('No members yet')).toBeInTheDocument()
  })

  it('removes a member by its remove control', () => {
    render(<GroupsPage />)
    fireEvent.click(screen.getByRole('button', { name: /Research team/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Maya Rodriguez' }))
    expect(removeMember.mutate).toHaveBeenCalledWith('user:maya')
  })

  it('adds only users who are not already members', () => {
    render(<GroupsPage />)
    fireEvent.click(screen.getByRole('button', { name: /Research team/ }))

    // Maya is already a member; Carol is not.
    expect(screen.queryByRole('option', { name: 'Maya Rodriguez' })).not.toBeInTheDocument()
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'user:carol' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(addMember.mutate.mock.calls[0][0]).toBe('user:carol')
  })

  it('creates a group from the New group dialog', () => {
    render(<GroupsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'New group' }))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Marketing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(createGroup.mutateAsync).toHaveBeenCalledWith({ name: 'Marketing', description: undefined })
  })
})
