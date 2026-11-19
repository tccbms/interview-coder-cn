import { join } from 'node:path'
import { shell, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { attachToolbar } from './toolbar-window'
import { applyContentProtection, registerStealthWindow } from './window-privacy'
import { isMainWindowShown, syncShortcuts, watchMainWindowFocus } from './shortcuts'
import { attachMiniBar } from './mini-bar-window'

/**
 * Chromium suspends its compositor when a window is truly hidden or minimized
 * (backgroundThrottling only covers occlusion, not full invisibility). A window
 * restored from such a state — Cmd+M to Dock, Cmd+H app-hide, Mission Control
 * full-screen switch — often comes back with the compositor still sleeping,
 * leaving the frameless transparent overlay painted at its last frame. Ask the
 * web contents for a full repaint instead; cheap enough to call on every
 * show/restore/focus and reliable across Electron versions.
 *
 * Never toggle backgroundColor here: the window is created without one (it
 * relies on transparent: true), and getBackgroundColor() reports opaque white
 * (#FFFFFFFF) in that case — restoring it would make the overlay permanently opaque.
 */
function kickCompositor(window: BrowserWindow): void {
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.invalidate()
  } catch {
    // Silently skip if the web contents is gone or the API is unavailable.
  }
}

export function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    title: '',
    frame: false,
    transparent: true,
    hasShadow: false,
    // Native resize toggling breaks transparency on Windows; renderer handles own resizing.
    resizable: false,
    // The default app menu binds F11 to Toggle Full Screen. This window grows
    // to the whole screen but still reports isFullScreen() false on Windows, so
    // a second F11 tries to enter again and there is no way back
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    // macOS shows a regular app's window over another app's fullscreen Space
    // only if its Spaces flags were set while the app had no Dock icon, and the
    // Dock icon is on by default. A non-activating panel is let in either way
    ...(process.platform === 'darwin' && { type: 'panel' }),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Soft-hide parks the window off-screen, which makes Windows report the
      // window as occluded; with throttling on, the renderer freezes until the
      // window is focused again (queued IPC flushes on click, toolbar hover
      // dwell timers never fire).
      backgroundThrottling: false
    }
  })

  // Store reference to mainWindow globally
  global.mainWindow = mainWindow
  // The toolbar follows the main window's position and visibility on its own
  attachToolbar(mainWindow)
  attachMiniBar(mainWindow)

  mainWindow.setMenuBarVisibility(false)

  registerStealthWindow(mainWindow, '识屏 Shiping', true)
  watchMainWindowFocus(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // The renderer may have sent its shortcuts already, while the window was hidden
    syncShortcuts()
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    // The panel type is what keeps it over fullscreen apps; transforming the
    // process type would only hide the Dock icon. Dock visibility is handled
    // at startup (index.ts) and via renderer sync (settings.ts).
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    applyContentProtection(mainWindow)

    // Reclaim top position when other apps steal it. Not while soft-hidden:
    // handing the keyboard back drops it out of the top-most band on purpose
    mainWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
      if (!isAlwaysOnTop && isMainWindowShown()) {
        // Only re-set the flag; avoid moveTop() to not disturb other window focus
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      }
    })
  })

  mainWindow.on('show', () => {
    applyContentProtection(mainWindow)
    kickCompositor(mainWindow)
  })

  // Restore fires when a minimized window comes back; defensively cover it
  // in case a future Electron or platform path bypasses show.
  mainWindow.on('restore', () => {
    kickCompositor(mainWindow)
  })

  // Some apps (window managers, macOS Mission Control full-screen) briefly
  // hide and re-show the window without going through show/restore — blur →
  // focus is a reliable catch-all for that case.
  mainWindow.on('focus', () => {
    kickCompositor(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
