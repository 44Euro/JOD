/// <reference types="@capacitor/keyboard" />
import type { CapacitorConfig } from '@capacitor/cli'
import type { KeyboardResize } from '@capacitor/keyboard'

// The phone apps wrap the same build as the web app (dist), so every screen and every rule is shared.
const config: CapacitorConfig = {
  appId: 'app.jod.journal',
  appName: 'JOD',
  webDir: 'dist',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
  // The keyboard shrinks the page instead of sliding the whole web view up, which would drag the status bar strip
  // and the headings under the clock.
  plugins: { Keyboard: { resize: 'native' as KeyboardResize, resizeOnFullScreen: true } },
}

export default config
