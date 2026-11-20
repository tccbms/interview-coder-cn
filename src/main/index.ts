import 'dotenv/config'
import './legacy-name'
import { app, desktopCapturer, globalShortcut, session } from 'electron'

// macOS 14.2+ / Electron 39+ 默认走 Apple 新的 CoreAudio Tap API 做系统音频捕获，
// 它需要 Info.plist 里的 NSAudioCaptureUsageDescription 键。
//
// 关键差异：
//   · 打包后的 .app 由 Finder 启动 → Chromium 读 **我们自己** 的 Info.plist
//     → 有 NSAudioCaptureUsageDescription → CoreAudio Tap 直接工作（✅ 不需要屏幕录制权限）
//   · dev 模式由 Terminal/IDE 启动 → Chromium 读 **父程序** 的 Info.plist
//     → Terminal/IDE 没那个键 → CoreAudio Tap 静默失败
//
// 所以只有 dev 模式才强制回退到老的 Screen & System Audio Recording 权限系统
// （它只需要 macOS 系统级的屏幕录制权限，dev 时用户已经给 Trae/Terminal 了）。
// 打包后的产品包必须走 CoreAudio Tap——老路径需要用户额外给 .app 授权屏幕录制，
// 而新路径只靠 Info.plist 里的 NSAudioCaptureUsageDescription 就能跑。
if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare')
}

type AbortLikeError = {
  name?: string
  code?: string
  message?: unknown
}

// Swallow AbortError from user-initiated stream cancellations to keep console clean
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const err = error as AbortLikeError
  const message = typeof err.message === 'string' ? err.message : ''
  return err.name === 'AbortError' || err.code === 'ABORT_ERR' || /aborted/i.test(message)
}

process.on('unhandledRejection', (error) => {
  if (isAbortError(error)) return
  console.error(error)
})

process.on('uncaughtException', (error) => {
  if (isAbortError(error)) return
  console.error(error)
})
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { revealMainWindow } from './shortcuts'
import './transcription'
import './conversation'
import './knowledge'
import './window-resize'
import './model-list'
import './proxy-ipc'
import './external-knowledge-ipc'
import './mobile-sync'
import './tray'
import './auth'
import './account'
import './billing'
import { applyDockVisibility } from './settings'
import { enterMainWindow, validateStoredToken } from './auth'
import { createLoginWindow } from './login-window'

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Hide the dock icon up front until the renderer syncs the real preference.
  // The persisted `hideDockIcon` value lives in the renderer, so the main
  // process doesn't know it yet at startup. Starting hidden avoids a dock
  // flash for users who keep it hidden; if disabled, the renderer sync will
  // show it again once the window mounts.
  applyDockVisibility(true)

  // Auto-approve getDisplayMedia for system audio loopback capture. A request
  // left unanswered never settles, and listening would silently do nothing:
  // getSources rejects on macOS without the screen recording permission
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .catch((err) => {
        console.error('[display-media] getSources failed:', err)
        return []
      })
      .then((sources) => {
        console.log('[display-media] sources:', sources.length, 'platform:', process.platform)
        if (sources.length > 0) {
          // 有 disable-features 走老的 Screen & System Audio Recording 权限系统后，
          // loopback 在 macOS 上也能正常工作（Chromium 老路径支持它）。
          // 没 disable-features 时（CoreAudio Tap API）macOS 不认 loopback，会 Invalid capture constraints。
          callback({ video: sources[0], audio: 'loopback' })
        } else {
          // null refuses → renderer 收到 AbortError（由 renderer 的 captureFailure 正确处理）
          callback(null as any)
        }
      })
  })

  // Auto-approve microphone access so users can enumerate and select audio input devices,
  // the screen capture getDisplayMedia needs for system audio (`display-capture`: Electron 45
  // stopped reporting it as `media`, and without it listening fails with NotAllowedError),
  // and clipboard writes for the copy buttons (navigator.clipboard.writeText)
  const allowedPermissions = [
    'media',
    'display-capture',
    'microphone',
    'audio',
    'clipboard-sanitized-write'
  ]
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission))
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 启动校验：本地 token + /api/account/profile。
  // 通过 → 拉远程配置并创建主窗口；未登录 / 失效 / 网络失败 → 登录页。
  // 主窗口初始 show:false（ready-to-show 才 show），校验期间用户看不到主界面，无闪屏。
  const outcome = await validateStoredToken()
  if (outcome.ok) {
    await enterMainWindow()
  } else {
    createLoginWindow(outcome.reason, outcome.message)
  }

  // Clicking the Dock icon brings back a window hidden with the shortcut
  app.on('activate', function () {
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      revealMainWindow(global.mainWindow)
    } else if (!outcome.ok) {
      createLoginWindow('none', '')
    }
  })
})

// Closing the window quits, on macOS too: the main window is the whole app.
// Left running without it, the process would keep a tray icon whose actions
// all need that window, and no shortcuts. Hiding it (shortcut, tray menu, the
// header's 隐藏 button) keeps the app in the background
app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  app.quit()
})
