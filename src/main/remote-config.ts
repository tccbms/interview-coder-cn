import { ipcMain } from 'electron'
import type { RemoteConfig } from '../shared/remote-config'
import { settings } from './settings'

/**
 * What the check API returned for this install. Main applies it to its own
 * settings (so shortcuts work before the renderer has mounted) and hands it to
 * the renderer, which owns the profiles the requests are actually sent with.
 */
let config: RemoteConfig | null = null

export function getRemoteConfig(): RemoteConfig | null {
  return config
}

/** Apply it to main's settings, and tell the renderer if it is already up. */
export function applyRemoteConfig(next: RemoteConfig): void {
  config = next
  if (next.aiUrl) settings.apiBaseURL = next.aiUrl
  if (next.aiKey) settings.apiKey = next.aiKey
  if (next.audioKey) settings.dashscopeApiKey = next.audioKey
  console.log(
    '[remote-config] applied:',
    `version=${next.version || '(none)'}`,
    `aiUrl=${next.aiUrl || '(none)'}`,
    `aiKey=${next.aiKey ? 'set' : '(none)'}`,
    `audioKey=${next.audioKey ? 'set' : '(none)'}`
  )

  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('remote-config', next)
  }
}

ipcMain.handle('get-remote-config', () => config)
