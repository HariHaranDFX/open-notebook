import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DeleteCredentialDialog } from './DeleteCredentialDialog'
import type { Credential } from '@/lib/api/credentials'

vi.mock('@/lib/hooks/use-credentials', () => ({
  useDeleteCredential: () => ({ mutate: vi.fn(), isPending: false }),
}))

const credential: Credential = {
  id: 'credential:one',
  name: 'Primary',
  provider: 'openai',
  modalities: ['language'],
  has_api_key: true,
  created: '2026-09-01T00:00:00Z',
  updated: '2026-09-01T00:00:00Z',
  model_count: 2,
}

const alternative: Credential = {
  ...credential,
  id: 'credential:two',
  name: 'Secondary',
  model_count: 0,
}

describe('DeleteCredentialDialog', () => {
  it('localizes linked-model migration and deletion actions', () => {
    render(
      <DeleteCredentialDialog
        open
        onOpenChange={vi.fn()}
        credential={credential}
        allCredentials={[credential, alternative]}
      />
    )

    expect(screen.getByText('apiKeys.linkedModels')).toBeInTheDocument()
    expect(screen.getByText('apiKeys.migrateModelsTo')).toBeInTheDocument()
    expect(screen.getByText('apiKeys.selectCredential')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'apiKeys.deleteWithModels' })).toBeInTheDocument()
    expect(screen.queryByText(/This credential has|Migrate models to|Select credential|Delete with Models/)).not.toBeInTheDocument()
  })
})
