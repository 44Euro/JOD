import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

// Presses the action button of the dialog askConfirm opened.
export async function acceptConfirm(user: ReturnType<typeof userEvent.setup>, action: string) {
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: action }))
}
