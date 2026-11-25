import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage } from 'electron'
import { DEVICE_TYPE, type AuthResult, type LoginFailureReason } from '../shared/auth'
import { getDeviceId } from './auth-device'
import { postForm } from './http'
import { createWindow } from './main-window'
import { initAutoUpdater } from './auto-updater'
import { fetchRemoteConfig } from './remote-config'
import { closeLoginWindow, createLoginWindow } from './login-window'
import { hideToolbar } from './toolbar-window'
import { endSessionForLogout, refreshBalance, resetBillingState } from './billing'

/**
 * 账号密码登录（第一版简化）：
 * - 单 token，30 天有效，无 refresh_token
 * - token 用 safeStorage 加密存 userData/auth.json，不保存密码
 * - 启动时凭本地 token 调 /api/account/profile 校验，失败回登录页
 */

interface StoredAuth {
  token: string
  accountId?: number
  account?: string
  encrypted?: boolean
}

export interface StartupOutcome {
  ok: boolean
  reason: LoginFailureReason
  message: string
}

let currentToken: string | null = null

function authPath(): string {
  return join(app.getPath('userData'), 'auth.json')
}

/** 读本地 token 并解密；文件不存在或解密失败都当作未登录 */
function readStoredAuth(): StoredAuth | null {
  try {
    if (!existsSync(authPath())) return null
    const saved = JSON.parse(readFileSync(authPath(), 'utf-8')) as StoredAuth
    if (typeof saved.token !== 'string' || !saved.token) return null
    if (saved.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) return null
      return { ...saved, token: safeStorage.decryptString(Buffer.from(saved.token, 'base64')) }
    }
    return saved
  } catch (error) {
    console.error('[auth] Failed to read auth:', error)
    return null
  }
}

async function writeStoredAuth(auth: {
  token: string
  accountId?: number
  account?: string
}): Promise<void> {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const encrypted = safeStorage.isEncryptionAvailable()
    const saved: StoredAuth = {
      token: encrypted ? safeStorage.encryptString(auth.token).toString('base64') : auth.token,
      accountId: auth.accountId,
      account: auth.account,
      encrypted
    }
    const path = authPath()
    const temp = `${path}.tmp`
    await writeFile(temp, JSON.stringify(saved, null, 2), 'utf-8')
    await rename(temp, path)
  } catch (error) {
    console.error('[auth] Failed to save auth:', error)
  }
}

function clearAuth(): void {
  currentToken = null
  try {
    if (existsSync(authPath())) unlinkSync(authPath())
  } catch (error) {
    console.error('[auth] Failed to clear auth:', error)
  }
}

/** 当前可用 token，供后续计费接口鉴权使用 */
export function getAccessToken(): string | null {
  return currentToken ?? readStoredAuth()?.token ?? null
}

/**
 * 启动校验：有本地 token 就调 profile 验证。
 * 网络/服务异常不清 token（用户可重试），只有 401/40101 才清除。
 */
export async function validateStoredToken(): Promise<StartupOutcome> {
  const saved = readStoredAuth()
  if (!saved) return { ok: false, reason: 'none', message: '' }
  currentToken = saved.token
  const deviceId = await getDeviceId()
  const result = await postForm('/api/account/profile', { deviceId }, saved.token)
  if (result.ok) {
    console.log('[auth] token valid, entering main window')
    return { ok: true, reason: 'none', message: '' }
  }
  // 服务端业务失败统一 code=500，token 失效只能按 msg 识别
  const unauthorized = result.code === 401 || result.code === 40101 || /token/i.test(result.message)
  if (unauthorized) {
    clearAuth()
    return { ok: false, reason: 'unauthorized', message: result.message }
  }
  console.error('[auth] startup validation failed:', result.message)
  return { ok: false, reason: 'network', message: result.message }
}

/** 进入主界面：先建主窗（show:false，ready-to-show 才显示），关登录窗，拉远程配置 */
export async function enterMainWindow(): Promise<void> {
  // 必须先 createWindow() 再 closeLoginWindow()：上游 index.ts 的
  // window-all-closed 任何平台都 app.quit，中间没窗口进程就自杀了。
  createWindow()
  closeLoginWindow()
  // 配置拉取失败不阻塞进主窗口，沿用本地已有配置
  await fetchRemoteConfig(currentToken ?? '')
  initAutoUpdater()
}

ipcMain.handle(
  'auth:login',
  async (_event, account: string, password: string): Promise<AuthResult> => {
    const deviceId = await getDeviceId()
    const result = await postForm('/api/account/login', {
      account: account.trim(),
      password,
      deviceId,
      deviceType: DEVICE_TYPE,
      type: 'interview'
    })
    if (!result.ok) {
      console.log('[auth] login failed:', result.message)
      return { ok: false, message: result.message }
    }
    const data = (result.data ?? {}) as { token?: unknown; accountId?: unknown; account?: unknown }
    if (typeof data.token !== 'string' || !data.token) {
      return { ok: false, message: '登录响应缺少 token' }
    }
    currentToken = data.token
    await writeStoredAuth({
      token: data.token,
      accountId: typeof data.accountId === 'number' ? data.accountId : undefined,
      account: typeof data.account === 'string' ? data.account : account.trim()
    })
    console.log('[auth] login success')
    // 登出已 resetBillingState 清空旧用户状态，这里为新登录用户种子余额与耗尽标志
    void refreshBalance()
    await enterMainWindow()
    return { ok: true, message: 'success' }
  }
)

ipcMain.handle('auth:logout', async () => {
  // 先结束计费会话（失败也不阻塞登出），再清 token 回登录页
  await endSessionForLogout()
  // 清空旧用户的运行时计费状态，避免余额/耗尽标志残留到下一次登录
  resetBillingState()
  const token = getAccessToken()
  if (token) {
    const deviceId = await getDeviceId()
    // 吊销失败也继续退出，本地 token 必须清掉
    await postForm('/api/account/logout', { deviceId }, token)
  }
  clearAuth()
  // 不用 app.relaunch()：同进程内回登录窗更可靠，避免重启失败软件直接消失
  hideToolbar()
  createLoginWindow('none', '')
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    global.mainWindow = null
    mainWindow.close()
  }
})

ipcMain.handle('auth:quit', () => app.quit())
