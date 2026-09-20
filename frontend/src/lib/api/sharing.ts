import apiClient from './client'

export type GrantRole = 'viewer' | 'editor'
export type PrincipalType = 'user' | 'group'
export type ResourceType = 'notebook' | 'source'

export interface UserPickerItem {
  id: string
  email: string
  display_name: string
  // WBS 4.21 — true when the row was JIT-stubbed (directory picker or
  // Entra group sync) and has never signed in.
  pending?: boolean
}

export interface DirectoryUserCandidate {
  entra_oid: string
  email: string
  display_name: string
}

export interface StubUserFromEntraRequest {
  entra_oid: string
}

export interface GroupResponse {
  id: string
  name: string
  description?: string | null
  source: string
  entra_group_oid?: string | null
  member_count: number
}

export interface GroupMemberResponse {
  user_id: string
  email: string
  display_name: string
  pending?: boolean
}

export interface GrantResponse {
  id: string
  resource_type: ResourceType
  resource_id: string
  principal_type: PrincipalType
  principal_id: string
  role: GrantRole
  granted_by?: string | null
  principal_label?: string | null
}

export interface GrantCreate {
  principal_type: PrincipalType
  principal_id: string
  role: GrantRole
}

export interface GroupCreate {
  name: string
  description?: string | null
}

export interface EntraGroupCandidate {
  entra_group_oid: string
  display_name: string
  description?: string | null
}

export interface LinkEntraGroupRequest {
  entra_group_oid: string
}

export const sharingApi = {
  listUsers: async () => {
    const response = await apiClient.get<UserPickerItem[]>('/users')
    return response.data
  },

  listGroups: async () => {
    const response = await apiClient.get<GroupResponse[]>('/groups')
    return response.data
  },

  createGroup: async (data: GroupCreate) => {
    const response = await apiClient.post<GroupResponse>('/groups', data)
    return response.data
  },

  updateGroup: async (
    id: string,
    data: { name?: string; description?: string | null }
  ) => {
    const response = await apiClient.patch<GroupResponse>(`/groups/${id}`, data)
    return response.data
  },

  deleteGroup: async (id: string) => {
    const response = await apiClient.delete(`/groups/${id}`)
    return response.data
  },

  listMembers: async (groupId: string) => {
    const response = await apiClient.get<GroupMemberResponse[]>(
      `/groups/${groupId}/members`
    )
    return response.data
  },

  addMember: async (groupId: string, userId: string) => {
    const response = await apiClient.post<GroupMemberResponse>(
      `/groups/${groupId}/members`,
      { user_id: userId }
    )
    return response.data
  },

  removeMember: async (groupId: string, userId: string) => {
    const response = await apiClient.delete(
      `/groups/${groupId}/members/${userId}`
    )
    return response.data
  },

  listGrants: async (resourceType: ResourceType, resourceId: string) => {
    const response = await apiClient.get<GrantResponse[]>(
      `/${resourceType}s/${resourceId}/grants`
    )
    return response.data
  },

  createGrant: async (
    resourceType: ResourceType,
    resourceId: string,
    data: GrantCreate
  ) => {
    const response = await apiClient.post<GrantResponse>(
      `/${resourceType}s/${resourceId}/grants`,
      data
    )
    return response.data
  },

  updateGrant: async (
    resourceType: ResourceType,
    resourceId: string,
    grantId: string,
    role: GrantRole
  ) => {
    const response = await apiClient.patch<GrantResponse>(
      `/${resourceType}s/${resourceId}/grants/${grantId}`,
      { role }
    )
    return response.data
  },

  deleteGrant: async (
    resourceType: ResourceType,
    resourceId: string,
    grantId: string
  ) => {
    const response = await apiClient.delete(
      `/${resourceType}s/${resourceId}/grants/${grantId}`
    )
    return response.data
  },

  // WBS 4.20 — Entra-linked groups (admin-only)
  searchEntraGroups: async (query: string) => {
    const response = await apiClient.get<EntraGroupCandidate[]>(
      '/groups/entra/search',
      { params: { q: query } }
    )
    return response.data
  },

  linkEntraGroup: async (body: LinkEntraGroupRequest) => {
    const response = await apiClient.post<GroupResponse>(
      '/groups/entra/link',
      body
    )
    return response.data
  },

  syncEntraGroups: async () => {
    const response = await apiClient.post<{ command_id: string }>(
      '/groups/entra/sync'
    )
    return response.data
  },

  // WBS 4.21 — Tenant directory picker + JIT-stub user provisioning
  searchDirectoryUsers: async (query: string) => {
    const response = await apiClient.get<DirectoryUserCandidate[]>(
      '/users/directory',
      { params: { q: query } }
    )
    return response.data
  },

  stubEntraUser: async (body: StubUserFromEntraRequest) => {
    const response = await apiClient.post<UserPickerItem>(
      '/users/from-entra',
      body
    )
    return response.data
  },
}
