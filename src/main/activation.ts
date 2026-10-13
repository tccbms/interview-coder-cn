import { app, ipcMain } from 'electron'
import {
  DEVICE_TYPE,
  cleanActivationCode,
  maskDeviceId,
  type ActivationFailureReason,
  type ActivationResult
} from '../shared/activation'
import { postActivationAPI } from './activation-http'
import {
  getDeviceId,
  readActivationStatus,
  writeActivationStatus
} from './activation-device'
import { closeActivationWindow } from './activation-window'
import { createWindow } from './main-window'

/**
 * 激活码功能的启动校验编排与 IPC handler。
 *
 * 启动流程（在 app.whenReady 内、createWindow 之前调用）：
 *   读 deviceId → 调 /api/code/check →
 *     code==0 进主界面；否则跳激活页（带 reason + msg）。
 *
 * 本地 activation.json 只用于「避免每次冷启动白屏等待」，
 * 绝不替代服务端校验——服务端校验通不过就必回激活页。
 */

export interface CheckOutcome {
  ok: boolean
  reason?: ActivationFailureReason
  message?: string
  previouslyActivated?: boolean
}

/** 把 postActivationAPI 的失败文案归类成 network / expired */
function classifyFailure(message: string): ActivationFailureReason {
  return /网络|超时|HTTP|格式异常/.test(message) ? 'network' : 'expired'
}

/** 启动校验。在 app.whenReady 内、主窗口创建前调用。 */
export async function runStartupCheck(): Promise<CheckOutcome> {
  const deviceId = await getDeviceId()
  const status = readActivationStatus()
  console.log('[activation] startup check for device', maskDeviceId(deviceId))

  const result = await postActivationAPI('/api/code/check', {
    deviceType: DEVICE_TYPE,
    deviceId
  })

  if (result.ok) {
    await writeActivationStatus({
      deviceId,
      activated: true,
      lastCheckedAt: Date.now()
    })
    console.log('[activation] check passed, entering main window')
    return { ok: true }
  }

  const reason = classifyFailure(result.message)
  console.log('[activation] check failed:', reason, result.message)
  return {
    ok: false,
    reason,
    message: result.message,
    previouslyActivated: !!status?.activated
  }
}

/** 激活成功后：持久化 → 创建主窗口 → 主窗口显示后关激活窗口 */
async function onActivationSuccess(): Promise<void> {
  const deviceId = await getDeviceId()
  await writeActivationStatus({
    deviceId,
    activated: true,
    lastCheckedAt: Date.now()
  })
  console.log('[activation] activate success, switching to main window')

  createWindow()
  if (global.mainWindow) {
    global.mainWindow.once('ready-to-show', () => {
      closeActivationWindow()
    })
  } else {
    closeActivationWindow()
  }
}

/** 防重复提交：主进程侧的二次防御 */
let pendingActivate = false

ipcMain.handle('activation:activate', async (_event, code: string): Promise<ActivationResult> => {
  if (pendingActivate) {
    return { ok: false, message: '正在处理，请稍候' }
  }
  pendingActivate = true
  try {
    const cleaned = cleanActivationCode(code)
    if (!cleaned) {
      return { ok: false, message: '请输入激活码' }
    }
    const deviceId = await getDeviceId()
    console.log('[activation] activate request for device', maskDeviceId(deviceId))

    const result = await postActivationAPI('/api/code/active', {
      activationCode: cleaned,
      deviceType: DEVICE_TYPE,
      deviceId
    })

    if (result.ok) {
      await onActivationSuccess()
    } else {
      console.log('[activation] activate failed:', result.message)
    }
    return result
  } finally {
    pendingActivate = false
  }
})

ipcMain.handle('activation:get-device-id', async (): Promise<string> => getDeviceId())
ipcMain.handle('activation:quit', () => app.quit())
