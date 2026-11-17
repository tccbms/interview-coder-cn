import type { BrowserWindow } from 'electron'

declare global {
  var mainWindow: BrowserWindow | null
  var loginWindow: BrowserWindow | null
}
