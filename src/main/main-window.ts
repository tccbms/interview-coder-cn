import { join } from 'node:path'
import { shell, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createToolbarWindow } from './toolbar-window'

export function applyContentProtection(window: BrowserWindow, forceReset = false): void {
  if (!window || window.isDestroyed()) return

  if (forceReset && process.platform === 'win32') {
    window.setContentProtection(false)
  }

  window.setContentProtection(true)
}

/**
 * Chromium suspends its compositor when a window is truly hidden or minimized
 * (backgroundThrottling only covers occlusion, not full invisibility). A window
 * restored from such a state — Cmd+M to Dock, Cmd+H app-hide, Mission Control
 * full-screen switch — often comes back with the compositor still sleeping,
 * leaving the frameless transparent overlay painted at its last frame. Ask the
 * web contents for a full repaint instead; cheap enough to call on every
 * show/restore/focus and reliable across Electron versions.
 */
function kickCompositor(window: BrowserWindow): void {
  if (!window || window.isDestroyed()) return
  try {
    // Schedule a full repaint without touching the window's background color.
    // Never toggle backgroundColor here: the window is created without one (it
    // relies on transparent: true), and getBackgroundColor() reports opaque
    // white (#FFFFFFFF) in that case — restoring it would make the overlay
    // permanently opaque.
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
    // The overlay is always-on-top and invisible to screen-sharing. Native minimize
    // / hide freezes Chromium's compositor (backgroundThrottling only blocks timer
    // throttling, not render suspension) and the frameless transparent window often
    // cannot recover a fresh frame when restored — users report the window returning
    // with content stuck on one static frame. Disable native minimize entirely and
    // let Cmd+H / Cmd+M fall through to our soft-hide instead.
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
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
  createToolbarWindow(mainWindow)

  mainWindow.setMenuBarVisibility(false)

  // Keep the native window title empty. Chromium's window picker (Edge/Chrome
  // "share a window") enumerates windows with WebRTC's kIgnoreUntitled flag and
  // drops the ones whose title is empty, so an untitled window never shows up in
  // the list. setContentProtection only blanks the pixels; it does not hide the
  // window from enumeration. The window is frameless, so no title is ever drawn.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow.setTitle('')
  })

  // Cmd+M is handled by minimizable:false above; Electron's 'minimize' event is
  // emitted after the fact and cannot be cancelled, so there is nothing to guard.

  // When the window becomes visible again (any path: soft-hide restore,
  // workspace switch, Mission Control, focus return), Chromium's compositor
  // may still be suspended from a prior minimize/hide. Force a repaint by
  // toggling the background color — cheap enough to do on every show and
  // reliably kick the compositor into producing fresh frames.
  mainWindow.on('show', () => {
    applyContentProtection(mainWindow)
    kickCompositor(mainWindow)
  })

  // Restore is fired when a minimized window comes back; defensively cover it
  // in case a future Electron or platform path bypasses minimizable:false.
  mainWindow.on('restore', () => {
    kickCompositor(mainWindow)
  })

  // Some apps (window managers, macOS Mission Control full-screen) briefly
  // hide and re-show the window without going through show/restore — blur →
  // focus is a reliable catch-all for that case.
  mainWindow.on('focus', () => {
    kickCompositor(mainWindow)
  })

  // show:false above means nothing is on screen until this fires; without it the
  // window stays hidden after launch and only the hideOrShow shortcut reveals it.
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Dock visibility is handled at startup (index.ts) and via renderer sync
    // (settings.ts); the window's own show event must not force it back on.
    applyContentProtection(mainWindow)

    // Reclaim top position when other apps steal it
    mainWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
      if (!isAlwaysOnTop && mainWindow.isVisible() && !mainWindow.isDestroyed()) {
        // Only re-set the flag; avoid moveTop() to not disturb other window focus
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      }
    })
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
