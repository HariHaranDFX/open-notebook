import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  DetailHeaderActions,
  MOBILE_DETAIL_ACTIONS_ID,
} from './DetailHeader'

describe('DetailHeaderActions', () => {
  it('moves detail actions into the responsive shell header without duplicating them', async () => {
    render(
      <>
        <div id={MOBILE_DETAIL_ACTIONS_ID} />
        <DetailHeaderActions>
          <button type="button">Back to sources</button>
        </DetailHeaderActions>
      </>,
    )

    const target = document.getElementById(MOBILE_DETAIL_ACTIONS_ID)

    await waitFor(() => {
      expect(target).toContainElement(screen.getByRole('button', { name: 'Back to sources' }))
    })
    expect(screen.getAllByRole('button', { name: 'Back to sources' })).toHaveLength(1)
  })
})
