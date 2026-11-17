import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { LoginFailureReason, LoginReasonPayload } from '../shared/auth'

/**
 * 登录窗口：独立普通窗口（非透明、非 always-on-top）。
 *
 * - 禁用最大化 / 最小化，只允许关闭。
 * - 用户关闭登录窗口 = 退出应用（macOS 默认关窗口不退出，这里强制 quit）。
 * - 登录成功后由主进程主动关闭进主界面：用 `closingIntentionally` 标志
 *   区分「主动关闭」与「用户关闭」，前者不触发 app.quit()。
 */

let closingIntentionally = false

/** 缓存最近一次启动校验的失败原因，供渲染层 mount 后主动拉取 */
let cachedReason: LoginReasonPayload | null = null

ipcMain.handle('auth:get-reason', (): LoginReasonPayload | null => cachedReason)

export function createLoginWindow(reason: LoginFailureReason, message: string): void {
  if (global.loginWindow && !global.loginWindow.isDestroyed()) {
    global.loginWindow.focus()
    return
  }

  cachedReason = { reason, message }

  const win = new BrowserWindow({
    width: 480,
    height: 560,
    title: '胖猫面试助手',
    frame: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  global.loginWindow = win
  win.setMenuBarVisibility(false)

  win.on('closed', () => {
    global.loginWindow = null
    if (!closingIntentionally) {
      app.quit()
    }
    closingIntentionally = false
  })

  win.on('ready-to-show', () => {
    win.show()
    win.webContents.send('auth:reason', cachedReason)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/login`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'login' })
  }
}

/** 登录成功后由主进程主动关闭登录窗口（不触发退出） */
export function closeLoginWindow(): void {
  const win = global.loginWindow
  if (!win || win.isDestroyed()) return
  closingIntentionally = true
  win.close()
}
