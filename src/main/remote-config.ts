import { ipcMain } from 'electron'
import { DEVICE_TYPE } from '../shared/auth'
import { parseRemoteConfig, type RemoteConfig } from '../shared/remote-config'
import { getDeviceId } from './auth-device'
import { postForm } from './http'
import { settings } from './settings'

/**
 * /api/account/config 下发的配置。Main applies it to its own
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

/** 从 /api/account/config 拉取配置（需登录 token）；失败仅记录日志，沿用本地已有配置 */
export async function fetchRemoteConfig(token: string): Promise<void> {
  const deviceId = await getDeviceId()
  const result = await postForm('/api/account/config', { deviceId, deviceType: DEVICE_TYPE }, token)
  if (!result.ok) {
    console.error('[remote-config] fetch failed:', result.message)
    return
  }
  const next = parseRemoteConfig(result.data)
  if (!next) {
    console.error('[remote-config] empty or unparsable config')
    return
  }
  applyRemoteConfig(next)
}

ipcMain.handle('get-remote-config', () => config)
