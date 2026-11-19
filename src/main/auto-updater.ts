import { app, ipcMain } from 'electron'
import type { AvailableUpdate } from '../shared/update'
import { getRemoteConfig } from './remote-config'

/**
 * Updates come from the check API alone: it sends the newest version and where
 * to download it. There is no release feed to poll and nothing is installed in
 * place, so the app only shows a badge and a link.
 *
 * A native dialog or system notification is never used for this: both are
 * drawn outside content protection, so one popping up mid-interview would show
 * on the shared screen.
 */

let update: AvailableUpdate | null = null

function setUpdate(next: AvailableUpdate | null): void {
  update = next
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', update)
  }
}

/** Positive when `a` is the later of two dotted versions */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

/** Offer the version the server announced, if it is newer than this build */
export function offerRemoteUpdate(version: string, downloadUrl: string): void {
  if (!version || !downloadUrl) return
  // A later call must not replace a newer notice already on screen
  if (update && compareVersions(version, update.version) <= 0) return
  if (compareVersions(version, app.getVersion()) <= 0) return
  setUpdate({ version, url: downloadUrl })
}

export function initAutoUpdater(): void {
  const remote = getRemoteConfig()
  if (remote) offerRemoteUpdate(remote.version, remote.downloadUrl)
}

ipcMain.handle('update:get-status', () => update)
