import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'

describe('DropdownMenu', () => {
  it('uses a pointer cursor for every enabled interactive row', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Settings</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Show details</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="english">
            <DropdownMenuRadioItem value="english">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Light</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    for (const [role, label] of [
      ['menuitem', 'Settings'],
      ['menuitemcheckbox', 'Show details'],
      ['menuitemradio', 'English'],
      ['menuitem', 'Theme'],
    ] as const) {
      expect(screen.getByRole(role, { name: label })).toHaveClass('cursor-pointer')
    }
  })
})
