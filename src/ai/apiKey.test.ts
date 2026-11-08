import { afterEach, describe, expect, it } from 'vitest'
import { readProviderSettings } from './apiKey'

describe('readProviderSettings', () => {
  afterEach(() => localStorage.clear())

  it('starts Gemini on a model Google still serves to new keys', () => {
    expect(readProviderSettings('gemini').model).toBe('gemini-3.6-flash')
  })

  it('moves a saved gemini-2.5-flash, the old default the form filled in, to the current one', () => {
    localStorage.setItem('jod-ai-gemini', JSON.stringify({ apiKey: 'k', model: 'gemini-2.5-flash' }))
    expect(readProviderSettings('gemini').model).toBe('gemini-3.6-flash')
  })

  it('keeps a model the person typed', () => {
    localStorage.setItem('jod-ai-gemini', JSON.stringify({ apiKey: 'k', model: 'gemini-3.1-flash-lite' }))
    expect(readProviderSettings('gemini').model).toBe('gemini-3.1-flash-lite')
  })
})
