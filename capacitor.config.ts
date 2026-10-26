import type { CapacitorConfig } from '@capacitor/cli'

// The phone apps wrap the same build as the web app (dist), so every screen and every rule is shared.
const config: CapacitorConfig = {
  appId: 'app.jod.journal',
  appName: 'JOD',
  webDir: 'dist',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
}

export default config
