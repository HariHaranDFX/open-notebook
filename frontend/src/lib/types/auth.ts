export type AuthProvider = 'password' | 'entra'
export type UserRole = 'admin' | 'user'

export interface AuthState {
  isAuthenticated: boolean
  token: string | null
  isLoading: boolean
  error: string | null
  provider: AuthProvider
}

export interface LoginCredentials {
  password: string
}
