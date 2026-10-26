import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { setKeyIterationsForTests } from '../security/crypto'
import { setAuthBypassForTests } from '../sync/session'

// Page tests start signed in and unlocked; the sign-in tests turn this off themselves.
setAuthBypassForTests(true)
setKeyIterationsForTests(1000)

afterEach(() => {
  cleanup()
})

// jsdom has no object URLs; pictures only need a string to put in an <img>.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
}
