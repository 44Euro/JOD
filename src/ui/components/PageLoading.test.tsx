import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageLoading } from './PageLoading'

describe('PageLoading', () => {
  it('draws the outline of a page and says it is loading to screen readers', () => {
    const { container } = render(<PageLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลด…')
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThanOrEqual(3)
  })
})
