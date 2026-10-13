import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { ActivationFailureReason, ActivationReasonPayload } from '../shared/activation'

/**
 * 激活窗口：独立普通窗口（非透明、非 always-on-top）。
 *
 * - 禁用最大化 / 最小化，只允许关闭。
 * - 用户关闭激活窗口 = 退出应用（macOS 默认关窗口不退出，这里强制 quit）。
 * - 激活成功后由主进程主动关闭进主界面：用 `closingIntentionally` 标志
 *   区分「主动关闭」与「用户关闭」，前者不触发 app.quit()。
 */

let closingIntentionally = false

/** 缓存最近一次启动校验的失败原因，供渲染层 mount 后主动拉取 */
let cachedReason: ActivationReasonPayload | null = null

ipcMain.handle('activation:get-reason', (): ActivationReasonPayload | null => cachedReason)

export function createActivationWindow(
  reason: ActivationFailureReason,
  message: string,
  previouslyActivated: boolean
): void {
  if (global.activationWindow && !global.activationWindow.isDestroyed()) {
    global.activationWindow.focus()
    return
  }

  cachedReason = { reason, message, previouslyActivated }

  const win = new BrowserWindow({
    width: 480,
    height: 560,
    title: '激活',
    frame: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  global.activationWindow = win
  win.setMenuBarVisibility(false)

  win.on('closed', () => {
    global.activationWindow = null
    if (!closingIntentionally) {
      app.quit()
    }
    closingIntentionally = false
  })

  win.on('ready-to-show', () => {
    win.show()
    win.webContents.send('activation:reason', cachedReason)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/activation`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'activation' })
  }
}

/** 激活成功后由主进程主动关闭激活窗口（不触发退出） */
export function closeActivationWindow(): void {
  const win = global.activationWindow
  if (!win || win.isDestroyed()) return
  closingIntentionally = true
  win.close()
}
